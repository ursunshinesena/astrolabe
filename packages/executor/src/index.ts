/**
 * @astrolabe/executor — guarded cross-chain execution engine.
 *
 * State machine + JSON persistence, CCTP bridge -> Arc swap orchestration,
 * balance-guarded swap retries and resume after interruption.
 */

export {
  type BridgeStepName,
  ExecutorError,
  type ExecutorErrorCode,
} from "./errors.js";
export {
  applyTransition,
  createExecution,
  type EvidenceRecord,
  type ExecutionRecord,
  type SwapPlan,
  type TransitionRecord,
  withError,
  withEvidence,
} from "./execution.js";
export {
  runBridge,
  type RunBridgeDeps,
  type RunBridgeParams,
  type RunBridgeResult,
} from "./bridging.js";
export {
  runExecution,
  SWAP_RETRY_DELAYS_MS,
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
  type ResumeAction,
  type ResumeExecutionDeps,
  type ResumeExecutionParams,
  type ResumeExecutionResult,
  resumeExecution,
} from "./resume.js";
export { makeBalanceGuard } from "./swap-guard.js";
export {
  runSwap,
  type RunSwapDeps,
  type RunSwapParams,
  type RunSwapResult,
} from "./swapping.js";
export { EXECUTOR_STATES, type ExecutorState } from "./states.js";
export { canTransition, TRANSITIONS, transition } from "./transitions.js";
