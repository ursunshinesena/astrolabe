import type { QuoteOutcome } from "@astrolabe/pricing";
import { describe, expect, it } from "vitest";
import { missingKeys, parseEnv } from "../env.js";
import { formatEvidence, formatPlan } from "../route.js";

describe("parseEnv", () => {
  it("parses keys, skips comments and strips quotes", () => {
    const env = parseEnv("# c\nA=1\n\nB=\"two words\"\nC=x=y\n  D = 'q' \nBAD");
    expect(env).toEqual({ A: "1", B: "two words", C: "x=y", D: "q" });
  });

  it("reports missing and empty keys", () => {
    expect(missingKeys({ A: "1", B: "" }, ["A", "B", "C"])).toEqual(["B", "C"]);
  });
});

describe("formatPlan", () => {
  const swapQuote = {
    chainKey: "ARC_TESTNET" as const,
    tokenIn: "USDC",
    tokenOut: "EURC",
    amountIn: "5",
    amountOut: "6.38",
    gasEstimateWei: "0",
    source: "arc-app-kit" as const,
  };
  const winner = {
    strategy: "bridge_then_swap" as const,
    sourceChain: "ETHEREUM_SEPOLIA" as const,
    destinationChain: "ARC_TESTNET" as const,
    swapQuote,
    bridgeFee: { amount: "0.0195", source: "estimate" as const },
    netAmountOut: "6.38",
    expectedSlippageBps: 300,
    requiredAmount: "5.0695",
    balance: "13",
    costUsdc: "0.0195",
    feasible: true,
    executable: true,
    bridgeAmount: "5.0695",
  };
  const plan: QuoteOutcome = {
    amount: "5",
    tokenIn: "USDC",
    tokenOut: "EURC",
    rate: "1.2760",
    amountOut: "6.38",
    routes: [
      winner,
      {
        ...winner,
        strategy: "swap_only",
        sourceChain: "ARC_TESTNET",
        feasible: false,
        executable: false,
        reason: "Needs 5.05 USDC, has 1",
      },
    ],
    winner,
  };

  it("shows the rate, every source and why, and the choice", () => {
    const text = formatPlan(plan);
    expect(text).toContain("rate 1.2760");
    expect(text).toContain("★ Ethereum Sepolia");
    expect(text).toContain("bridge 5.0695 USDC");
    expect(text).toContain("Needs 5.05 USDC, has 1");
    expect(text).toContain("chosen:   Ethereum Sepolia");
  });

  it("says so when no plan could be made", () => {
    expect(formatPlan({ ...plan, routes: [], winner: null, error: "no quote" })).toBe(
      "No plan: no quote",
    );
  });
});

describe("formatEvidence", () => {
  it("lists every hash it has and handles the empty case", () => {
    const text = formatEvidence(
      {
        state: "success",
        amount: "10",
        steps: [
          { name: "burn", state: "success", txHash: "0xb" },
          { name: "fetchAttestation", state: "success" },
        ],
      },
      { txHash: "0xs", amountIn: "10", explorerUrl: "https://x/tx/0xs" },
    );
    expect(text).toContain("0xb");
    expect(text).toContain("https://x/tx/0xs");
    expect(text).not.toContain("fetchAttestation");
    expect(formatEvidence(null, null)).toContain("no transactions");
  });
});
