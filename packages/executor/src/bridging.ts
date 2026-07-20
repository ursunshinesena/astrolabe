import type { AppKitChain, BridgeResult, BridgeStep } from "@astrolabe/circle";
import { bridgeUSDC } from "@astrolabe/circle";
import { type Result, ResultAsync, err, ok } from "neverthrow";
import { type BridgeStepName, ExecutorError } from "./errors.js";
import { type ExecutionRecord, applyTransition } from "./execution.js";
import { saveExecution } from "./persistence.js";
import type { ExecutorState } from "./states.js";

const BRIDGE_STEP_NAMES = [
  "approve",
  "burn",
  "fetchAttestation",
  "mint",
] as const satisfies readonly BridgeStepName[];

function isBridgeStepName(name: string): name is BridgeStepName {
  return (BRIDGE_STEP_NAMES as readonly string[]).includes(name);
}

// Only "burn" and "fetchAttestation" move the state machine forward here.
// "approve" is part of the burning phase (no transition), and "mint" leaves
// the record in "minting" — the mint -> swapping transition belongs to the
// future orchestrator, not this module.
const STEP_TRANSITIONS: Record<BridgeStepName, ExecutorState | null> = {
  approve: null,
  burn: "awaiting_attestation",
  fetchAttestation: "minting",
  mint: null,
};

export type RunBridgeParams = {
  /**
   * The full ExecutionRecord to drive, not just its id. This module (unlike
   * preflight.ts, which is a stateless set of checks) writes several
   * ExecutionRecord snapshots to disk over the course of one call. Taking
   * the record directly keeps runBridge pure and lets the caller decide how
   * it was obtained (fresh from createExecution, or already loaded via
   * loadExecution) instead of runBridge silently re-fetching it from disk
   * via an implicit loadExecution call with its own failure mode that isn't
   * part of this module's documented error surface.
   */
  record: ExecutionRecord;
  fromChain: AppKitChain;
  toChain: AppKitChain;
  fromAddress: string;
  toAddress: string;
  amount: string;
  /** Passed through to saveExecution; defaults to process.cwd() there. */
  baseDir?: string;
};

export type RunBridgeDeps = {
  bridgeUSDC: typeof bridgeUSDC;
  saveExecution: typeof saveExecution;
};

export type RunBridgeResult = {
  record: ExecutionRecord;
  result: BridgeResult;
};

/**
 * Extract the failed step name from bridgeUSDC's error message, which has
 * the form `Bridge failed at step "<name>": <detail>`. Falls back to "mint"
 * — the furthest/riskiest step this module drives — when the step can't be
 * parsed, so operators double-check the destination chain for a
 * completed-but-unreported mint before retrying, rather than assuming
 * nothing happened.
 */
function parseFailedStep(message: string): BridgeStepName {
  const match = /at step "?([A-Za-z]+)"?/.exec(message);
  const name = match?.[1];
  if (name && isBridgeStepName(name)) return name;
  return "mint";
}

export function runBridge(
  params: RunBridgeParams,
  deps: RunBridgeDeps = { bridgeUSDC, saveExecution },
): ResultAsync<RunBridgeResult, ExecutorError> {
  // executeBridge never rejects (it is wrapped end-to-end in try/catch), so
  // we construct ResultAsync directly from its Result-producing promise
  // rather than ResultAsync.fromPromise/fromSafePromise, which would either
  // double-wrap the Result or require throwing to represent a bridge
  // failure — and item 5 of the design requires a genuine err(...) return
  // for expected bridge failures, not just for unexpected exceptions.
  return new ResultAsync(executeBridge(params, deps));
}

async function executeBridge(
  params: RunBridgeParams,
  deps: RunBridgeDeps,
): Promise<Result<RunBridgeResult, ExecutorError>> {
  let current = params.record;
  try {
    const burning = applyTransition(current, "burning");
    if (burning.isErr()) {
      // The record never left its original (valid) state, so there is
      // nothing to roll back — surface the transition error as-is instead
      // of manufacturing a bridge failure.
      return err(burning.error);
    }
    current = burning.value;

    const initialSave = await deps.saveExecution(current, params.baseDir);
    if (initialSave.isErr()) {
      // Persistence is broken before any on-chain call was made — abort
      // rather than proceed with a burn we can't durably track.
      return err(initialSave.error);
    }
    current = initialSave.value;

    // A mutable holder rather than a bare `let` — TS's control-flow
    // narrowing does not see reassignments made inside the nested closure
    // below when this is read after `await queue`, which would otherwise
    // narrow it to `null` (and its truthy branch to `never`) below.
    const stepFailure: { error: ExecutorError | null } = { error: null };
    // onStep fires synchronously from bridgeUSDC's event emitter, and
    // successive steps (e.g. burn then fetchAttestation) can arrive before
    // the async transition+persist work for an earlier step has settled.
    // Chaining each step's work onto `queue` — a running promise each
    // handler both awaits and replaces — serializes the writes so persisted
    // state always reflects the steps in the order they happened, not the
    // order their I/O happened to finish.
    let queue: Promise<void> = Promise.resolve();

    const onStep = (step: BridgeStep) => {
      queue = queue.then(async () => {
        if (stepFailure.error || step.state !== "success" || !isBridgeStepName(step.name)) {
          return;
        }
        const to = STEP_TRANSITIONS[step.name];
        if (to === null) return;
        const transitioned = applyTransition(current, to);
        if (transitioned.isErr()) {
          stepFailure.error = transitioned.error;
          return;
        }
        current = transitioned.value;
        const saved = await deps.saveExecution(current, params.baseDir);
        if (saved.isErr()) {
          stepFailure.error = saved.error;
        }
      });
    };

    const bridgeOutcome = await deps.bridgeUSDC({
      fromChain: params.fromChain,
      toChain: params.toChain,
      fromAddress: params.fromAddress,
      toAddress: params.toAddress,
      amount: params.amount,
      onStep,
    });

    await queue;

    if (stepFailure.error) {
      return finalizeFailure(current, params, deps, stepFailure.error.message, stepFailure.error);
    }
    if (bridgeOutcome.isErr()) {
      return finalizeFailure(
        current,
        params,
        deps,
        bridgeOutcome.error.message,
        bridgeOutcome.error,
      );
    }

    return ok({ record: current, result: bridgeOutcome.value });
  } catch (e) {
    // Unexpected system errors end in failed_funds_safe too, consistent
    // with the philosophy above: the record is only ever left mid-flight if
    // finalizeFailure itself is unable to transition/persist.
    return finalizeFailure(current, params, deps, e instanceof Error ? e.message : String(e), e);
  }
}

async function finalizeFailure(
  record: ExecutionRecord,
  params: RunBridgeParams,
  deps: RunBridgeDeps,
  message: string,
  cause: unknown,
): Promise<Result<RunBridgeResult, ExecutorError>> {
  const failedStep = parseFailedStep(message);
  try {
    const failed = applyTransition(record, "failed_funds_safe");
    if (failed.isOk()) {
      const saved = await deps.saveExecution(failed.value, params.baseDir);
      if (saved.isErr()) {
        // Failing to durably record "funds are safe" is more dangerous than
        // the triggering bridge error — surface it so the caller knows
        // local state tracking is broken, per the project rule that funds
        // must never be left in an ambiguous state.
        return err(saved.error);
      }
    }
    // If the failed_funds_safe transition itself errs (record already
    // terminal), there is nothing further to persist — fall through and
    // report the original bridge failure below.
  } catch (e) {
    return err(
      new ExecutorError(
        `Bridge failed at step "${failedStep}" and cleanup also failed: ${
          e instanceof Error ? e.message : String(e)
        }`,
        "BRIDGE_FAILED",
        e,
        failedStep,
      ),
    );
  }
  return err(
    new ExecutorError(
      `Bridge failed at step "${failedStep}": ${message}`,
      "BRIDGE_FAILED",
      cause,
      failedStep,
    ),
  );
}
