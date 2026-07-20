import { describe, expect, it } from "vitest";
import { applyTransition, createExecution } from "../execution.js";

const NOW = new Date("2026-07-20T12:34:56.789Z");

describe("createExecution", () => {
  it("creates a record in state 'created' with empty history and null error", () => {
    const record = createExecution(NOW);
    expect(record.state).toBe("created");
    expect(record.history).toEqual([]);
    expect(record.error).toBeNull();
    expect(record.createdAt).toBe("2026-07-20T12:34:56.789Z");
    expect(record.updatedAt).toBe("2026-07-20T12:34:56.789Z");
  });

  it("formats the id as exec_<sanitized ISO>_<6 hex chars>", () => {
    const record = createExecution(NOW);
    expect(record.id).toMatch(/^exec_2026-07-20T12-34-56-789Z_[0-9a-f]{6}$/);
  });

  it("generates unique ids for the same timestamp", () => {
    const a = createExecution(NOW);
    const b = createExecution(NOW);
    expect(a.id).not.toBe(b.id);
  });
});

describe("applyTransition", () => {
  it("returns a new record with updated state, updatedAt, and appended history", () => {
    const record = createExecution(NOW);
    const later = new Date("2026-07-20T12:35:00.000Z");
    const result = applyTransition(record, "preflight", later);
    expect(result.isOk()).toBe(true);
    const next = result._unsafeUnwrap();
    expect(next.state).toBe("preflight");
    expect(next.updatedAt).toBe("2026-07-20T12:35:00.000Z");
    expect(next.createdAt).toBe(record.createdAt);
    expect(next.id).toBe(record.id);
    expect(next.history).toEqual([
      { from: "created", to: "preflight", at: "2026-07-20T12:35:00.000Z" },
    ]);
  });

  it("does not mutate the input record", () => {
    const record = createExecution(NOW);
    const result = applyTransition(record, "preflight");
    expect(result.isOk()).toBe(true);
    expect(record.state).toBe("created");
    expect(record.history).toEqual([]);
    expect(record.updatedAt).toBe("2026-07-20T12:34:56.789Z");
    expect(result._unsafeUnwrap()).not.toBe(record);
    expect(result._unsafeUnwrap().history).not.toBe(record.history);
  });

  it("appends one history entry per transition through the happy path", () => {
    let record = createExecution(NOW);
    const path = [
      "preflight",
      "burning",
      "awaiting_attestation",
      "minting",
      "swapping",
      "completed",
    ] as const;
    for (const to of path) {
      record = applyTransition(record, to)._unsafeUnwrap();
    }
    expect(record.state).toBe("completed");
    expect(record.history).toHaveLength(path.length);
    expect(record.history.map((h) => h.to)).toEqual([...path]);
  });

  it("rejects an illegal transition with INVALID_TRANSITION and leaves the record untouched", () => {
    const record = createExecution(NOW);
    const result = applyTransition(record, "swapping");
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe("INVALID_TRANSITION");
    expect(record.state).toBe("created");
    expect(record.history).toEqual([]);
  });
});
