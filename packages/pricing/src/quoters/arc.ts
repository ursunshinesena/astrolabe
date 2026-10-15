import { createCircleWalletsAdapter } from "@circle-fin/adapter-circle-wallets";
import { AppKit } from "@circle-fin/app-kit";
import { QuoteError, type SwapQuote } from "../types.js";

// Arc App Kit supported swap tokens (subset relevant to our use case)
const SUPPORTED_ARC_TOKENS = new Set(["USDC", "USDT", "EURC", "WETH", "ETH", "NATIVE"]);

export type ArcQuoteParams = {
  fromAddress: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  apiKey: string;
  entitySecret: string;
  slippageBps?: number;
};

export async function getArcQuote(params: ArcQuoteParams): Promise<SwapQuote> {
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

  if (!SUPPORTED_ARC_TOKENS.has(tokenInUpper)) {
    throw new QuoteError(`Unsupported tokenIn for Arc: ${tokenIn}`, "ARC_TESTNET");
  }
  if (!SUPPORTED_ARC_TOKENS.has(tokenOutUpper)) {
    throw new QuoteError(`Unsupported tokenOut for Arc: ${tokenOut}`, "ARC_TESTNET");
  }

  const kit = new AppKit();
  const adapter = createCircleWalletsAdapter({ apiKey, entitySecret });

  // estimateSwap calculates expected output without executing a transaction
  const estimate = await kit.estimateSwap({
    from: {
      adapter,
      chain: "Arc_Testnet",
      // address is required for developer-controlled adapters (Circle wallets)
      address: fromAddress,
    } as Parameters<typeof kit.estimateSwap>[0]["from"],
    tokenIn: tokenInUpper as Parameters<typeof kit.estimateSwap>[0]["tokenIn"],
    tokenOut: tokenOutUpper as Parameters<typeof kit.estimateSwap>[0]["tokenOut"],
    amountIn,
    // The Stablecoin Service authenticates swaps with the Circle API key
    // (legacy kit keys can no longer be created).
    config: { slippageBps, apiKey },
  });

  return {
    chainKey: "ARC_TESTNET",
    tokenIn: tokenInUpper,
    tokenOut: tokenOutUpper,
    amountIn,
    amountOut: estimate.estimatedOutput.amount,
    // Arc gas is USDC — no ETH gas estimate needed
    gasEstimateWei: "0",
    source: "arc-app-kit",
  };
}
