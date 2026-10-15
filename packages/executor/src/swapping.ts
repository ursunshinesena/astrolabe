import type { SwapOnArcResult } from "@astrolabe/circle";
import { swapOnArc } from "@astrolabe/circle";
import { type Result, ResultAsync, err, ok } from "neverthrow";
import { ExecutorError } from "./errors.js";
import { type ExecutionRecord, applyTransition, withError, withEvidence } from "./execution.js";
import { saveExecution } from "./persistence.js";

export type RunSwapParams = {
  /**
   * The full ExecutionRecord to drive, not just its id. This module (like
   * bridging.ts) writes several ExecutionRecord snapshots to disk over the
   * course of one call. Taking the record directly keeps runSwap pure and
   * lets the caller decide how it was obtained (fresh from the bridge phase,
   * or already loaded via loadExecution) instead of runSwap silently
   * re-fetching it from disk via an implicit loadExecution call with its own
   * failure mode that isn't part of this module's documented error surface.
   */
  record: ExecutionRecord;
  fromAddress: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  apiKey: string;
  entitySecret: string;
  slippageBps?: number;
  /** Passed through to saveExecution; defaults to process.cwd() there. */
  baseDir?: string;
  /**
   * Waits before each retry, e.g. [5000, 15000, 45000] for the M4 design's
   * three retries. Retries only happen when deps.checkUnswapped is provided,
   * because a thrown swap error alone cannot rule out an on-chain swap.
   */
  retryDelaysMs?: readonly number[];
};

export type RunSwapDeps = {
  swapOnArc: typeof swapOnArc;
  saveExecution: typeof saveExecution;
  /**
   * Resolves ok(true) only when it is certain the swap did NOT execute (for
   * example the input-token balance is still at least amountIn). ok(false)
   * or err(...) mean "cannot rule it out" and stop all further attempts.
   */
  checkUnswapped?: () => Promise<Result<boolean, Error>>;
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export type RunSwapResult = {
  record: ExecutionRecord;
  result: SwapOnArcResult;
};

export function runSwap(
  params: RunSwapParams,
  deps: RunSwapDeps = { swapOnArc, saveExecution },
): ResultAsync<RunSwapResult, ExecutorError> {
  // executeSwap never rejects (it is wrapped end-to-end in try/catch), so we
  // construct ResultAsync directly from its Result-producing promise rather
  // than ResultAsync.fromPromise/fromSafePromise, which would either
  // double-wrap the Result or require throwing to represent a swap failure —
  // and a failed swap is an expected outcome of this module, not an
  // exception.
  return new ResultAsync(executeSwap(params, deps));
}

async function executeSwap(
  params: RunSwapParams,
  deps: RunSwapDeps,
): Promise<Result<RunSwapResult, ExecutorError>> {
  let current = params.record;
  // Set once swapOnArc resolves. Read by the catch block below to decide
  // whether an exception happened before the swap (route through
  // finalizeSwapFailure) or after it already succeeded on-chain (report a
  // persistence failure instead — see the comment on that branch).
  let swapOutcome: SwapOnArcResult | null = null;
  try {
    if (current.state !== "swapping") {
      const swapping = applyTransition(current, "swapping");
      if (swapping.isErr()) {
        // The record never left its original (valid) state, so there is
        // nothing to roll back — surface the transition error as-is instead of
        // manufacturing a swap failure. TRANSITIONS only allows
        // minting -> swapping, so e.g. a swap_only record surfaces honestly.
        return err(swapping.error);
      }
      current = swapping.value;

      const initialSave = await deps.saveExecution(current, params.baseDir);
      if (initialSave.isErr()) {
        // Persistence is broken before any on-chain call was made — abort
        // rather than start a swap we can't durably track.
        return err(initialSave.error);
      }
      current = initialSave.value;
    }
    // A record already in "swapping" is a resume: the caller must have
    // proven via checkUnswapped that no earlier attempt executed.

    // kit.swap submits an on-chain transaction and a thrown error does not
    // distinguish "never submitted" from "submitted but the response was
    // lost". Each retry is therefore gated on checkUnswapped proving the
    // swap did not happen; without that proof we never retry.
    const delays = deps.checkUnswapped ? (params.retryDelaysMs ?? []) : [];
    const sleep = deps.sleep ?? defaultSleep;
    for (let attempt = 0; ; attempt++) {
      try {
        swapOutcome = await deps.swapOnArc({
          fromAddress: params.fromAddress,
          tokenIn: params.tokenIn,
          tokenOut: params.tokenOut,
          amountIn: params.amountIn,
          apiKey: params.apiKey,
          entitySecret: params.entitySecret,
          // Spread rather than passed unconditionally so an absent slippageBps
          // stays absent (letting swapOnArc apply its own default) instead of
          // becoming an explicit `undefined` property.
          ...(params.slippageBps !== undefined ? { slippageBps: params.slippageBps } : {}),
        });
        break;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (deps.checkUnswapped) {
          const proof = await deps.checkUnswapped();
          if (proof.isErr() || !proof.value) {
            return markUncertain(current, params, deps, message, e);
          }
        }
        const delay = delays[attempt];
        if (delay === undefined) {
          return finalizeSwapFailure(current, params, deps, attemptsNote(message, attempt), e);
        }
        await sleep(delay);
      }
    }

    // From here on the swap has ALREADY happened on-chain. The record must
    // never be marked failed_funds_safe past this point — that would make
    // the persisted story contradict the chain.
    const completed = applyTransition(
      withEvidence(current, [
        { step: "swap", txHash: swapOutcome.txHash, explorerUrl: swapOutcome.explorerUrl },
      ]),
      "completed",
    );
    if (completed.isErr()) {
      return swapSucceededButUnrecorded(
        swapOutcome.txHash,
        completed.error.message,
        completed.error,
      );
    }
    current = completed.value;

    const finalSave = await deps.saveExecution(current, params.baseDir);
    if (finalSave.isErr()) {
      return swapSucceededButUnrecorded(
        swapOutcome.txHash,
        finalSave.error.message,
        finalSave.error,
      );
    }
    current = finalSave.value;

    return ok({ record: current, result: swapOutcome });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (swapOutcome !== null) {
      return swapSucceededButUnrecorded(swapOutcome.txHash, message, e);
    }
    return finalizeSwapFailure(current, params, deps, message, e);
  }
}

/**
 * The swap succeeded on-chain but we could not record it. Funds are NOT in
 * an ambiguous state here — we know exactly where they are (the swap
 * completed, txHash in hand) — so the honest failure is "we could not write
 * it down", not "the swap failed". Hence PERSISTENCE_FAILURE, never
 * SWAP_FAILED, and never a failed_funds_safe transition.
 */
function swapSucceededButUnrecorded(
  txHash: string,
  detail: string,
  cause: unknown,
): Result<RunSwapResult, ExecutorError> {
  return err(
    new ExecutorError(
      `Swap succeeded (txHash: ${txHash}) but the execution record could not be updated: ${detail}`,
      "PERSISTENCE_FAILURE",
      cause,
    ),
  );
}

function attemptsNote(message: string, retries: number): string {
  return retries > 0 ? `${message} (after ${retries + 1} attempts)` : message;
}

/**
 * A swap attempt threw and we cannot prove it did not execute. The record
 * stays in "swapping" (never failed_funds_safe, which would be a claim we
 * can't back) with the reason written down, so an operator checks the chain.
 */
async function markUncertain(
  record: ExecutionRecord,
  params: RunSwapParams,
  deps: RunSwapDeps,
  message: string,
  cause: unknown,
): Promise<Result<RunSwapResult, ExecutorError>> {
  const detail = `Swap outcome uncertain: ${message}. Verify ${params.fromAddress} on Arc before retrying.`;
  const saved = await deps.saveExecution(withError(record, detail), params.baseDir);
  if (saved.isErr()) {
    return err(saved.error);
  }
  return err(new ExecutorError(detail, "SWAP_UNCERTAIN", cause));
}

/**
 * Only ever reached when the swap did NOT succeed. Transitions the record to
 * failed_funds_safe and persists it before reporting the swap error.
 */
async function finalizeSwapFailure(
  record: ExecutionRecord,
  params: RunSwapParams,
  deps: RunSwapDeps,
  message: string,
  cause: unknown,
): Promise<Result<RunSwapResult, ExecutorError>> {
  try {
    const failed = applyTransition(
      withError(record, `Swap failed: ${message}. USDC remains on Arc at ${params.fromAddress}.`),
      "failed_funds_safe",
    );
    if (failed.isOk()) {
      const saved = await deps.saveExecution(failed.value, params.baseDir);
      if (saved.isErr()) {
        // Failing to durably record "funds are safe" is more urgent than the
        // triggering swap error — surface it so the caller knows local state
        // tracking is broken, per the project rule that funds must never be
        // left in an ambiguous state.
        return err(saved.error);
      }
    }
    // If the failed_funds_safe transition itself errs (record already
    // terminal), there is nothing further to persist — fall through and
    // report the original swap failure below.
  } catch (e) {
    return err(
      new ExecutorError(
        `Swap failed and cleanup also failed: ${e instanceof Error ? e.message : String(e)}`,
        "SWAP_FAILED",
        e,
      ),
    );
  }
  return err(new ExecutorError(`Swap failed: ${message}`, "SWAP_FAILED", cause));
}
