import { describe, it, expect } from "vitest";

import * as circle from "../index.js";

describe("@agora/circle exports", () => {
  it("loads the module without errors", () => {
    expect(circle).toBeDefined();
  });

  it("exposes the expected runtime exports", () => {
    expect(typeof circle.createWallet).toBe("function");
    expect(typeof circle.createWalletSet).toBe("function");
    expect(typeof circle.getTokenBalances).toBe("function");
    expect(typeof circle.pollTransaction).toBe("function");
    expect(typeof circle.bridgeUSDC).toBe("function");
    expect(circle.CIRCLE_BLOCKCHAIN).toBeDefined();
    expect(circle.APPKIT_CHAIN).toBeDefined();
  });
});
