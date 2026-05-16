import { describe, it, expect, vi, beforeEach } from "vitest";
import { getArcQuote } from "../quoters/arc.js";
import { QuoteError } from "../types.js";

const MOCK_ESTIMATE_SWAP = vi.fn().mockResolvedValue({
  estimatedOutput: { amount: "0.049", token: "WETH" },
  stopLimit: { amount: "0.047", token: "WETH" },
  fees: [{ token: "USDC", amount: "0.10", type: "provider" }],
});

vi.mock("@circle-fin/app-kit", () => ({
  AppKit: vi.fn().mockImplementation(() => ({
    estimateSwap: MOCK_ESTIMATE_SWAP,
  })),
}));

vi.mock("@circle-fin/adapter-circle-wallets", () => ({
  createCircleWalletsAdapter: vi.fn().mockReturnValue({ type: "circle-wallets" }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  MOCK_ESTIMATE_SWAP.mockResolvedValue({
    estimatedOutput: { amount: "0.049", token: "WETH" },
    stopLimit: { amount: "0.047", token: "WETH" },
    fees: [],
  });
});

describe("getArcQuote", () => {
  const BASE_PARAMS = {
    fromAddress: "0xTestAddress",
    tokenIn: "USDC",
    tokenOut: "WETH",
    amountIn: "100",
    apiKey: "test-api-key",
    entitySecret: "test-entity-secret",
  };

  it("returns a valid quote for Arc Testnet (USDC → WETH)", async () => {
    const quote = await getArcQuote(BASE_PARAMS);

    expect(quote.chainKey).toBe("ARC_TESTNET");
    expect(quote.tokenIn).toBe("USDC");
    expect(quote.tokenOut).toBe("WETH");
    expect(quote.amountIn).toBe("100");
    expect(quote.amountOut).toBe("0.049");
    // Arc gas is USDC — no ETH gas estimate
    expect(quote.gasEstimateWei).toBe("0");
    expect(quote.source).toBe("arc-app-kit");
  });

  it("normalises token symbols to uppercase", async () => {
    const quote = await getArcQuote({ ...BASE_PARAMS, tokenIn: "usdc", tokenOut: "weth" });
    expect(quote.tokenIn).toBe("USDC");
    expect(quote.tokenOut).toBe("WETH");
  });

  it("passes fromAddress and credentials to the adapter", async () => {
    const { createCircleWalletsAdapter } = await import("@circle-fin/adapter-circle-wallets");
    await getArcQuote(BASE_PARAMS);
    expect(createCircleWalletsAdapter).toHaveBeenCalledWith({
      apiKey: "test-api-key",
      entitySecret: "test-entity-secret",
    });
  });

  it("throws QuoteError for an unsupported tokenIn", async () => {
    await expect(
      getArcQuote({ ...BASE_PARAMS, tokenIn: "DOGE" }),
    ).rejects.toBeInstanceOf(QuoteError);
  });

  it("throws QuoteError for an unsupported tokenOut", async () => {
    await expect(
      getArcQuote({ ...BASE_PARAMS, tokenOut: "SHIB" }),
    ).rejects.toBeInstanceOf(QuoteError);
  });
});
