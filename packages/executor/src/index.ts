/**
 * @astrolabe/executor — guarded cross-chain execution engine.
 *
 * State machine + JSON persistence for the M4a executor core.
 * CCTP flow (burn → attestation → mint → swap) lands in follow-up PRs.
 */

export {
  type BridgeStepName,
  ExecutorError,
  type ExecutorErrorCode,
} from "./errors.js";
export {
  applyTransition,
  createExecution,
  type ExecutionRecord,
  type TransitionRecord,
} from "./execution.js";
export {
  runBridge,
  type RunBridgeDeps,
  type RunBridgeParams,
  type RunBridgeResult,
} from "./bridging.js";
export {
  runExecution,
  type RunExecutionDeps,
  type RunExecutionParams,
  type RunExecutionResult,
} from "./orchestrating.js";
export { loadExecution, saveExecution } from "./persistence.js";
export {
  type PreflightCheck,
  type PreflightCheckName,
  type PreflightDeps,
  type PreflightParams,
  type PreflightReport,
  runPreflight,
} from "./preflight.js";
export {
  runSwap,
  type RunSwapDeps,
  type RunSwapParams,
  type RunSwapResult,
} from "./swapping.js";
export { EXECUTOR_STATES, type ExecutorState } from "./states.js";
export { canTransition, TRANSITIONS, transition } from "./transitions.js";
