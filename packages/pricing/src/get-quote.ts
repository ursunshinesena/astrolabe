import type { UniswapV3ChainKey } from "@astrolabe/chains";
import { ResultAsync, errAsync } from "neverthrow";
import { z } from "zod";
import { getArcQuote } from "./quoters/arc.js";
import { getUniswapV3Quote } from "./quoters/uniswap-v3.js";
import { QuoteError, type SwapQuote } from "./types.js";

export const GetQuoteParamsSchema = z.object({
  chainKey: z.enum(["ETHEREUM_SEPOLIA", "BASE_SEPOLIA", "ARBITRUM_SEPOLIA", "ARC_TESTNET"]),
  tokenIn: z.string().min(1),
  tokenOut: z.string().min(1),
  amountIn: z
    .string()
    .regex(/^\d+\.?\d*$/, "amountIn must be a positive decimal string (e.g. '100' or '0.5')"),
  rpcUrl: z.string().url().optional(),
  // Required when chainKey === "ARC_TESTNET"
  fromAddress: z.string().optional(),
});

export type GetQuoteParams = z.infer<typeof GetQuoteParamsSchema>;

const UNISWAP_CHAINS = new Set<string>(["ETHEREUM_SEPOLIA", "BASE_SEPOLIA", "ARBITRUM_SEPOLIA"]);

export function getQuote(params: GetQuoteParams): ResultAsync<SwapQuote, QuoteError> {
  const parsed = GetQuoteParamsSchema.safeParse(params);
  if (!parsed.success) {
    return errAsync(
      new QuoteError(parsed.error.errors[0]?.message ?? "Invalid params", "ETHEREUM_SEPOLIA"),
    );
  }

  const { chainKey, tokenIn, tokenOut, amountIn, rpcUrl, fromAddress } = parsed.data;

  if (UNISWAP_CHAINS.has(chainKey)) {
    return ResultAsync.fromPromise(
      getUniswapV3Quote({
        chainKey: chainKey as UniswapV3ChainKey,
        tokenIn,
        tokenOut,
        amountIn,
        rpcUrl,
      }),
      (e) => new QuoteError(e instanceof Error ? e.message : String(e), chainKey),
    );
  }

  if (chainKey === "ARC_TESTNET") {
    const apiKey = process.env.CIRCLE_API_KEY;
    const entitySecret = process.env.CIRCLE_ENTITY_SECRET;
    if (!apiKey || !entitySecret) {
      return errAsync(
        new QuoteError("CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET must be set", "ARC_TESTNET"),
      );
    }
    if (!fromAddress) {
      return errAsync(
        new QuoteError("fromAddress is required for Arc Testnet quotes", "ARC_TESTNET"),
      );
    }
    return ResultAsync.fromPromise(
      getArcQuote({ fromAddress, tokenIn, tokenOut, amountIn, apiKey, entitySecret }),
      (e) => new QuoteError(e instanceof Error ? e.message : String(e), "ARC_TESTNET"),
    );
  }

  return errAsync(new QuoteError(`Unsupported chain: ${chainKey}`, "ETHEREUM_SEPOLIA"));
}
