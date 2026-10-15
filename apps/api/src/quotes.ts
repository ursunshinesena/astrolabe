import type { SupportedChainKey } from "@astrolabe/chains";
import {
  type GetQuoteParams,
  type QuoteError,
  type QuotesByChain,
  type RouteOption,
  type SwapQuote,
  buildRouteOptions,
  compareRoutes,
} from "@astrolabe/pricing";
import type { ResultAsync } from "neverthrow";

/** Where the user's USDC lives. The executor bridges from here. */
export const SOURCE_CHAIN: SupportedChainKey = "ETHEREUM_SEPOLIA";

/** Chains and the token symbol each one is asked to quote for a target. */
export function quoteTargets(tokenOut: string): Array<{ chain: SupportedChainKey; token: string }> {
  const t = tokenOut.toUpperCase();
  if (t === "ETH" || t === "WETH") {
    // Uniswap pools are USDC/WETH; Arc Testnet has no WETH/ETH to swap into.
    return (["ETHEREUM_SEPOLIA", "BASE_SEPOLIA", "ARBITRUM_SEPOLIA"] as const).map((chain) => ({
      chain,
      token: "WETH",
    }));
  }
  if (t === "EURC") {
    return [{ chain: "ARC_TESTNET", token: "EURC" }];
  }
  return [];
}

export type RouteView = RouteOption & {
  /** True when the executor can carry this route out on testnet today. */
  executable: boolean;
  reason?: string;
};

export type QuoteOutcome = {
  amount: string;
  tokenOut: string;
  routes: RouteView[];
  failures: Array<{ chain: SupportedChainKey; error: string }>;
  winner: RouteView | null;
};

export type QuoteDeps = {
  getQuote: (params: GetQuoteParams) => ResultAsync<SwapQuote, QuoteError>;
};

function toView(route: RouteOption): RouteView {
  if (route.strategy === "swap_only") {
    return { ...route, executable: false, reason: "Same-chain swaps are quote-only on testnet" };
  }
  if (route.destinationChain !== "ARC_TESTNET") {
    return { ...route, executable: false, reason: "Swap execution runs on Arc only" };
  }
  return { ...route, executable: true };
}

/**
 * Quotes every relevant chain in parallel, keeps the failures visible, and
 * ranks the routes. The winner is the best *executable* route, falling back
 * to the best route overall so the comparison is still shown.
 */
export async function quoteRoutes(
  params: { amount: string; tokenOut: string; arcAddress?: string },
  deps: QuoteDeps,
): Promise<QuoteOutcome> {
  const targets = quoteTargets(params.tokenOut);
  const settled = await Promise.all(
    targets.map(async ({ chain, token }) => {
      const res = await deps.getQuote({
        chainKey: chain as GetQuoteParams["chainKey"],
        tokenIn: "USDC",
        tokenOut: token,
        amountIn: params.amount,
        ...(chain === "ARC_TESTNET" && params.arcAddress ? { fromAddress: params.arcAddress } : {}),
      });
      return { chain, res };
    }),
  );

  const quotes: QuotesByChain = {};
  const failures: QuoteOutcome["failures"] = [];
  for (const { chain, res } of settled) {
    if (res.isOk()) quotes[chain] = res.value;
    // viem errors embed the full request body; the first line is the cause.
    else failures.push({ chain, error: res.error.message.split("\n")[0] ?? "Quote failed" });
  }

  const options = buildRouteOptions({ sourceChain: SOURCE_CHAIN, quotes });
  if (options.length === 0) {
    return { amount: params.amount, tokenOut: params.tokenOut, routes: [], failures, winner: null };
  }
  const routes = compareRoutes(options).allOptions.map(toView);
  const winner = routes.find((r) => r.executable) ?? routes[0] ?? null;
  return { amount: params.amount, tokenOut: params.tokenOut, routes, failures, winner };
}
