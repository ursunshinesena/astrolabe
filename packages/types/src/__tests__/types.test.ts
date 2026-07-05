import { describe, expect, it } from "vitest";

import * as types from "../index.js";

describe("@astrolabe/types exports", () => {
  it("loads the module without errors", () => {
    expect(types).toBeDefined();
  });

  it("exposes the expected runtime exports", () => {
    expect(types.IntentSchema).toBeDefined();
    expect(types.ParsedIntentSchema).toBeDefined();
    expect(types.RouteSchema).toBeDefined();
    expect(types.ExecutionStatusSchema).toBeDefined();
    expect(types.ExecutionResultSchema).toBeDefined();
  });
});
