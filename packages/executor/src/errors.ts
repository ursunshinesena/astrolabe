export type ExecutorErrorCode =
  | "INVALID_TRANSITION"
  | "PERSISTENCE_FAILURE"
  | "PREFLIGHT_FAILED"
  | "BRIDGE_FAILED";

/** The bridgeUSDC step a BRIDGE_FAILED error is attributed to. */
export type BridgeStepName = "approve" | "burn" | "fetchAttestation" | "mint";

export class ExecutorError extends Error {
  constructor(
    message: string,
    public readonly code: ExecutorErrorCode,
    public readonly cause?: unknown,
    public readonly failedStep?: BridgeStepName,
  ) {
    super(message);
    this.name = "ExecutorError";
  }
}
