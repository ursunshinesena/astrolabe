import { giveAgentFeedback } from "@astrolabe/circle";
import { type Result, err, ok } from "neverthrow";
import { ExecutorError } from "./errors.js";
import { type ExecutionRecord, withEvidence } from "./execution.js";
import { saveExecution } from "./persistence.js";

export type ReputationParams = {
  record: ExecutionRecord;
  /** ERC-8004 identity of this agent on Arc. */
  agentId: string;
  /** Wallet that rates the agent (ERC-8004 forbids self-rating by the owner). */
  validatorWalletId: string;
  baseDir?: string;
};

export type ReputationDeps = {
  giveAgentFeedback: typeof giveAgentFeedback;
  saveExecution: typeof saveExecution;
};

/**
 * After a completed execution, writes an ERC-8004 reputation entry on Arc
 * that points at the swap transaction, and adds that transaction to the
 * record's evidence. Best effort: the conversion has already settled, so a
 * failure here is reported but never changes the execution's state.
 */
export async function recordReputation(
  params: ReputationParams,
  deps: ReputationDeps = { giveAgentFeedback, saveExecution },
): Promise<Result<ExecutionRecord, ExecutorError>> {
  const { record } = params;
  if (record.state !== "completed") return ok(record);
  if (record.evidence?.some((e) => e.step === "reputation")) return ok(record);
  const swap = record.evidence?.find((e) => e.step === "swap");
  if (!swap) return ok(record);

  const feedbackURI = swap.explorerUrl ?? `https://testnet.arcscan.app/tx/${swap.txHash}`;
  const sent = await deps.giveAgentFeedback({
    validatorWalletId: params.validatorWalletId,
    agentId: params.agentId,
    executionId: record.id,
    feedbackURI,
  });
  if (sent.isErr()) {
    return err(
      new ExecutorError(`Reputation not recorded: ${sent.error.message}`, "PERSISTENCE_FAILURE"),
    );
  }
  const updated = withEvidence(record, [
    {
      step: "reputation",
      txHash: sent.value,
      explorerUrl: `https://testnet.arcscan.app/tx/${sent.value}`,
    },
  ]);
  const saved = await deps.saveExecution(updated, params.baseDir);
  if (saved.isErr()) return err(saved.error);
  return ok(saved.value);
}
