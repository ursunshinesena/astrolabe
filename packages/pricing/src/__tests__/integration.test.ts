/**
 * Integration tests — hit real testnet RPC endpoints.
 * Requires env vars to be set; skipped automatically in CI.
 *
 * To run locally:
 *   ETH_SEPOLIA_RPC_URL=https://... BASE_SEPOLIA_RPC_URL=https://... pnpm test
 */
import { describe, expect, it } from "vitest";
import { getQuote } from "../get-quote.js";
import { getUniswapV3Quote } from "../quoters/uniswap-v3.js";
import { buildRouteOptions, compareRoutes } from "../routing.js";

const SEPOLIA_RPC = process.env.ETH_SEPOLIA_RPC_URL;
const BASE_RPC = process.env.BASE_SEPOLIA_RPC_URL;

describe.skipIf(!SEPOLIA_RPC)("integration: Ethereum Sepolia (real RPC)", () => {
  it("getUniswapV3Quote returns a positive amountOut for USDC → WETH", async () => {
    const quote = await getUniswapV3Quote({
      chainKey: "ETHEREUM_SEPOLIA",
      tokenIn: "USDC",
      tokenOut: "WETH",
      amountIn: "1",
      rpcUrl: SEPOLIA_RPC,
    });

    expect(quote.chainKey).toBe("ETHEREUM_SEPOLIA");
    expect(quote.source).toBe("uniswap-v3");
    expect(Number(quote.amountOut)).toBeGreaterThan(0);
    expect(Number(quote.gasEstimateWei)).toBeGreaterThan(0);
  }, 15_000);

  it("getQuote dispatcher routes to Uniswap V3 and returns a valid quote", async () => {
    const result = await getQuote({
      chainKey: "ETHEREUM_SEPOLIA",
      tokenIn: "USDC",
      tokenOut: "WETH",
      amountIn: "10",
      rpcUrl: SEPOLIA_RPC,
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(Number(result.value.amountOut)).toBeGreaterThan(0);
    }
  }, 15_000);
});

describe.skipIf(!SEPOLIA_RPC || !BASE_RPC)("integration: compareRoutes with 2 real chains", () => {
  it("produces a valid BestRoute from Sepolia + Base Sepolia quotes", async () => {
    const [sepoliaResult, baseResult] = await Promise.all([
      getUniswapV3Quote({
        chainKey: "ETHEREUM_SEPOLIA",
        tokenIn: "USDC",
        tokenOut: "WETH",
        amountIn: "10",
        rpcUrl: SEPOLIA_RPC,
      }),
      getUniswapV3Quote({
        chainKey: "BASE_SEPOLIA",
        tokenIn: "USDC",
        tokenOut: "WETH",
        amountIn: "10",
        rpcUrl: BASE_RPC,
      }),
    ]);

    const options = buildRouteOptions({
      sourceChain: "ETHEREUM_SEPOLIA",
      quotes: {
        ETHEREUM_SEPOLIA: sepoliaResult,
        BASE_SEPOLIA: baseResult,
      },
    });

    const { winner, allOptions } = compareRoutes(options);

    expect(allOptions).toHaveLength(2);
    expect(["swap_only", "bridge_then_swap"]).toContain(winner.strategy);
    expect(Number(winner.netAmountOut)).toBeGreaterThan(0);
    // Winner is first — highest netAmountOut
    expect(Number(allOptions[0]?.netAmountOut)).toBeGreaterThanOrEqual(
      Number(allOptions[1]?.netAmountOut),
    );
  }, 20_000);
});
