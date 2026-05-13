import type { SupportedChainKey } from "@agora/chains";

export type SwapQuote = {
  buyAmount: string;
  sellAmount: string;
  price: string;
  estimatedGasWei: string;
  sources: Array<{ name: string; proportion: string }>;
};

// Stub — implemented in M2
// Uses 0x Swap API: https://0x.org/docs/api
export async function getSwapQuote(
  _chainKey: SupportedChainKey,
  _sellToken: string,
  _buyToken: string,
  _sellAmount: string,
): Promise<SwapQuote> {
  throw new Error("0x pricing not implemented — coming in M2");
}
