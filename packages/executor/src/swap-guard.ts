import type { TokenBalance } from "@astrolabe/circle";
import { type Result, err, ok } from "neverthrow";

export type BalanceGuardParams = {
  walletId: string;
  token: string;
  amountIn: string;
  getTokenBalances: (walletId: string) => Promise<Result<TokenBalance[], Error>>;
};

function balanceOf(balances: TokenBalance[], token: string): number | null {
  const entry = balances.find((b) => b.symbol.toUpperCase() === token.toUpperCase());
  const value = Number(entry?.amount ?? "0");
  return Number.isFinite(value) ? value : null;
}

/**
 * Snapshots the input-token balance before a swap and returns a check that
 * proves a later failed attempt did not execute: a real swap spends the full
 * amountIn, while a reverted or never-sent one moves at most gas (paid in
 * USDC on Arc, orders of magnitude smaller). Anything that has dropped by
 * half of amountIn or more is treated as "may have swapped".
 *
 * Resolves null when the snapshot itself fails — the caller must then run
 * without retries rather than retry blind.
 */
export async function makeBalanceGuard(
  params: BalanceGuardParams,
): Promise<(() => Promise<Result<boolean, Error>>) | null> {
  const amount = Number(params.amountIn);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const before = await params.getTokenBalances(params.walletId);
  if (before.isErr()) return null;
  const start = balanceOf(before.value, params.token);
  if (start === null || start < amount) return null;

  return async () => {
    const now = await params.getTokenBalances(params.walletId);
    if (now.isErr()) return err(now.error);
    const current = balanceOf(now.value, params.token);
    if (current === null) return err(new Error(`Unparseable ${params.token} balance`));
    return ok(start - current < amount / 2);
  };
}
