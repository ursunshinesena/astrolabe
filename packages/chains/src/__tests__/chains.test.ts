import { describe, expect, it } from "vitest";

import * as chains from "../index.js";

describe("@astrolabe/chains exports", () => {
  it("loads the module without errors", () => {
    expect(chains).toBeDefined();
  });

  it("exposes the expected runtime exports", () => {
    expect(chains.SUPPORTED_CHAINS).toBeDefined();
    expect(chains.CCTP_DOMAIN_IDS).toBeDefined();
    expect(chains.CIRCLE_CHAIN_NAMES).toBeDefined();
    expect(chains.USDC_ADDRESSES).toBeDefined();
    expect(chains.UNISWAP_V3_ADDRESSES).toBeDefined();
    expect(chains.arcTestnet).toBeDefined();
    expect(typeof chains.createRpcClient).toBe("function");
  });
});
