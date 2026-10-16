import type { SupportedChainKey } from "@astrolabe/chains";
import type { TokenBalance } from "@astrolabe/circle";
import type { Result } from "neverthrow";
import {
  type FundingRoute,
  type FundingSource,
  bridgeAmountFor,
  planFundingRoutes,
} from "./routing.js";
import type { SwapQuote } from "./types.js";

/** A Circle developer-controlled wallet on one chain. */
export type ChainWallet = { walletId: string; address: string };
export type Wallets = Partial<Record<SupportedChainKey, ChainWallet>>;

/** Chains the agent may fund a conversion from, in display order. */
export const FUNDING_CHAINS: SupportedChainKey[] = [
  "ARC_TESTNET",
  "ETHEREUM_SEPOLIA",
  "BASE_SEPOLIA",
  "ARBITRUM_SEPOLIA",
];

/** Env var suffix per chain: CIRCLE_WALLET_ID_<SUFFIX> / CIRCLE_WALLET_ADDR_<SUFFIX>. */
export const WALLET_ENV_SUFFIX: Record<SupportedChainKey, string> = {
  ETHEREUM_SEPOLIA: "ETH_SEPOLIA",
  BASE_SEPOLIA: "BASE_SEPOLIA",
  ARBITRUM_SEPOLIA: "ARB_SEPOLIA",
  ARC_TESTNET: "ARC_TESTNET",
};

/** Reads the configured Circle wallets from the environment (ids and addresses only). */
export function walletsFromEnv(env: Record<string, string | undefined>): Wallets {
  const wallets: Wallets = {};
  for (const chain of FUNDING_CHAINS) {
    const suffix = WALLET_ENV_SUFFIX[chain];
    const walletId = env[`CIRCLE_WALLET_ID_${suffix}`];
    const address = env[`CIRCLE_WALLET_ADDR_${suffix}`];
    if (walletId && address) wallets[chain] = { walletId, address };
  }
  return wallets;
}

export type RouteView = FundingRoute & {
  /** True when the executor can carry this route out right now. */
  executable: boolean;
  /** USDC the executor will bridge (bridge routes only). */
  bridgeAmount?: string;
};

export type QuoteOutcome = {
  amount: string;
  tokenIn: string;
  tokenOut: string;
  /** Output per unit of input on Arc, e.g. "1.2760". */
  rate: string | null;
  amountOut: string | null;
  routes: RouteView[];
  winner: RouteView | null;
  /** Set when no plan could be made at all (e.g. the Arc FX quote failed). */
  error?: string;
};

export type QuoteDeps = {
  /** USDC <-> EURC quote on Arc. */
  getFxQuote: (params: {
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
  }) => Promise<Result<SwapQuote, Error>>;
  getTokenBalances: (walletId: string) => Promise<Result<TokenBalance[], Error>>;
  /** Live CCTP fee from `source` to Arc. Without it, the fixed fee is used. */
  estimateBridgeFee?: (source: SupportedChainKey, amount: string) => Promise<Result<string, Error>>;
};

function firstLine(message: string): string {
  return message.split("\n")[0] ?? message;
}

async function readSource(
  chain: SupportedChainKey,
  tokenIn: string,
  amount: string,
  wallets: Wallets,
  deps: QuoteDeps,
): Promise<FundingSource> {
  const wallet = wallets[chain];
  if (!wallet) {
    return { chain, walletConfigured: false, balance: null, hasNativeGas: null, bridgeFee: null };
  }
  const needsFee = chain !== "ARC_TESTNET" && tokenIn === "USDC" && deps.estimateBridgeFee;
  const [balances, fee] = await Promise.all([
    deps.getTokenBalances(wallet.walletId),
    needsFee ? deps.estimateBridgeFee?.(chain, amount) : undefined,
  ]);
  if (balances.isErr()) {
    return {
      chain,
      walletConfigured: true,
      balance: null,
      hasNativeGas: null,
      bridgeFee: null,
      error: `Balance unavailable: ${firstLine(balances.error.message)}`,
    };
  }
  const held = balances.value.find((b) => b.symbol === tokenIn)?.amount ?? "0";
  const hasNativeGas = balances.value.some((b) => b.tokenAddress === "" && Number(b.amount) > 0);
  return {
    chain,
    walletConfigured: true,
    balance: held,
    hasNativeGas,
    bridgeFee: fee?.isOk() ? { amount: fee.value, source: "estimate" } : null,
  };
}

/**
 * Plans a USDC <-> EURC conversion: one FX quote on Arc, then every funding
 * chain read in parallel (balance, gas, live bridge fee) and ranked by cost
 * among the routes that can actually execute.
 */
export async function quoteRoutes(
  params: { amount: string; tokenIn: string; tokenOut: string },
  wallets: Wallets,
  deps: QuoteDeps,
): Promise<QuoteOutcome> {
  const tokenIn = params.tokenIn.toUpperCase();
  const tokenOut = params.tokenOut.toUpperCase();
  const base = { amount: params.amount, tokenIn, tokenOut };

  const fx = await deps.getFxQuote({ tokenIn, tokenOut, amountIn: params.amount });
  if (fx.isErr()) {
    return {
      ...base,
      rate: null,
      amountOut: null,
      routes: [],
      winner: null,
      error: `No ${tokenIn}→${tokenOut} quote on Arc: ${firstLine(fx.error.message)}`,
    };
  }

  const sources = await Promise.all(
    FUNDING_CHAINS.map((chain) => readSource(chain, tokenIn, params.amount, wallets, deps)),
  );
  const plan = planFundingRoutes({ fxQuote: fx.value, sources });
  const view = (route: FundingRoute): RouteView => ({
    ...route,
    executable: route.feasible,
    ...(route.strategy === "bridge_then_swap" ? { bridgeAmount: bridgeAmountFor(route) } : {}),
  });
  const routes = plan.routes.map(view);
  const rate = Number(fx.value.amountOut) / Number(params.amount);

  return {
    ...base,
    rate: Number.isFinite(rate) ? rate.toFixed(4) : null,
    amountOut: fx.value.amountOut,
    routes,
    winner: routes.find((r) => r.executable) ?? null,
  };
}
