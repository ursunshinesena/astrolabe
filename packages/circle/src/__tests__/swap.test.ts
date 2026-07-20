import { beforeEach, describe, expect, it, vi } from "vitest";
import { swapOnArc } from "../swap.js";

const MOCK_SWAP = vi.fn();

vi.mock("@circle-fin/app-kit", () => ({
  AppKit: vi.fn().mockImplementation(() => ({
    swap: MOCK_SWAP,
  })),
}));

vi.mock("@circle-fin/adapter-circle-wallets", () => ({
  createCircleWalletsAdapter: vi.fn().mockReturnValue({ type: "circle-wallets" }),
}));

const FULL_RESULT = {
  tokenIn: "USDC",
  tokenOut: "WETH",
  chain: "Arc_Testnet",
  amountIn: "100",
  amountOut: "0.049",
  fromAddress: "0xTestAddress",
  toAddress: "0xTestAddress",
  txHash: "0xabc123",
  explorerUrl: "https://testnet.arcscan.app/tx/0xabc123",
};

beforeEach(() => {
  vi.clearAllMocks();
  MOCK_SWAP.mockResolvedValue(FULL_RESULT);
});

describe("swapOnArc", () => {
  const BASE_PARAMS = {
    fromAddress: "0xTestAddress",
    tokenIn: "USDC",
    tokenOut: "WETH",
    amountIn: "100",
    apiKey: "test-api-key",
    entitySecret: "test-entity-secret",
  };

  it("returns the mapped result for a successful swap", async () => {
    const result = await swapOnArc(BASE_PARAMS);

    expect(result).toEqual({
      txHash: "0xabc123",
      amountIn: "100",
      amountOut: "0.049",
      explorerUrl: "https://testnet.arcscan.app/tx/0xabc123",
    });
  });

  it("passes credentials to the adapter and swap params to the kit", async () => {
    const { createCircleWalletsAdapter } = await import("@circle-fin/adapter-circle-wallets");
    await swapOnArc(BASE_PARAMS);

    expect(createCircleWalletsAdapter).toHaveBeenCalledWith({
      apiKey: "test-api-key",
      entitySecret: "test-entity-secret",
    });
    expect(MOCK_SWAP).toHaveBeenCalledWith(
      expect.objectContaining({
        tokenIn: "USDC",
        tokenOut: "WETH",
        amountIn: "100",
        config: { slippageBps: 300 },
      }),
    );
  });

  it("uppercases token symbols before validating and swapping", async () => {
    await swapOnArc({ ...BASE_PARAMS, tokenIn: "usdc", tokenOut: "weth" });

    expect(MOCK_SWAP).toHaveBeenCalledWith(
      expect.objectContaining({ tokenIn: "USDC", tokenOut: "WETH" }),
    );
  });

  it("throws for an unsupported tokenIn without calling swap", async () => {
    await expect(swapOnArc({ ...BASE_PARAMS, tokenIn: "DOGE" })).rejects.toThrow(
      "Unsupported tokenIn for Arc: DOGE",
    );
    expect(MOCK_SWAP).not.toHaveBeenCalled();
  });

  it("throws for an unsupported tokenOut without calling swap", async () => {
    await expect(swapOnArc({ ...BASE_PARAMS, tokenOut: "SHIB" })).rejects.toThrow(
      "Unsupported tokenOut for Arc: SHIB",
    );
    expect(MOCK_SWAP).not.toHaveBeenCalled();
  });

  it("defaults slippageBps to 300 when omitted", async () => {
    await swapOnArc(BASE_PARAMS);

    expect(MOCK_SWAP).toHaveBeenCalledWith(
      expect.objectContaining({ config: { slippageBps: 300 } }),
    );
  });

  it("forwards an explicit slippageBps", async () => {
    await swapOnArc({ ...BASE_PARAMS, slippageBps: 50 });

    expect(MOCK_SWAP).toHaveBeenCalledWith(
      expect.objectContaining({ config: { slippageBps: 50 } }),
    );
  });

  it("leaves optional fields undefined when absent from the SDK result", async () => {
    MOCK_SWAP.mockResolvedValue({
      tokenIn: "USDC",
      tokenOut: "WETH",
      chain: "Arc_Testnet",
      amountIn: "100",
      fromAddress: "0xTestAddress",
      toAddress: "0xTestAddress",
      txHash: "0xabc123",
      // amountOut and explorerUrl absent
    });

    const result = await swapOnArc(BASE_PARAMS);

    expect(result.txHash).toBe("0xabc123");
    expect(result.amountIn).toBe("100");
    expect(result.amountOut).toBeUndefined();
    expect(result.explorerUrl).toBeUndefined();
  });

  it("propagates errors thrown by the SDK swap call", async () => {
    MOCK_SWAP.mockRejectedValue(new Error("swap reverted on-chain"));

    await expect(swapOnArc(BASE_PARAMS)).rejects.toThrow("swap reverted on-chain");
  });
});
