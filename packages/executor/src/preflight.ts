import { SUPPORTED_CHAINS, type SupportedChainKey } from "@astrolabe/chains";
import { type TokenBalance, getTokenBalances } from "@astrolabe/circle";
import type { Result } from "neverthrow";
import { ResultAsync } from "neverthrow";
import { ExecutorError } from "./errors.js";

export type PreflightCheckName = "config" | "route" | "wallet" | "balance" | "gas";

export type PreflightCheck = {
  name: PreflightCheckName;
  passed: boolean;
  detail: string;
};

export type PreflightReport = {
  passed: boolean;
  checks: PreflightCheck[];
};

export type PreflightParams = {
  sourceChain: SupportedChainKey;
  destinationChain: SupportedChainKey;
  walletId: string;
  /** Human-readable decimal string (e.g. "10.5") — same convention as TokenBalance.amount. */
  amount: string;
  /** Token that must cover `amount` in the wallet. Default "USDC". */
  token?: string;
};

export type PreflightDeps = {
  getTokenBalances: (walletId: string) => Promise<Result<TokenBalance[], Error>>;
  env: Record<string, string | undefined>;
};

const USDC_DECIMALS = 6n;

/**
 * Parse a USDC decimal string into micro-USDC (6-decimal base units).
 * Returns null for malformed input. Excess fractional digits are truncated.
 */
function toMicroUsdc(amount: string): bigint | null {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(amount.trim());
  if (!match?.[1]) return null;
  const whole = match[1];
  const fraction = (match[2] ?? "").slice(0, Number(USDC_DECIMALS)).padEnd(6, "0");
  return BigInt(whole) * 10n ** USDC_DECIMALS + BigInt(fraction);
}

// Design choice: a failed check is an expected domain outcome, so runPreflight
// returns ok(report) with passed:false and the caller inspects the report.
// err("PREFLIGHT_FAILED") is reserved for unexpected/system failures (a dep throwing).
export function runPreflight(
  params: PreflightParams,
  deps: PreflightDeps = { getTokenBalances, env: process.env },
): ResultAsync<PreflightReport, ExecutorError> {
  return ResultAsync.fromPromise(
    executeChecks(params, deps),
    (e) =>
      new ExecutorError(
        `Preflight aborted unexpectedly: ${e instanceof Error ? e.message : String(e)}`,
        "PREFLIGHT_FAILED",
        e,
      ),
  );
}

async function executeChecks(
  params: PreflightParams,
  deps: PreflightDeps,
): Promise<PreflightReport> {
  const checks: PreflightCheck[] = [];
  const fail = (name: PreflightCheckName, detail: string): PreflightReport => {
    checks.push({ name, passed: false, detail });
    return { passed: false, checks };
  };

  // a. config — required env vars set and non-empty
  const missing = ["CIRCLE_API_KEY", "CIRCLE_ENTITY_SECRET"].filter((k) => !deps.env[k]);
  if (missing.length > 0) {
    return fail("config", `Missing required env vars: ${missing.join(", ")}`);
  }
  checks.push({
    name: "config",
    passed: true,
    detail: "CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET are set",
  });

  // b. route — both chains supported; the same chain only for a swap on Arc
  const unsupported = [params.sourceChain, params.destinationChain].filter(
    (c) => !(c in SUPPORTED_CHAINS),
  );
  if (unsupported.length > 0) {
    return fail("route", `Unsupported chain(s): ${unsupported.join(", ")}`);
  }
  if (params.sourceChain === params.destinationChain && params.sourceChain !== "ARC_TESTNET") {
    return fail("route", `Source and destination chain are the same: ${params.sourceChain}`);
  }
  checks.push({
    name: "route",
    passed: true,
    detail: `Route ${params.sourceChain} -> ${params.destinationChain} is valid`,
  });

  // c. wallet — single balance call doubles as reachability probe
  const balancesResult = await deps.getTokenBalances(params.walletId);
  if (balancesResult.isErr()) {
    return fail("wallet", `Wallet ${params.walletId} unreachable: ${balancesResult.error.message}`);
  }
  const balances = balancesResult.value;
  checks.push({
    name: "wallet",
    passed: true,
    detail: `Wallet ${params.walletId} reachable (${balances.length} token balance(s))`,
  });

  // d. balance — reuse the same response; do not call the network twice
  const token = params.token ?? "USDC";
  const requested = toMicroUsdc(params.amount);
  if (requested === null) {
    return fail("balance", `Invalid ${token} amount: "${params.amount}"`);
  }
  const held = balances.find((b) => b.symbol === token)?.amount ?? "0";
  const available = toMicroUsdc(held);
  if (available === null) {
    return fail("balance", `Unparseable ${token} balance from wallet: "${held}"`);
  }
  if (available < requested) {
    return fail("balance", `Insufficient ${token}: have ${held}, need ${params.amount}`);
  }
  checks.push({
    name: "balance",
    passed: true,
    detail: `${token} balance ${held} >= ${params.amount}`,
  });

  // e. gas — approve and burn on a non-Arc source chain cost its native token;
  // on Arc gas is USDC and is covered by the reserve in the amount above.
  if (params.sourceChain !== "ARC_TESTNET") {
    const native = balances.find((b) => b.tokenAddress === "" && Number(b.amount) > 0);
    if (!native) {
      return fail("gas", `No native gas token on ${params.sourceChain} for approve and burn`);
    }
    checks.push({ name: "gas", passed: true, detail: `${native.amount} ${native.symbol} for gas` });
  }

  return { passed: true, checks };
}
