import type { SwapOnArcResult } from "@astrolabe/circle";
import { swapOnArc } from "@astrolabe/circle";
import { type Result, ResultAsync, err, ok } from "neverthrow";
import { ExecutorError } from "./errors.js";
import { type ExecutionRecord, applyTransition } from "./execution.js";
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
};

export type RunSwapDeps = {
  swapOnArc: typeof swapOnArc;
  saveExecution: typeof saveExecution;
};

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
    const swapping = applyTransition(current, "swapping");
    if (swapping.isErr()) {
      // The record never left its original (valid) state, so there is
      // nothing to roll back — surface the transition error as-is instead of
      // manufacturing a swap failure. This is also how a record that isn't
      // in "minting" (e.g. a future swap_only route) surfaces honestly:
      // TRANSITIONS only allows minting -> swapping today.
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

    // No retry logic, deliberately: kit.swap submits an on-chain transaction
    // and a thrown error does not distinguish "never submitted" from
    // "submitted but the response was lost", so retrying risks executing the
    // swap twice. Retry can be revisited if Circle exposes an idempotency
    // key.
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

    // From here on the swap has ALREADY happened on-chain. The record must
    // never be marked failed_funds_safe past this point — that would make
    // the persisted story contradict the chain.
    const completed = applyTransition(current, "completed");
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
    const failed = applyTransition(record, "failed_funds_safe");
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
