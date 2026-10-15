import { describe, expect, it } from "vitest";
import { evidenceStep, formatAmount, shortHash, stepStatuses } from "../format";

describe("stepStatuses", () => {
  it("marks earlier steps done and the current one active", () => {
    expect(stepStatuses({ state: "awaiting_attestation", history: [] })).toEqual([
      "done",
      "done",
      "active",
      "waiting",
      "waiting",
    ]);
    expect(stepStatuses({ state: "completed", history: [] })).toEqual(Array(5).fill("done"));
  });

  it("marks the step that failed", () => {
    const history = [{ from: "swapping" as const, to: "failed_funds_safe" as const, at: "t" }];
    expect(stepStatuses({ state: "failed_funds_safe", history })).toEqual([
      "done",
      "done",
      "done",
      "done",
      "failed",
    ]);
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
