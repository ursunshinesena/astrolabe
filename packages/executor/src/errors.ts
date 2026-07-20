export type ExecutorErrorCode = "INVALID_TRANSITION" | "PERSISTENCE_FAILURE";

export class ExecutorError extends Error {
  constructor(
    message: string,
    public readonly code: ExecutorErrorCode,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ExecutorError";
  }
}
