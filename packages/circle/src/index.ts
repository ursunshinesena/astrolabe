export {
  CIRCLE_BLOCKCHAIN,
  createWallet,
  createWalletSet,
  getTokenBalances,
  pollTransaction,
} from "./wallets.js";

export type {
  CircleBlockchain,
  TxTerminalResult,
  TokenBalance,
  WalletInfo,
} from "./wallets.js";

export { APPKIT_CHAIN, bridgeUSDC } from "./bridge.js";

export type { AppKitChain, BridgeParams, BridgeResult, BridgeStep } from "./bridge.js";
