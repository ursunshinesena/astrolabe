import { describe, expect, it } from "vitest";
import { evidenceStep, formatAmount, shortHash, stepStatuses, stepsFor } from "../format";

describe("stepStatuses", () => {
  const bridged = stepsFor("BASE_SEPOLIA");

  it("marks earlier steps done and the current one active", () => {
    expect(stepStatuses({ state: "awaiting_attestation", history: [] }, bridged)).toEqual([
      "done",
      "done",
      "active",
      "waiting",
      "waiting",
    ]);
    expect(stepStatuses({ state: "completed", history: [] }, bridged)).toEqual(
      Array(5).fill("done"),
    );
  });

  it("marks the step that failed", () => {
    const history = [{ from: "swapping" as const, to: "failed_funds_safe" as const, at: "t" }];
    expect(stepStatuses({ state: "failed_funds_safe", history }, bridged)).toEqual([
      "done",
      "done",
      "done",
      "done",
      "failed",
    ]);
  });

  it("a swap on Arc has only checks and the swap", () => {
    const onArc = stepsFor("ARC_TESTNET");
    expect(onArc.map((s) => s.key)).toEqual(["preflight", "swap"]);
    expect(stepStatuses({ state: "swapping", history: [] }, onArc)).toEqual(["done", "active"]);
    expect(bridged[1]?.where).toBe("Base Sepolia · CCTP V2");
  });
});

describe("format helpers", () => {
  it("shortens hashes and amounts and maps evidence", () => {
    expect(shortHash("0x1234567890abcdef1234")).toBe("0x123456…ef1234");
    expect(formatAmount("8.123456789")).toBe("8.123457");
    expect(evidenceStep("approve")).toBe("burn");
    expect(evidenceStep("fetchAttestation")).toBeNull();
  });
});
