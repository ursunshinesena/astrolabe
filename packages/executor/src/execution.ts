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

/** One on-chain transaction produced by an execution step. */
export type EvidenceRecord = {
  step: string;
  txHash: string;
  explorerUrl?: string;
};

/**
 * What the execution intends to do on the destination chain. Persisted so a
 * resumed execution can finish the swap without the original caller.
 */
export type SwapPlan = {
  arcAddress: string;
  arcWalletId?: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  slippageBps?: number;
};

export type ExecutionRecord = {
  id: string;
  state: ExecutorState;
  createdAt: string;
  updatedAt: string;
  history: TransitionRecord[];
  error: string | null;
  /** On-chain transactions, in the order they happened. */
  evidence?: EvidenceRecord[];
  plan?: SwapPlan;
  /** App Kit's result of a bridge that failed after the burn; input to retryBridge. */
  bridgeRaw?: unknown;
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

/** Returns a copy of the record with evidence appended (txHash-less items dropped). */
export function withEvidence(
  record: ExecutionRecord,
  items: ReadonlyArray<{ step: string; txHash?: string; explorerUrl?: string }>,
): ExecutionRecord {
  const added: EvidenceRecord[] = items
    .filter((i): i is { step: string; txHash: string; explorerUrl?: string } => Boolean(i.txHash))
    .map((i) =>
      i.explorerUrl
        ? { step: i.step, txHash: i.txHash, explorerUrl: i.explorerUrl }
        : { step: i.step, txHash: i.txHash },
    );
  if (added.length === 0) return record;
  return { ...record, evidence: [...(record.evidence ?? []), ...added] };
}

/** Returns a copy of the record with its error message set. */
export function withError(record: ExecutionRecord, message: string): ExecutionRecord {
  return { ...record, error: message };
}
