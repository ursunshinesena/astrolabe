import { BridgeFailure, getTokenBalances, retryBridge, swapOnArc } from "@astrolabe/circle";
import { type Result, ResultAsync, err, ok } from "neverthrow";
import { ExecutorError } from "./errors.js";
import { type ExecutionRecord, applyTransition, withError, withEvidence } from "./execution.js";
import { SWAP_RETRY_DELAYS_MS } from "./orchestrating.js";
import { loadExecution, saveExecution } from "./persistence.js";
import { makeBalanceGuard } from "./swap-guard.js";
import { runSwap } from "./swapping.js";

export type ResumeAction = "none" | "closed" | "swapped" | "bridged_and_swapped";

export type ResumeExecutionParams = {
  id: string;
  apiKey: string;
  entitySecret: string;
  baseDir?: string;
};

export type ResumeExecutionDeps = {
  loadExecution: typeof loadExecution;
  saveExecution: typeof saveExecution;
  runSwap: typeof runSwap;
  swapOnArc: typeof swapOnArc;
  retryBridge: typeof retryBridge;
  getTokenBalances: typeof getTokenBalances;
  sleep?: (ms: number) => Promise<void>;
};

export type ResumeExecutionResult = {
  record: ExecutionRecord;
  action: ResumeAction;
};

/**
 * Continues a persisted execution after an interruption (CLAUDE.md §6.5).
 *
 * - completed / failed_funds_safe: terminal, nothing to do.
 * - created / preflight: no funds have moved; the record is closed as
 *   failed_funds_safe.
 * - burning / awaiting_attestation / minting with a saved bridge result: the
 *   bridge failed after the burn; App Kit's retryBridge finishes it (no second
 *   burn), then the swap runs as below.
 * - burning / awaiting_attestation without one: the process stopped while a
 *   burn may be in flight; RESUME_UNSUPPORTED, the record's evidence is the
 *   operator's starting point.
 * - minting: if the bridged USDC is confirmed on Arc, the swap runs with the
 *   same balance-guarded retries as a fresh execution.
 * - swapping: an earlier attempt may have executed; never retried blindly.
 */
export function resumeExecution(
  params: ResumeExecutionParams,
  deps: ResumeExecutionDeps = {
    loadExecution,
    saveExecution,
    runSwap,
    swapOnArc,
    retryBridge,
    getTokenBalances,
  },
): ResultAsync<ResumeExecutionResult, ExecutorError> {
  return new ResultAsync(executeResume(params, deps));
}

function unsupported(record: ExecutionRecord, reason: string): Result<never, ExecutorError> {
  return err(
    new ExecutorError(
      `Cannot resume ${record.id} (${record.state}): ${reason}`,
      "RESUME_UNSUPPORTED",
    ),
  );
}

async function executeResume(
  params: ResumeExecutionParams,
  deps: ResumeExecutionDeps,
): Promise<Result<ResumeExecutionResult, ExecutorError>> {
  const loaded = await deps.loadExecution(params.id, params.baseDir);
  if (loaded.isErr()) return err(loaded.error);
  let record = loaded.value;
  let bridged = false;

  const inBridge =
    record.state === "burning" ||
    record.state === "awaiting_attestation" ||
    record.state === "minting";
  if (inBridge && record.bridgeRaw !== undefined) {
    const finished = await finishBridge(record, params, deps);
    if (finished.isErr()) return err(finished.error);
    record = finished.value;
    bridged = true;
  }

  switch (record.state) {
    case "completed":
    case "failed_funds_safe":
      return ok({ record, action: "none" });

    case "created":
    case "preflight": {
      const closed = applyTransition(
        withError(record, "Abandoned before any funds moved; closed on resume."),
        "failed_funds_safe",
      );
      if (closed.isErr()) return err(closed.error);
      const saved = await deps.saveExecution(closed.value, params.baseDir);
      if (saved.isErr()) return err(saved.error);
      return ok({ record: saved.value, action: "closed" });
    }

    case "burning":
    case "awaiting_attestation":
      return unsupported(
        record,
        "a CCTP transfer may be in flight; check the recorded burn tx and the destination wallet before acting",
      );

    case "swapping":
      return unsupported(
        record,
        "an earlier swap attempt may have executed; verify the Arc wallet on-chain",
      );

    case "minting": {
      const plan = record.plan;
      if (!plan?.arcWalletId) {
        return unsupported(record, "the record has no swap plan with an Arc wallet id");
      }
      const guard = await makeBalanceGuard({
        walletId: plan.arcWalletId,
        token: plan.tokenIn,
        amountIn: plan.amountIn,
        getTokenBalances: deps.getTokenBalances,
      });
      if (!guard) {
        // The snapshot fails when the balance is below amountIn, i.e. the
        // mint is not (yet) visible on Arc. Swapping now would fail and then
        // falsely claim the USDC sits on Arc.
        return unsupported(record, `${plan.amountIn} ${plan.tokenIn} is not confirmed on Arc yet`);
      }
      const swapped = await deps.runSwap(
        {
          record,
          fromAddress: plan.arcAddress,
          tokenIn: plan.tokenIn,
          tokenOut: plan.tokenOut,
          amountIn: plan.amountIn,
          apiKey: params.apiKey,
          entitySecret: params.entitySecret,
          ...(plan.slippageBps !== undefined ? { slippageBps: plan.slippageBps } : {}),
          baseDir: params.baseDir,
          retryDelaysMs: SWAP_RETRY_DELAYS_MS,
        },
        {
          swapOnArc: deps.swapOnArc,
          saveExecution: deps.saveExecution,
          checkUnswapped: guard,
          ...(deps.sleep ? { sleep: deps.sleep } : {}),
        },
      );
      if (swapped.isErr()) return err(swapped.error);
      return ok({
        record: swapped.value.record,
        action: bridged ? "bridged_and_swapped" : "swapped",
      });
    }
  }
}

/**
 * Completes a bridge that failed after its burn, using the App Kit result
 * saved on the record, and moves the record to "minting" with the new tx
 * hashes. On another failure the newer App Kit result replaces the saved one.
 */
async function finishBridge(
  record: ExecutionRecord,
  params: ResumeExecutionParams,
  deps: ResumeExecutionDeps,
): Promise<Result<ExecutionRecord, ExecutorError>> {
  const retried = await deps.retryBridge(record.bridgeRaw);
  if (retried.isErr()) {
    const raw = retried.error instanceof BridgeFailure ? retried.error.raw : record.bridgeRaw;
    const saved = await deps.saveExecution(
      { ...withError(record, `Bridge retry failed: ${retried.error.message}`), bridgeRaw: raw },
      params.baseDir,
    );
    if (saved.isErr()) return err(saved.error);
    return err(
      new ExecutorError(
        `Bridge retry failed: ${retried.error.message}`,
        "BRIDGE_FAILED",
        retried.error,
      ),
    );
  }

  let current = record;
  for (const next of ["awaiting_attestation", "minting"] as const) {
    if (current.state === "minting") break;
    if (current.state === next) continue;
    const moved = applyTransition(current, next);
    if (moved.isErr()) return err(moved.error);
    current = moved.value;
  }
  const known = new Set((current.evidence ?? []).map((e) => e.txHash));
  current = withEvidence(
    current,
    retried.value.steps
      .filter((step) => step.txHash && !known.has(step.txHash))
      .map((step) => ({ step: step.name, txHash: step.txHash })),
  );
  const { bridgeRaw: _done, ...rest } = current;
  const saved = await deps.saveExecution({ ...rest, error: null }, params.baseDir);
  if (saved.isErr()) return err(saved.error);
  return ok(saved.value);
}
