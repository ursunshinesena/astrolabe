import { http, type Chain, createPublicClient } from "viem";
import { arbitrumSepolia, baseSepolia, sepolia } from "viem/chains";

// Arc Testnet — USDC is the native gas token (18 decimals for gas, 6 for ERC-20)
// Source: use-arc skill + https://docs.arc.io
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
  BASE_SEPOLIA: baseSepolia,
  ARBITRUM_SEPOLIA: arbitrumSepolia,
  ARC_TESTNET: arcTestnet,
} as const;

export type SupportedChainKey = keyof typeof SUPPORTED_CHAINS;

// CCTP domain IDs — source: Circle MCP (developers.circle.com/cctp)
export const CCTP_DOMAIN_IDS = {
  ETHEREUM_SEPOLIA: 0,
  BASE_SEPOLIA: 6,
  ARBITRUM_SEPOLIA: 3,
  ARC_TESTNET: 26,
} as const satisfies Record<SupportedChainKey, number>;

// Chain name strings used by @circle-fin/app-kit bridge() calls — NOT numeric IDs
export const CIRCLE_CHAIN_NAMES = {
  ETHEREUM_SEPOLIA: "Ethereum_Sepolia",
  BASE_SEPOLIA: "Base_Sepolia",
  ARBITRUM_SEPOLIA: "Arbitrum_Sepolia",
  ARC_TESTNET: "Arc_Testnet",
} as const satisfies Record<SupportedChainKey, string>;

// USDC contract addresses (6 decimals) — source: Circle MCP (developers.circle.com)
export const USDC_ADDRESSES = {
  ETHEREUM_SEPOLIA: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" as `0x${string}`,
  BASE_SEPOLIA: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as `0x${string}`,
  ARBITRUM_SEPOLIA: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d" as `0x${string}`,
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
