import { describe, expect, it } from "vitest";
import { type FundingSource, bridgeAmountFor, planFundingRoutes } from "../routing.js";
import type { SwapQuote } from "../types.js";

const FX: SwapQuote = {
  chainKey: "ARC_TESTNET",
  tokenIn: "USDC",
  tokenOut: "EURC",
  amountIn: "5",
  amountOut: "6.38",
  gasEstimateWei: "0",
  source: "arc-app-kit",
};

function source(chain: FundingSource["chain"], over: Partial<FundingSource> = {}): FundingSource {
  return {
    chain,
    walletConfigured: true,
    balance: "100",
    hasNativeGas: true,
    bridgeFee: { amount: "0.02", source: "estimate" },
    ...over,
  };
}

describe("planFundingRoutes", () => {
  it("prefers funds already on Arc: no bridge, no fee", () => {
    const plan = planFundingRoutes({
      fxQuote: FX,
      sources: [source("ETHEREUM_SEPOLIA"), source("ARC_TESTNET")],
    });
    expect(plan.winner).toMatchObject({
      strategy: "swap_only",
      sourceChain: "ARC_TESTNET",
      costUsdc: "0",
      requiredAmount: "5.05",
    });
  });

  it("picks the cheapest bridge when Arc lacks the funds", () => {
    const plan = planFundingRoutes({
      fxQuote: FX,
      sources: [
        source("ARC_TESTNET", { balance: "1" }),
        source("BASE_SEPOLIA", { bridgeFee: { amount: "0.055", source: "estimate" } }),
        source("ETHEREUM_SEPOLIA", { bridgeFee: { amount: "0.0195", source: "estimate" } }),
      ],
    });
    expect(plan.winner).toMatchObject({
      strategy: "bridge_then_swap",
      sourceChain: "ETHEREUM_SEPOLIA",
      requiredAmount: "5.0695",
    });
    expect(plan.routes.map((r) => r.sourceChain)).toEqual([
      "ETHEREUM_SEPOLIA",
      "BASE_SEPOLIA",
      "ARC_TESTNET",
    ]);
    expect(plan.routes.at(-1)?.reason).toBe("Needs 5.05 USDC, has 1");
  });

  it("explains every infeasible source and has no winner when none can run", () => {
    const plan = planFundingRoutes({
      fxQuote: FX,
      sources: [
        source("ARBITRUM_SEPOLIA", { walletConfigured: false }),
        source("BASE_SEPOLIA", { hasNativeGas: false }),
        source("ETHEREUM_SEPOLIA", { balance: null, error: "rpc down" }),
      ],
    });
    expect(plan.winner).toBeNull();
    expect(plan.routes.map((r) => r.reason)).toEqual([
      "No wallet on this chain",
      "No native gas for approve and burn",
      "rpc down",
    ]);
  });

  it("only routes EURC from Arc, and needs no USDC gas reserve on top of it", () => {
    const eurc = { ...FX, tokenIn: "EURC", tokenOut: "USDC", amountIn: "2", amountOut: "1.57" };
    const plan = planFundingRoutes({
      fxQuote: eurc,
      sources: [source("ETHEREUM_SEPOLIA"), source("ARC_TESTNET", { balance: "2" })],
    });
    expect(plan.winner).toMatchObject({ sourceChain: "ARC_TESTNET", requiredAmount: "2" });
    expect(plan.routes.find((r) => r.sourceChain === "ETHEREUM_SEPOLIA")?.reason).toContain(
      "Only USDC is bridged",
    );
  });

  it("falls back to the fixed fee when the live estimate is missing", () => {
    const plan = planFundingRoutes({
      fxQuote: FX,
      sources: [source("ETHEREUM_SEPOLIA", { bridgeFee: null })],
    });
    expect(plan.winner?.bridgeFee).toEqual({ amount: "0.05", source: "fixed" });
  });
});

describe("bridgeAmountFor", () => {
  it("adds the bridge fee and Arc gas reserve exactly", () => {
    const [route] = planFundingRoutes({
      fxQuote: { ...FX, amountIn: "2.123456" },
      sources: [
        source("ETHEREUM_SEPOLIA", { bridgeFee: { amount: "0.021564", source: "estimate" } }),
      ],
    }).routes;
    expect(route && bridgeAmountFor(route)).toBe("2.19502");
  });
});
