import { describe, it, expect } from "vitest";
import {
  buildRouteOptions,
  compareRoutes,
  BRIDGE_FEE_FIXED,
} from "../routing.js";
import type { SwapQuote } from "../types.js";

function makeQuote(
  chainKey: SwapQuote["chainKey"],
  amountOut: string,
  amountIn = "100",
): SwapQuote {
  return {
    chainKey,
    tokenIn: "USDC",
    tokenOut: "WETH",
    amountIn,
    amountOut,
    gasEstimateWei: "120000",
    source: "uniswap-v3",
  };
}

const QUOTES = {
  ETHEREUM_SEPOLIA: makeQuote("ETHEREUM_SEPOLIA", "0.04900"),
  BASE_SEPOLIA: makeQuote("BASE_SEPOLIA", "0.04950"),   // best swap rate
  ARC_TESTNET: makeQuote("ARC_TESTNET", "0.04800"),
};

describe("buildRouteOptions", () => {
  it("produces 1 swap_only + 2 bridge_then_swap from 3 quotes", () => {
    const options = buildRouteOptions({
      sourceChain: "ETHEREUM_SEPOLIA",
      quotes: QUOTES,
    });

    expect(options).toHaveLength(3);
    expect(options.filter((o) => o.strategy === "swap_only")).toHaveLength(1);
    expect(options.filter((o) => o.strategy === "bridge_then_swap")).toHaveLength(2);
  });

  it("swap_only has bridgeFee amount of 0 and netAmountOut == amountOut", () => {
    const options = buildRouteOptions({ sourceChain: "ETHEREUM_SEPOLIA", quotes: QUOTES });
    const swapOnly = options.find((o) => o.strategy === "swap_only");

    expect(swapOnly).toBeDefined();
    expect(swapOnly!.bridgeFee.amount).toBe("0");
    expect(swapOnly!.netAmountOut).toBe(QUOTES.ETHEREUM_SEPOLIA.amountOut);
  });

  it("bridge_then_swap netAmountOut is less than raw amountOut (fee deducted)", () => {
    const options = buildRouteOptions({ sourceChain: "ETHEREUM_SEPOLIA", quotes: QUOTES });
    const bridgeOptions = options.filter((o) => o.strategy === "bridge_then_swap");

    for (const opt of bridgeOptions) {
      expect(Number(opt.netAmountOut)).toBeLessThan(Number(opt.swapQuote.amountOut));
    }
  });

  it("uses BRIDGE_FEE_FIXED when no bridgeFee is provided", () => {
    const options = buildRouteOptions({ sourceChain: "ETHEREUM_SEPOLIA", quotes: QUOTES });
    const bridgeOpt = options.find((o) => o.strategy === "bridge_then_swap");

    expect(bridgeOpt!.bridgeFee).toEqual(BRIDGE_FEE_FIXED);
  });

  it("falls back to slippageBps param when swapQuote.slippageBps is absent", () => {
    const options = buildRouteOptions({
      sourceChain: "ETHEREUM_SEPOLIA",
      quotes: QUOTES,
      slippageBps: 500,
    });

    for (const opt of options) {
      expect(opt.expectedSlippageBps).toBe(500);
    }
  });
});

describe("compareRoutes", () => {
  it("SCENARIO A — swap_only wins when source chain has the best rate", () => {
    // Ethereum Sepolia has a better rate than bridge + fee deduction
    const options = buildRouteOptions({
      sourceChain: "ETHEREUM_SEPOLIA",
      quotes: {
        ETHEREUM_SEPOLIA: makeQuote("ETHEREUM_SEPOLIA", "0.05000"), // best
        BASE_SEPOLIA: makeQuote("BASE_SEPOLIA", "0.04900"),
      },
    });

    const { winner } = compareRoutes(options);
    expect(winner.strategy).toBe("swap_only");
    expect(winner.destinationChain).toBe("ETHEREUM_SEPOLIA");
  });

  it("SCENARIO B — bridge_then_swap wins when destination chain has a significantly better rate", () => {
    // Base Sepolia rate is so much better that even after bridge fee it wins
    const options = buildRouteOptions({
      sourceChain: "ETHEREUM_SEPOLIA",
      quotes: {
        ETHEREUM_SEPOLIA: makeQuote("ETHEREUM_SEPOLIA", "0.04000"),
        BASE_SEPOLIA: makeQuote("BASE_SEPOLIA", "0.05500"), // clearly better
      },
    });

    const { winner } = compareRoutes(options);
    expect(winner.strategy).toBe("bridge_then_swap");
    expect(winner.destinationChain).toBe("BASE_SEPOLIA");
  });

  it("allOptions is sorted best → worst by netAmountOut", () => {
    const options = buildRouteOptions({ sourceChain: "ETHEREUM_SEPOLIA", quotes: QUOTES });
    const { allOptions } = compareRoutes(options);

    for (let i = 0; i < allOptions.length - 1; i++) {
      expect(Number(allOptions[i]!.netAmountOut)).toBeGreaterThanOrEqual(
        Number(allOptions[i + 1]!.netAmountOut),
      );
    }
  });

  it("throws when given an empty options array", () => {
    expect(() => compareRoutes([])).toThrow();
  });
});
