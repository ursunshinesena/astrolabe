import type { SupportedChainKey } from "@astrolabe/chains";
import { z } from "zod";
import type { SwapQuote } from "./types.js";

/**
 * Astrolabe is a stablecoin FX agent with Arc as its settlement hub: the
 * swap (USDC <-> EURC) always happens on Arc, where gas is paid in USDC.
 * Routing decides where the funds come from — already on Arc (no bridge),
 * or bridged in from another chain with CCTP V2 — by balance, gas and the
 * live bridge fee.
 */
export const FX_HUB: SupportedChainKey = "ARC_TESTNET";

export const BridgeFeeSchema = z.object({
  amount: z.string().regex(/^\d+\.?\d*$/, "amount must be a positive decimal"),
  source: z.enum(["estimate", "fixed"]),
});
export type BridgeFee = z.infer<typeof BridgeFeeSchema>;

/** Placeholder used only when the live CCTP fee estimate is unavailable. */
export const BRIDGE_FEE_FIXED: BridgeFee = { amount: "0.05", source: "fixed" };
const NO_FEE: BridgeFee = { amount: "0", source: "fixed" };

/**
 * USDC kept back on Arc for the swap's own gas (Arc gas is paid in USDC).
 * Live runs cost well under a cent per swap; 0.05 leaves ample margin.
 */
export const ARC_GAS_RESERVE_USDC = "0.05";

export type RouteOption = {
  /** swap_only: funds already on Arc. bridge_then_swap: CCTP V2 to Arc first. */
  strategy: "swap_only" | "bridge_then_swap";
  sourceChain: SupportedChainKey;
  destinationChain: SupportedChainKey;
  swapQuote: SwapQuote;
  bridgeFee: BridgeFee;
  /** Expected output of the swap; fees are paid on top, not deducted from it. */
  netAmountOut: string;
  expectedSlippageBps: number;
};

export function toMicro(amount: string): bigint {
  const [whole = "0", fraction = ""] = amount.trim().split(".");
  return BigInt(whole || "0") * 1_000_000n + BigInt(fraction.slice(0, 6).padEnd(6, "0") || "0");
}

export function fromMicro(micro: bigint): string {
  const fraction = (micro % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${micro / 1_000_000n}.${fraction}` : `${micro / 1_000_000n}`;
}

/**
 * USDC to bridge so the full swap amount is spendable on Arc: the bridge and
 * forwarder fees are taken from the transferred amount, and the swap's gas
 * is paid in USDC on Arc.
 */
export function bridgeAmountFor(route: RouteOption): string {
  return fromMicro(
    toMicro(route.swapQuote.amountIn) +
      toMicro(route.bridgeFee.amount) +
      toMicro(ARC_GAS_RESERVE_USDC),
  );
}

/**
 * Input-token amount the source wallet must hold for this route: the bridge
 * amount when funds come from another chain; on Arc, the swap amount plus the
 * USDC gas reserve when the input itself is USDC.
 */
export function fundingAmountFor(route: RouteOption): string {
  if (route.strategy === "bridge_then_swap") return bridgeAmountFor(route);
  const reserve = route.swapQuote.tokenIn === "USDC" ? toMicro(ARC_GAS_RESERVE_USDC) : 0n;
  return fromMicro(toMicro(route.swapQuote.amountIn) + reserve);
}

/** What one candidate chain can offer as a funding source. */
export type FundingSource = {
  chain: SupportedChainKey;
  /** False when no Circle wallet is configured for this chain. */
  walletConfigured: boolean;
  /** Balance of the input token on this chain; null if it couldn't be read. */
  balance: string | null;
  /** Native gas available for approve + burn. Ignored on Arc (gas is USDC). */
  hasNativeGas: boolean | null;
  /** Live CCTP fee to Arc; null falls back to BRIDGE_FEE_FIXED. Ignored on Arc. */
  bridgeFee: BridgeFee | null;
  /** Read error to show instead of a balance. */
  error?: string;
};

export type FundingRoute = RouteOption & {
  /** Input-token amount that must be in the source wallet. */
  requiredAmount: string;
  balance: string | null;
  /** Fees the user pays on top of the swap amount, in USDC. */
  costUsdc: string;
  feasible: boolean;
  reason?: string;
};

export type FundingPlan = {
  fxQuote: SwapQuote;
  routes: FundingRoute[];
  /** Cheapest feasible route, or null when none can execute. */
  winner: FundingRoute | null;
};

export type PlanFundingParams = {
  /** USDC<->EURC quote on Arc for the requested amount. */
  fxQuote: SwapQuote;
  sources: FundingSource[];
  slippageBps?: number;
};

function judge(route: RouteOption, source: FundingSource): FundingRoute {
  const onHub = route.strategy === "swap_only";
  const tokenIn = route.swapQuote.tokenIn;
  const required = fundingAmountFor(route);
  const base = {
    ...route,
    requiredAmount: required,
    balance: source.balance,
    costUsdc: route.bridgeFee.amount,
  };
  const no = (reason: string): FundingRoute => ({ ...base, feasible: false, reason });

  if (!source.walletConfigured) return no("No wallet on this chain");
  if (!onHub && tokenIn !== "USDC") return no(`Only USDC is bridged; ${tokenIn} must be on Arc`);
  if (source.error) return no(source.error);
  if (source.balance === null) return no("Balance unavailable");
  if (toMicro(source.balance) < toMicro(required)) {
    return no(`Needs ${required} ${tokenIn}, has ${source.balance}`);
  }
  if (!onHub && source.hasNativeGas === false) return no("No native gas for approve and burn");
  return { ...base, feasible: true };
}

/**
 * Builds one route per funding source and picks the cheapest one that can
 * actually execute. Pure: balances, gas and fees are passed in.
 */
export function planFundingRoutes(params: PlanFundingParams): FundingPlan {
  const { fxQuote, sources } = params;
  const slippage = params.slippageBps ?? fxQuote.slippageBps ?? 300;

  const routes = sources.map((source) => {
    const onHub = source.chain === FX_HUB;
    const route: RouteOption = {
      strategy: onHub ? "swap_only" : "bridge_then_swap",
      sourceChain: source.chain,
      destinationChain: FX_HUB,
      swapQuote: fxQuote,
      bridgeFee: onHub ? NO_FEE : (source.bridgeFee ?? BRIDGE_FEE_FIXED),
      netAmountOut: fxQuote.amountOut,
      expectedSlippageBps: slippage,
    };
    return judge(route, source);
  });

  routes.sort((a, b) => {
    if (a.feasible !== b.feasible) return a.feasible ? -1 : 1;
    const cost = toMicro(a.costUsdc) - toMicro(b.costUsdc);
    return cost < 0n ? -1 : cost > 0n ? 1 : 0;
  });

  return { fxQuote, routes, winner: routes.find((r) => r.feasible) ?? null };
}
