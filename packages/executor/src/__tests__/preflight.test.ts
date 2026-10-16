import type { SupportedChainKey } from "@astrolabe/chains";
import type { TokenBalance } from "@astrolabe/circle";
import { type Result, err, ok } from "neverthrow";
import { describe, expect, it } from "vitest";
import { type PreflightDeps, runPreflight } from "../preflight.js";

const VALID_ENV = { CIRCLE_API_KEY: "key", CIRCLE_ENTITY_SECRET: "secret" };

const USDC_BALANCE: TokenBalance = {
  symbol: "USDC",
  amount: "100",
  decimals: 6,
  tokenAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
};

const GAS_BALANCE: TokenBalance = {
  symbol: "ETH-SEPOLIA",
  amount: "0.049",
  decimals: 18,
  tokenAddress: "",
};

function makeDeps(
  result: Result<TokenBalance[], Error>,
  env: Record<string, string | undefined> = VALID_ENV,
): { deps: PreflightDeps; calls: () => number } {
  let callCount = 0;
  return {
    deps: {
      getTokenBalances: async () => {
        callCount += 1;
        return result;
      },
      env,
    },
    calls: () => callCount,
  };
}

const PARAMS = {
  sourceChain: "ETHEREUM_SEPOLIA",
  destinationChain: "BASE_SEPOLIA",
  walletId: "wallet-123",
  amount: "50",
} as const;

describe("runPreflight", () => {
  it("fails config when env vars are missing and makes no network call", async () => {
    const { deps, calls } = makeDeps(ok([USDC_BALANCE]), { CIRCLE_API_KEY: "key" });
    const result = await runPreflight(PARAMS, deps);
    const report = result._unsafeUnwrap();
    expect(report.passed).toBe(false);
    expect(report.checks).toEqual([
      { name: "config", passed: false, detail: "Missing required env vars: CIRCLE_ENTITY_SECRET" },
    ]);
    expect(calls()).toBe(0);
  });

  it("fails config when env vars are empty strings", async () => {
    const { deps, calls } = makeDeps(ok([USDC_BALANCE]), {
      CIRCLE_API_KEY: "",
      CIRCLE_ENTITY_SECRET: "",
    });
    const result = await runPreflight(PARAMS, deps);
    const report = result._unsafeUnwrap();
    expect(report.passed).toBe(false);
    expect(report.checks[0]?.name).toBe("config");
    expect(calls()).toBe(0);
  });

  it("fails route when source and destination are the same", async () => {
    const { deps, calls } = makeDeps(ok([USDC_BALANCE]));
    const result = await runPreflight({ ...PARAMS, destinationChain: "ETHEREUM_SEPOLIA" }, deps);
    const report = result._unsafeUnwrap();
    expect(report.passed).toBe(false);
    expect(report.checks.map((c) => c.name)).toEqual(["config", "route"]);
    expect(report.checks[1]?.passed).toBe(false);
    expect(calls()).toBe(0);
  });

  it("fails route for an unsupported chain value", async () => {
    const { deps, calls } = makeDeps(ok([USDC_BALANCE]));
    const result = await runPreflight(
      { ...PARAMS, sourceChain: "AVAX_FUJI" as SupportedChainKey },
      deps,
    );
    const report = result._unsafeUnwrap();
    expect(report.passed).toBe(false);
    expect(report.checks[1]).toEqual({
      name: "route",
      passed: false,
      detail: "Unsupported chain(s): AVAX_FUJI",
    });
    expect(calls()).toBe(0);
  });

  it("fails wallet when getTokenBalances returns err", async () => {
    const { deps, calls } = makeDeps(err(new Error("wallet not found")));
    const result = await runPreflight(PARAMS, deps);
    const report = result._unsafeUnwrap();
    expect(report.passed).toBe(false);
    expect(report.checks.map((c) => c.name)).toEqual(["config", "route", "wallet"]);
    expect(report.checks[2]?.passed).toBe(false);
    expect(report.checks[2]?.detail).toContain("wallet not found");
    expect(calls()).toBe(1);
  });

  it("passes all 5 checks with sufficient balance and gas, calling the network exactly once", async () => {
    const { deps, calls } = makeDeps(ok([USDC_BALANCE, GAS_BALANCE]));
    const result = await runPreflight(PARAMS, deps);
    const report = result._unsafeUnwrap();
    expect(report.passed).toBe(true);
    expect(report.checks.map((c) => c.name)).toEqual([
      "config",
      "route",
      "wallet",
      "balance",
      "gas",
    ]);
    expect(report.checks.every((c) => c.passed)).toBe(true);
    expect(calls()).toBe(1);
  });

  it("fails balance when USDC balance is insufficient", async () => {
    const { deps, calls } = makeDeps(ok([{ ...USDC_BALANCE, amount: "49.999999" }]));
    const result = await runPreflight(PARAMS, deps);
    const report = result._unsafeUnwrap();
    expect(report.passed).toBe(false);
    expect(report.checks.map((c) => c.name)).toEqual(["config", "route", "wallet", "balance"]);
    expect(report.checks[3]).toEqual({
      name: "balance",
      passed: false,
      detail: "Insufficient USDC: have 49.999999, need 50",
    });
    expect(calls()).toBe(1);
  });

  it("treats a wallet with no USDC entry as zero balance", async () => {
    const { deps } = makeDeps(ok([{ ...USDC_BALANCE, symbol: "WETH" }]));
    const result = await runPreflight(PARAMS, deps);
    const report = result._unsafeUnwrap();
    expect(report.passed).toBe(false);
    expect(report.checks[3]?.name).toBe("balance");
    expect(report.checks[3]?.passed).toBe(false);
  });

  it("accepts fractional decimal amounts", async () => {
    const { deps } = makeDeps(ok([{ ...USDC_BALANCE, amount: "50.5" }, GAS_BALANCE]));
    const result = await runPreflight({ ...PARAMS, amount: "50.25" }, deps);
    expect(result._unsafeUnwrap().passed).toBe(true);
  });

  it("fails gas on a non-Arc source with no native token", async () => {
    const { deps } = makeDeps(ok([USDC_BALANCE]));
    const report = (await runPreflight(PARAMS, deps))._unsafeUnwrap();
    expect(report.passed).toBe(false);
    expect(report.checks.at(-1)).toMatchObject({ name: "gas", passed: false });
  });

  it("a swap on Arc: same chain allowed, EURC balance checked, no native gas needed", async () => {
    const { deps } = makeDeps(ok([{ ...USDC_BALANCE, symbol: "EURC", amount: "3" }]));
    const report = (
      await runPreflight(
        {
          sourceChain: "ARC_TESTNET",
          destinationChain: "ARC_TESTNET",
          walletId: "arc",
          amount: "2",
          token: "EURC",
        },
        deps,
      )
    )._unsafeUnwrap();
    expect(report.passed).toBe(true);
    expect(report.checks.map((c) => c.name)).not.toContain("gas");
  });

  it("fails balance for a malformed requested amount", async () => {
    const { deps } = makeDeps(ok([USDC_BALANCE]));
    const result = await runPreflight({ ...PARAMS, amount: "abc" }, deps);
    const report = result._unsafeUnwrap();
    expect(report.passed).toBe(false);
    expect(report.checks[3]?.detail).toContain("Invalid USDC amount");
  });

  it("reserves err for unexpected failures (a throwing dep)", async () => {
    const deps: PreflightDeps = {
      getTokenBalances: async () => {
        throw new Error("boom");
      },
      env: VALID_ENV,
    };
    const result = await runPreflight(PARAMS, deps);
    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.code).toBe("PREFLIGHT_FAILED");
    expect(error.message).toContain("boom");
  });
});
