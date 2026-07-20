import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { type Result, err, ok } from "neverthrow";

// Circle SDK blockchain identifier strings (testnet)
// Source: developers.circle.com/wallets/supported-blockchains
// Note: Blockchain type is not exported from the SDK — values are cast internally
export const CIRCLE_BLOCKCHAIN = {
  ETH_SEPOLIA: "ETH-SEPOLIA",
  BASE_SEPOLIA: "BASE-SEPOLIA",
  ARB_SEPOLIA: "ARB-SEPOLIA",
  ARC_TESTNET: "ARC-TESTNET",
} as const;

export type CircleBlockchain = (typeof CIRCLE_BLOCKCHAIN)[keyof typeof CIRCLE_BLOCKCHAIN];

const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 120_000;
const TERMINAL_STATES = new Set(["COMPLETE", "FAILED", "DENIED", "CANCELLED"]);

function makeClient() {
  const apiKey = process.env.CIRCLE_API_KEY;
  const entitySecret = process.env.CIRCLE_ENTITY_SECRET;
  if (!apiKey || !entitySecret) {
    throw new Error("CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET env vars must be set");
  }
  return initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });
}

export async function createWalletSet(name: string): Promise<Result<string, Error>> {
  try {
    const client = makeClient();
    const res = await client.createWalletSet({ name });
    const id = res.data?.walletSet?.id;
    if (!id) return err(new Error("createWalletSet: no ID in response"));
    return ok(id);
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

export type WalletInfo = {
  id: string;
  address: string;
  blockchain: string;
  state: string;
};

export async function createWallet(
  walletSetId: string,
  blockchain: CircleBlockchain,
): Promise<Result<WalletInfo, Error>> {
  try {
    const client = makeClient();
    const res = await client.createWallets({
      accountType: "EOA",
      // SDK's Blockchain type is not exported — values are correct per Circle docs
      blockchains: [blockchain as never],
      count: 1,
      walletSetId,
    });
    const wallet = res.data?.wallets?.[0];
    if (!wallet?.id || !wallet.address) {
      return err(new Error("createWallets: empty response"));
    }
    return ok({
      id: wallet.id,
      address: wallet.address,
      blockchain: String(wallet.blockchain ?? blockchain),
      state: wallet.state ?? "UNKNOWN",
    });
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

export type TokenBalance = {
  symbol: string;
  amount: string;
  decimals: number;
  tokenAddress: string;
};

export async function getTokenBalances(walletId: string): Promise<Result<TokenBalance[], Error>> {
  try {
    const client = makeClient();
    const res = await client.getWalletTokenBalance({ id: walletId });
    const balances = (res.data?.tokenBalances ?? []).map((b) => ({
      symbol: b.token?.symbol ?? "UNKNOWN",
      amount: b.amount ?? "0",
      decimals: b.token?.decimals ?? 6,
      tokenAddress: b.token?.tokenAddress ?? "",
    }));
    return ok(balances);
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

export type TxTerminalResult = {
  state: "COMPLETE" | "FAILED" | "DENIED" | "CANCELLED";
  txHash?: string;
};

export async function pollTransaction(txId: string): Promise<Result<TxTerminalResult, Error>> {
  try {
    const client = makeClient();
    const deadline = Date.now() + POLL_TIMEOUT_MS;

    while (Date.now() < deadline) {
      const res = await client.getTransaction({ id: txId });
      const tx = res.data?.transaction;
      if (!tx) return err(new Error(`getTransaction(${txId}): empty response`));

      if (TERMINAL_STATES.has(tx.state ?? "")) {
        return ok({
          state: tx.state as TxTerminalResult["state"],
          txHash: tx.txHash ?? undefined,
        });
      }

      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }

    return err(new Error(`Transaction ${txId} timed out after ${POLL_TIMEOUT_MS / 1000}s`));
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}
