import { describe, expect, it } from "vitest";

import * as agent from "../index.js";

describe("@agora/agent exports", () => {
  it("loads the module without errors", () => {
    expect(agent).toBeDefined();
  });

  it("exposes the expected runtime exports", () => {
    expect(typeof agent.parseIntent).toBe("function");
    expect(typeof agent.selectOptimalRoute).toBe("function");
    expect(typeof agent.executeRoute).toBe("function");
  });
});
