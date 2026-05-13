import { type Chain, createPublicClient, http } from "viem";
import { avalancheFuji, baseSepolia, sepolia } from "viem/chains";

// Arc Testnet — USDC is the native gas token (18 decimals for gas, 6 for ERC-20)
// Source: use-arc skill + https://docs.arc.network
const arcTestnet = {
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.testnet.arc.network"] },
  },
  blockExplorers: {
    default: { name: "ArcScan", url: "https://testnet.arcscan.app" },
  },
  testnet: true,
} as const satisfies Chain;

export const SUPPORTED_CHAINS = {
  ETHEREUM_SEPOLIA: sepolia,
  AVALANCHE_FUJI: avalancheFuji,
  BASE_SEPOLIA: baseSepolia,
  ARC_TESTNET: arcTestnet,
} as const;

export type SupportedChainKey = keyof typeof SUPPORTED_CHAINS;

// CCTP domain IDs — source: use-gateway skill (confirmed)
export const CCTP_DOMAIN_IDS = {
  ETHEREUM_SEPOLIA: 0,
  AVALANCHE_FUJI: 1,
  BASE_SEPOLIA: 6,
  ARC_TESTNET: 26,
} as const satisfies Record<SupportedChainKey, number>;

// Chain name strings used by @circle-fin/app-kit bridge() calls — NOT numeric IDs
export const CIRCLE_CHAIN_NAMES = {
  ETHEREUM_SEPOLIA: "Ethereum_Sepolia",
  AVALANCHE_FUJI: "Avalanche_Fuji",
  BASE_SEPOLIA: "Base_Sepolia",
  ARC_TESTNET: "Arc_Testnet",
} as const satisfies Record<SupportedChainKey, string>;

// USDC contract addresses (6 decimals) — verify via Circle MCP before use
// Arc address confirmed from use-arc skill; others need MCP verification
export const USDC_ADDRESSES = {
  ETHEREUM_SEPOLIA: "0x0000000000000000000000000000000000000000" as `0x${string}`,
  AVALANCHE_FUJI: "0x0000000000000000000000000000000000000000" as `0x${string}`,
  BASE_SEPOLIA: "0x0000000000000000000000000000000000000000" as `0x${string}`,
  ARC_TESTNET: "0x3600000000000000000000000000000000000000" as `0x${string}`,
} satisfies Record<SupportedChainKey, `0x${string}`>;

export function createRpcClient(chainKey: SupportedChainKey, rpcUrl?: string) {
  return createPublicClient({
    chain: SUPPORTED_CHAINS[chainKey],
    transport: http(rpcUrl),
  });
}

export { arcTestnet };
export type { Chain };
