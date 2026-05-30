import { beforeEach, describe, expect, it, vi } from "vitest";
import { getUniswapV3Quote } from "../quoters/uniswap-v3.js";
import { QuoteError } from "../types.js";

// 0.049 WETH in 18 decimals, gas 120_000
const MOCK_SIMULATE_RESULT = {
  result: [49_000_000_000_000_000n, 0n, 0, 120_000n],
};

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: vi.fn(() => ({
      simulateContract: vi.fn().mockResolvedValue(MOCK_SIMULATE_RESULT),
    })),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getUniswapV3Quote", () => {
  it("returns a valid quote for Ethereum Sepolia (USDC → WETH)", async () => {
    const quote = await getUniswapV3Quote({
      chainKey: "ETHEREUM_SEPOLIA",
      tokenIn: "USDC",
      tokenOut: "WETH",
      amountIn: "100",
    });

    expect(quote.chainKey).toBe("ETHEREUM_SEPOLIA");
    expect(quote.tokenIn).toBe("USDC");
    expect(quote.tokenOut).toBe("WETH");
    expect(quote.amountIn).toBe("100");
    expect(quote.amountOut).toBe("0.049");
    expect(quote.gasEstimateWei).toBe("120000");
    expect(quote.source).toBe("uniswap-v3");
  });

  it("returns a valid quote for Base Sepolia (USDC → WETH)", async () => {
    const quote = await getUniswapV3Quote({
      chainKey: "BASE_SEPOLIA",
      tokenIn: "USDC",
      tokenOut: "WETH",
      amountIn: "50",
    });

    expect(quote.chainKey).toBe("BASE_SEPOLIA");
    expect(quote.source).toBe("uniswap-v3");
    expect(Number(quote.amountOut)).toBeGreaterThan(0);
  });

  it("returns a valid quote for Arbitrum Sepolia (USDC → WETH)", async () => {
    const quote = await getUniswapV3Quote({
      chainKey: "ARBITRUM_SEPOLIA",
      tokenIn: "USDC",
      tokenOut: "WETH",
      amountIn: "200",
    });

    expect(quote.chainKey).toBe("ARBITRUM_SEPOLIA");
    expect(quote.source).toBe("uniswap-v3");
    expect(Number(quote.amountOut)).toBeGreaterThan(0);
  });

  it("accepts ETH as an alias for WETH", async () => {
    const quote = await getUniswapV3Quote({
      chainKey: "ETHEREUM_SEPOLIA",
      tokenIn: "USDC",
      tokenOut: "ETH",
      amountIn: "100",
    });

    expect(quote.tokenOut).toBe("ETH");
    expect(Number(quote.amountOut)).toBeGreaterThan(0);
  });

  it("throws QuoteError for an unknown token symbol", async () => {
    await expect(
      getUniswapV3Quote({
        chainKey: "ETHEREUM_SEPOLIA",
        tokenIn: "USDC",
        tokenOut: "DOGE",
        amountIn: "100",
      }),
    ).rejects.toBeInstanceOf(QuoteError);
  });
});
