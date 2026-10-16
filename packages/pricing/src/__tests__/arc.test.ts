import { beforeEach, describe, expect, it, vi } from "vitest";
import { getArcQuote } from "../quoters/arc.js";
import { QuoteError } from "../types.js";

const MOCK_ESTIMATE_SWAP = vi.fn().mockResolvedValue({
  estimatedOutput: { amount: "8.6", token: "EURC" },
  stopLimit: { amount: "8.4", token: "EURC" },
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
    estimatedOutput: { amount: "8.6", token: "EURC" },
    stopLimit: { amount: "8.4", token: "EURC" },
    fees: [],
  });
});

describe("getArcQuote", () => {
  const BASE_PARAMS = {
    fromAddress: "0xTestAddress",
    tokenIn: "USDC",
    tokenOut: "EURC",
    amountIn: "100",
    apiKey: "test-api-key",
    entitySecret: "test-entity-secret",
  };

  it("returns a valid quote for Arc Testnet (USDC → EURC)", async () => {
    const quote = await getArcQuote(BASE_PARAMS);

    expect(quote.chainKey).toBe("ARC_TESTNET");
    expect(quote.tokenIn).toBe("USDC");
    expect(quote.tokenOut).toBe("EURC");
    expect(quote.amountIn).toBe("100");
    expect(quote.amountOut).toBe("8.6");
    // Arc gas is USDC — no ETH gas estimate
    expect(quote.gasEstimateWei).toBe("0");
    expect(quote.source).toBe("arc-app-kit");
  });

  it("normalises token symbols to uppercase", async () => {
    const quote = await getArcQuote({ ...BASE_PARAMS, tokenIn: "usdc", tokenOut: "eurc" });
    expect(quote.tokenIn).toBe("USDC");
    expect(quote.tokenOut).toBe("EURC");
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
    await expect(getArcQuote({ ...BASE_PARAMS, tokenIn: "DOGE" })).rejects.toBeInstanceOf(
      QuoteError,
    );
  });

  it("throws QuoteError for an unsupported tokenOut", async () => {
    await expect(getArcQuote({ ...BASE_PARAMS, tokenOut: "SHIB" })).rejects.toBeInstanceOf(
      QuoteError,
    );
  });
});
