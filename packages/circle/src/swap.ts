import { createCircleWalletsAdapter } from "@circle-fin/adapter-circle-wallets";
import { AppKit } from "@circle-fin/app-kit";

// Duplicated from packages/pricing/src/quoters/arc.ts intentionally: the circle
// package must not depend on the pricing package (that would invert the
// dependency direction), so the supported-token set is redefined here rather
// than imported. Keep the two lists in sync if Arc adds/removes swap tokens.
const SUPPORTED_ARC_TOKENS = new Set(["USDC", "USDT", "EURC", "WETH", "ETH", "NATIVE"]);

export type SwapOnArcParams = {
  fromAddress: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  apiKey: string;
  entitySecret: string;
  slippageBps?: number;
};

export type SwapOnArcResult = {
  txHash: string;
  amountIn: string;
  // amountOut and explorerUrl mirror the SDK's SwapResult, which marks both
  // optional (amountOut comes from a best-effort post-confirmation lookup;
  // explorerUrl is only present when txHash is non-empty). We pass them
  // through as-is and never substitute defaults.
  amountOut?: string;
  explorerUrl?: string;
};

/**
 * Executes a token swap on Arc Testnet via Circle App Kit.
 *
 * Execution-side sibling of getArcQuote in the pricing package: same setup and
 * validation, but it performs the swap instead of estimating it.
 *
 * Errors are thrown as plain Error objects (no neverthrow wrapping), matching
 * the error style of bridge.ts. SDK errors from kit.swap propagate to the
 * caller unmodified.
 */
export async function swapOnArc(params: SwapOnArcParams): Promise<SwapOnArcResult> {
  const {
    fromAddress,
    tokenIn,
    tokenOut,
    amountIn,
    apiKey,
    entitySecret,
    slippageBps = 300,
  } = params;

  const tokenInUpper = tokenIn.toUpperCase();
  const tokenOutUpper = tokenOut.toUpperCase();

  // Plain Error (not pricing's QuoteError) so this file carries no dependency
  // on the pricing package.
  if (!SUPPORTED_ARC_TOKENS.has(tokenInUpper)) {
    throw new Error(`Unsupported tokenIn for Arc: ${tokenIn}`);
  }
  if (!SUPPORTED_ARC_TOKENS.has(tokenOutUpper)) {
    throw new Error(`Unsupported tokenOut for Arc: ${tokenOut}`);
  }

  const kit = new AppKit();
  const adapter = createCircleWalletsAdapter({ apiKey, entitySecret });

  // swap executes the transaction on-chain (unlike estimateSwap, which only
  // computes expected output). Same casting approach as arc.ts: the SDK's
  // SwapParams narrows tokens/chain to branded literal types.
  const result = await kit.swap({
    from: {
      adapter,
      chain: "Arc_Testnet",
      // address is required for developer-controlled adapters (Circle wallets)
      address: fromAddress,
    } as Parameters<typeof kit.swap>[0]["from"],
    tokenIn: tokenInUpper as Parameters<typeof kit.swap>[0]["tokenIn"],
    tokenOut: tokenOutUpper as Parameters<typeof kit.swap>[0]["tokenOut"],
    amountIn,
    config: { slippageBps },
  });

  return {
    txHash: result.txHash,
    amountIn: result.amountIn,
    amountOut: result.amountOut,
    explorerUrl: result.explorerUrl,
  };
}
