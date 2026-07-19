import { describe, expect, it } from "vitest";
import { EXECUTOR_STATES } from "../index.js";

describe("@astrolabe/executor scaffold", () => {
  it("exports the executor state list", () => {
    expect(EXECUTOR_STATES).toContain("created");
    expect(EXECUTOR_STATES).toContain("failed_funds_safe");
  });
});
