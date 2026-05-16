import { z } from "zod";
import type { SupportedChainKey } from "@agora/chains";

export const SwapQuoteSchema = z.object({
  chainKey: z.string() as z.ZodType<SupportedChainKey>,
  tokenIn: z.string(),
  tokenOut: z.string(),
  amountIn: z.string(),
  amountOut: z.string(),
  gasEstimateWei: z.string(),
  source: z.enum(["uniswap-v3", "arc-app-kit"]),
  slippageBps: z.number().int().min(0).max(10000).optional(),
});

export type SwapQuote = z.infer<typeof SwapQuoteSchema>;

export class QuoteError extends Error {
  constructor(
    message: string,
    public readonly chainKey: SupportedChainKey,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "QuoteError";
  }
}
