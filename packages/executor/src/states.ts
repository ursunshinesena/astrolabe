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
