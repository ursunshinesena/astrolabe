import { randomBytes } from "node:crypto";
import type { Result } from "neverthrow";
import type { ExecutorError } from "./errors.js";
import type { ExecutorState } from "./states.js";
import { transition } from "./transitions.js";

export type TransitionRecord = {
  from: ExecutorState;
  to: ExecutorState;
  at: string;
};

export type ExecutionRecord = {
  id: string;
  state: ExecutorState;
  createdAt: string;
  updatedAt: string;
  history: TransitionRecord[];
  error: string | null;
};

export function createExecution(now: Date = new Date()): ExecutionRecord {
  const iso = now.toISOString();
  const id = `exec_${iso.replace(/[:.]/g, "-")}_${randomBytes(3).toString("hex")}`;
  return {
    id,
    state: "created",
    createdAt: iso,
    updatedAt: iso,
    history: [],
    error: null,
  };
}

export function applyTransition(
  record: ExecutionRecord,
  to: ExecutorState,
  now: Date = new Date(),
): Result<ExecutionRecord, ExecutorError> {
  return transition(record.state, to).map((next) => {
    const at = now.toISOString();
    return {
      ...record,
      state: next,
      updatedAt: at,
      history: [...record.history, { from: record.state, to: next, at }],
    };
  });
}
