import { describe, expect, it } from "vitest";
import { EXECUTOR_STATES, type ExecutorState } from "../states.js";
import { TRANSITIONS, canTransition, transition } from "../transitions.js";

const LEGAL: ReadonlyArray<[ExecutorState, ExecutorState]> = [
  ["created", "preflight"],
  ["created", "failed_funds_safe"],
  ["preflight", "burning"],
  ["preflight", "failed_funds_safe"],
  ["burning", "awaiting_attestation"],
  ["burning", "failed_funds_safe"],
  ["awaiting_attestation", "minting"],
  ["awaiting_attestation", "failed_funds_safe"],
  ["minting", "swapping"],
  ["minting", "failed_funds_safe"],
  ["swapping", "completed"],
  ["swapping", "failed_funds_safe"],
];

describe("TRANSITIONS", () => {
  it("matches the designed transition table exactly", () => {
    for (const from of EXECUTOR_STATES) {
      const expected = LEGAL.filter(([f]) => f === from).map(([, t]) => t);
      expect(TRANSITIONS[from]).toEqual(expected);
    }
  });

  it("has terminal states with no outgoing transitions", () => {
    expect(TRANSITIONS.completed).toEqual([]);
    expect(TRANSITIONS.failed_funds_safe).toEqual([]);
  });
});

describe("canTransition / transition", () => {
  it("accepts every legal transition", () => {
    for (const [from, to] of LEGAL) {
      expect(canTransition(from, to)).toBe(true);
      const result = transition(from, to);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe(to);
    }
  });

  it("rejects every illegal transition with INVALID_TRANSITION", () => {
    for (const from of EXECUTOR_STATES) {
      for (const to of EXECUTOR_STATES) {
        if (LEGAL.some(([f, t]) => f === from && t === to)) continue;
        expect(canTransition(from, to)).toBe(false);
        const result = transition(from, to);
        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr().code).toBe("INVALID_TRANSITION");
      }
    }
  });

  it("rejects skipping forward", () => {
    const result = transition("created", "burning");
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe("INVALID_TRANSITION");
  });

  it("rejects going backward", () => {
    const result = transition("minting", "burning");
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe("INVALID_TRANSITION");
  });

  it("rejects leaving terminal states", () => {
    for (const to of EXECUTOR_STATES) {
      expect(transition("completed", to).isErr()).toBe(true);
      expect(transition("failed_funds_safe", to).isErr()).toBe(true);
    }
  });
});
