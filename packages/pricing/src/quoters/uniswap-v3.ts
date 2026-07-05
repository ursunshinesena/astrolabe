import {
  SUPPORTED_CHAINS,
  UNISWAP_V3_ADDRESSES,
  USDC_ADDRESSES,
  type UniswapV3ChainKey,
} from "@astrolabe/chains";
import { http, createPublicClient, formatUnits, parseUnits } from "viem";
import { POOL_FEE, type PoolFee, QUOTER_V2_ABI } from "../abi/uniswap-v3-quoter.js";
import { QuoteError, type SwapQuote } from "../types.js";

type ResolvedToken = { address: `0x${string}`; decimals: number };

function resolveToken(symbol: string, chainKey: UniswapV3ChainKey): ResolvedToken {
  switch (symbol.toUpperCase()) {
    case "USDC":
      return { address: USDC_ADDRESSES[chainKey], decimals: 6 };
    case "WETH":
    case "ETH":
      return { address: UNISWAP_V3_ADDRESSES[chainKey].weth, decimals: 18 };
    default:
      throw new QuoteError(`Unknown token: ${symbol}. Supported: USDC, WETH, ETH`, chainKey);
  }
}

export type UniswapV3QuoteParams = {
  chainKey: UniswapV3ChainKey;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  rpcUrl?: string;
  fee?: PoolFee;
};

export async function getUniswapV3Quote(params: UniswapV3QuoteParams): Promise<SwapQuote> {
  const {
    chainKey,
    tokenIn: tokenInSymbol,
    tokenOut: tokenOutSymbol,
    amountIn,
    rpcUrl,
    fee = POOL_FEE.MEDIUM,
  } = params;

  const addresses = UNISWAP_V3_ADDRESSES[chainKey];
  const tokenIn = resolveToken(tokenInSymbol, chainKey);
  const tokenOut = resolveToken(tokenOutSymbol, chainKey);

  const client = createPublicClient({
    chain: SUPPORTED_CHAINS[chainKey],
    transport: http(rpcUrl),
  });

  const amountInWei = parseUnits(amountIn, tokenIn.decimals);

  // QuoterV2 is nonpayable but designed for simulation via eth_call.
  // simulateContract sends an eth_call, never broadcasts a transaction.
  const { result } = await client.simulateContract({
    address: addresses.quoterV2,
    abi: QUOTER_V2_ABI,
    functionName: "quoteExactInputSingle",
    args: [
      {
        tokenIn: tokenIn.address,
        tokenOut: tokenOut.address,
        amountIn: amountInWei,
        fee,
        sqrtPriceLimitX96: 0n,
      },
    ],
  });

  const [amountOut, , , gasEstimate] = result;

  return {
    chainKey,
    tokenIn: tokenInSymbol.toUpperCase(),
    tokenOut: tokenOutSymbol.toUpperCase(),
    amountIn,
    amountOut: formatUnits(amountOut, tokenOut.decimals),
    gasEstimateWei: gasEstimate.toString(),
    source: "uniswap-v3",
  };
}
