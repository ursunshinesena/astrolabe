import { err, ok, okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";
import { type ExecutionRecord, applyTransition, createExecution } from "../execution.js";
import { recordReputation } from "../reputation.js";

function completed(): ExecutionRecord {
  let record = createExecution();
  for (const s of ["preflight", "swapping", "completed"] as const) {
    record = applyTransition(record, s)._unsafeUnwrap();
  }
  return {
    ...record,
    evidence: [
      { step: "swap", txHash: "0xswap", explorerUrl: "https://testnet.arcscan.app/tx/0xswap" },
    ],
  };
}

const save = vi.fn((r: ExecutionRecord) => okAsync(r));

describe("recordReputation", () => {
  it("rates the agent with a pointer to the swap and records the tx as evidence", async () => {
    const give = vi.fn(async () => ok("0xrep"));
    const out = await recordReputation(
      { record: completed(), agentId: "42", validatorWalletId: "v" },
      { giveAgentFeedback: give, saveExecution: save },
    );
    expect(give).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "42",
        feedbackURI: "https://testnet.arcscan.app/tx/0xswap",
      }),
    );
    expect(out._unsafeUnwrap().evidence?.at(-1)).toMatchObject({
      step: "reputation",
      txHash: "0xrep",
    });
    expect(out._unsafeUnwrap().state).toBe("completed");
  });

  it("does nothing for unfinished or already-rated executions", async () => {
    const give = vi.fn(async () => ok("0xrep"));
    const deps = { giveAgentFeedback: give, saveExecution: save };
    const unfinished = applyTransition(createExecution(), "preflight")._unsafeUnwrap();
    await recordReputation({ record: unfinished, agentId: "1", validatorWalletId: "v" }, deps);
    const rated = {
      ...completed(),
      evidence: [...(completed().evidence ?? []), { step: "reputation", txHash: "0x1" }],
    };
    await recordReputation({ record: rated, agentId: "1", validatorWalletId: "v" }, deps);
    expect(give).not.toHaveBeenCalled();
  });

  it("reports a failed rating without touching the record's state", async () => {
    const out = await recordReputation(
      { record: completed(), agentId: "1", validatorWalletId: "v" },
      { giveAgentFeedback: async () => err(new Error("no gas")), saveExecution: save },
    );
    expect(out._unsafeUnwrapErr().message).toContain("no gas");
  });
});
