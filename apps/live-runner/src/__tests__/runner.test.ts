import type { SwapQuote } from "@astrolabe/pricing";
import { describe, expect, it } from "vitest";
import { missingKeys, parseEnv } from "../env.js";
import { buildArcRoute, formatEvidence, formatPreview } from "../route.js";

const ARC_QUOTE: SwapQuote = {
  chainKey: "ARC_TESTNET",
  tokenIn: "USDC",
  tokenOut: "EURC",
  amountIn: "10",
  amountOut: "8.5",
  gasEstimateWei: "0",
  source: "arc-app-kit",
};

describe("parseEnv", () => {
  it("parses keys, skips comments and strips quotes", () => {
    const env = parseEnv("# c\nA=1\n\nB=\"two words\"\nC=x=y\n  D = 'q' \nBAD");
    expect(env).toEqual({ A: "1", B: "two words", C: "x=y", D: "q" });
  });

  it("reports missing and empty keys", () => {
    expect(missingKeys({ A: "1", B: "" }, ["A", "B", "C"])).toEqual(["B", "C"]);
  });
});

describe("buildArcRoute", () => {
  it("builds a bridge_then_swap route to Arc with the fee applied", () => {
    const route = buildArcRoute("ETHEREUM_SEPOLIA", ARC_QUOTE);
    expect(route.strategy).toBe("bridge_then_swap");
    expect(route.sourceChain).toBe("ETHEREUM_SEPOLIA");
    expect(route.destinationChain).toBe("ARC_TESTNET");
    expect(Number(route.netAmountOut)).toBeLessThan(8.5);
    expect(formatPreview(route)).toContain("ETHEREUM_SEPOLIA -> ARC_TESTNET");
  });

  it("rejects a non-Arc quote and an Arc source", () => {
    expect(() =>
      buildArcRoute("ETHEREUM_SEPOLIA", { ...ARC_QUOTE, chainKey: "BASE_SEPOLIA" }),
    ).toThrow();
    expect(() => buildArcRoute("ARC_TESTNET", ARC_QUOTE)).toThrow();
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
