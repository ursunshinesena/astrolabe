/**
 * @astrolabe/executor — guarded cross-chain execution engine.
 *
 * Scaffold only. State machine, persistence, and CCTP flow
 * will be implemented in M4a follow-up PRs.
 */

export const EXECUTOR_STATES = [
  "created",
  "preflight",
  "burning",
  "awaiting_attestation",
  "minting",
  "swapping",
  "completed",
  "failed_funds_safe",
] as const;

export type ExecutorState = (typeof EXECUTOR_STATES)[number];
