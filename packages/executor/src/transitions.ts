import { type Result, err, ok } from "neverthrow";
import { ExecutorError } from "./errors.js";
import type { ExecutorState } from "./states.js";

export const TRANSITIONS: Record<ExecutorState, readonly ExecutorState[]> = {
  created: ["preflight", "failed_funds_safe"],
  preflight: ["burning", "failed_funds_safe"],
  burning: ["awaiting_attestation", "failed_funds_safe"],
  awaiting_attestation: ["minting", "failed_funds_safe"],
  minting: ["swapping", "failed_funds_safe"],
  swapping: ["completed", "failed_funds_safe"],
  completed: [],
  failed_funds_safe: [],
};

export function canTransition(from: ExecutorState, to: ExecutorState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function transition(
  from: ExecutorState,
  to: ExecutorState,
): Result<ExecutorState, ExecutorError> {
  if (!canTransition(from, to)) {
    return err(new ExecutorError(`Invalid transition: ${from} -> ${to}`, "INVALID_TRANSITION"));
  }
  return ok(to);
}
