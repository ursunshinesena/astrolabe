import type { SupportedChainKey } from "@agora/chains";
import { z } from "zod";
import type { SwapQuote } from "./types.js";

export const BridgeFeeSchema = z.object({
  amount: z.string().regex(/^\d+\.?\d*$/, "amount must be a positive decimal"),
  source: z.enum(["estimate", "fixed"]),
});
export type BridgeFee = z.infer<typeof BridgeFeeSchema>;

// M2: fixed CCTP fee placeholder. Replace with estimateBridge() in M5.
export const BRIDGE_FEE_FIXED: BridgeFee = { amount: "0.05", source: "fixed" };
const BRIDGE_FEE_ZERO: BridgeFee = { amount: "0", source: "fixed" };

export type RouteOption = {
  strategy: "swap_only" | "bridge_then_swap";
  sourceChain: SupportedChainKey;
  destinationChain: SupportedChainKey;
  swapQuote: SwapQuote;
  bridgeFee: BridgeFee;
  netAmountOut: string;
  expectedSlippageBps: number;
};

export type BestRoute = {
  winner: RouteOption;
  allOptions: RouteOption[]; // sorted best → worst by netAmountOut
};

export type QuotesByChain = Partial<Record<SupportedChainKey, SwapQuote>>;

/**
 * Linear approximation: apply the same price ratio to the post-fee input amount.
 * Accurate when fee << amountIn, which holds for CCTP fees in normal usage.
 */
function computeNetAmountOut(swapQuote: SwapQuote, bridgeFeeUSDC: string): string {
  const amountIn = Number(swapQuote.amountIn);
  const amountOut = Number(swapQuote.amountOut);
  const fee = Number(bridgeFeeUSDC);

  if (!Number.isFinite(amountIn) || !Number.isFinite(amountOut) || amountIn <= 0) return "0";
  if (fee >= amountIn) return "0";

  const netOut = amountOut * ((amountIn - fee) / amountIn);
  return netOut.toFixed(8);
}

export type BuildRouteOptionsParams = {
  sourceChain: SupportedChainKey;
  /** All fetched quotes, keyed by chain. Missing entries are silently skipped. */
  quotes: QuotesByChain;
  /** Bridge fee applied to all bridge_then_swap routes. Default: BRIDGE_FEE_FIXED. */
  bridgeFee?: BridgeFee;
  /** Slippage tolerance fallback when swapQuote.slippageBps is absent. Default: 300. */
  slippageBps?: number;
};

/**
 * Produces 1 swap_only + N bridge_then_swap RouteOptions from a quotes map.
 * Caller provides all chain quotes; this function handles all permutations automatically.
 */
export function buildRouteOptions(params: BuildRouteOptionsParams): RouteOption[] {
  const { sourceChain, quotes, bridgeFee = BRIDGE_FEE_FIXED, slippageBps = 300 } = params;
  const options: RouteOption[] = [];

  for (const [key, swapQuote] of Object.entries(quotes)) {
    const chainKey = key as SupportedChainKey;
    if (!swapQuote) continue;

    const expectedSlippageBps = swapQuote.slippageBps ?? slippageBps;

    if (chainKey === sourceChain) {
      options.push({
        strategy: "swap_only",
        sourceChain,
        destinationChain: sourceChain,
        swapQuote,
        bridgeFee: BRIDGE_FEE_ZERO,
        netAmountOut: swapQuote.amountOut,
        expectedSlippageBps,
      });
    } else {
      options.push({
        strategy: "bridge_then_swap",
        sourceChain,
        destinationChain: chainKey,
        swapQuote,
        bridgeFee,
        netAmountOut: computeNetAmountOut(swapQuote, bridgeFee.amount),
        expectedSlippageBps,
      });
    }
  }

  return options;
}

/**
 * Pure comparison function — no network calls.
 * Sorts RouteOptions by netAmountOut descending and returns the winner.
 */
export function compareRoutes(options: RouteOption[]): BestRoute {
  if (options.length === 0) throw new Error("compareRoutes requires at least one RouteOption");

  const sorted = [...options].sort((a, b) => Number(b.netAmountOut) - Number(a.netAmountOut));

  const winner = sorted[0];
  if (!winner) throw new Error("compareRoutes: sort produced empty array");

  return { winner, allOptions: sorted };
}
