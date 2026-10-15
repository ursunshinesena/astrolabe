import type { SupportedChainKey } from "@astrolabe/chains";
import type { BridgeResult, SwapOnArcResult } from "@astrolabe/circle";
import { bridgeAmountFor } from "@astrolabe/executor";
import { type RouteOption, type SwapQuote, buildRouteOptions } from "@astrolabe/pricing";

/** Tokens Circle's Swap Kit can trade on Arc Testnet (USDC is also the gas token). */
export const ARC_TESTNET_SWAP_TOKENS = ["EURC", "USDC"] as const;

/**
 * Builds the single executable route for the live runner: bridge USDC from
 * `sourceChain` to Arc Testnet, then swap there. Uses the shared routing
 * code so fees and net output are computed exactly as the API will.
 */
export function buildArcRoute(sourceChain: SupportedChainKey, arcQuote: SwapQuote): RouteOption {
  if (sourceChain === "ARC_TESTNET") {
    throw new Error("Source chain must differ from ARC_TESTNET for a bridge_then_swap route");
  }
  if (arcQuote.chainKey !== "ARC_TESTNET") {
    throw new Error(`Expected an ARC_TESTNET quote, got ${arcQuote.chainKey}`);
  }
  const [route] = buildRouteOptions({ sourceChain, quotes: { ARC_TESTNET: arcQuote } });
  if (!route) {
    throw new Error("Routing produced no option for ARC_TESTNET");
  }
  return route;
}

/** Human-readable dry-run preview of what an execution would do. */
export function formatPreview(route: RouteOption): string {
  const q = route.swapQuote;
  return [
    "Route preview (dry run — nothing has been sent)",
    `  strategy:        ${route.strategy}`,
    `  bridge:          ${bridgeAmountFor(route)} USDC  ${route.sourceChain} -> ${route.destinationChain} (CCTP V2)`,
    `  bridge fee:      ${route.bridgeFee.amount} USDC (${route.bridgeFee.source}) + Arc gas reserve`,
    `  swap on Arc:     ${q.amountIn} ${q.tokenIn} -> ~${q.amountOut} ${q.tokenOut}`,
    `  net out:         ~${route.netAmountOut} ${q.tokenOut}`,
    `  max slippage:    ${route.expectedSlippageBps} bps`,
    "  gas on Arc:      paid in USDC",
  ].join("\n");
}

/** One line per on-chain transaction, with an explorer link where known. */
export function formatEvidence(bridge: BridgeResult | null, swap: SwapOnArcResult | null): string {
  const lines: string[] = [];
  for (const step of bridge?.steps ?? []) {
    if (step.txHash) lines.push(`  ${step.name.padEnd(17)} ${step.txHash}`);
  }
  if (swap) {
    lines.push(
      `  ${"swap".padEnd(17)} ${swap.txHash}${swap.explorerUrl ? `  ${swap.explorerUrl}` : ""}`,
    );
  }
  return lines.length > 0 ? lines.join("\n") : "  (no transactions)";
}
