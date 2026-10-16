import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BridgeResult } from "@astrolabe/circle";
import type { RouteOption } from "@astrolabe/pricing";
import { errAsync, ok, okAsync } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunBridgeParams } from "../bridging.js";
import { ExecutorError } from "../errors.js";
import { type ExecutionRecord, applyTransition } from "../execution.js";
import { type RunExecutionDeps, runExecution } from "../orchestrating.js";
import type { PreflightReport } from "../preflight.js";
import type { RunSwapParams, RunSwapResult } from "../swapping.js";

const ROUTE: RouteOption = {
  strategy: "bridge_then_swap",
  sourceChain: "ETHEREUM_SEPOLIA",
  destinationChain: "ARC_TESTNET",
  swapQuote: {
    chainKey: "ARC_TESTNET",
    tokenIn: "USDC",
    tokenOut: "WETH",
    amountIn: "100",
    amountOut: "0.031",
    gasEstimateWei: "0",
    source: "arc-app-kit",
  },
  bridgeFee: { amount: "0.05", source: "fixed" },
  netAmountOut: "0.03098",
  expectedSlippageBps: 300,
};

const SWAP_ONLY_ROUTE: RouteOption = {
  ...ROUTE,
  strategy: "swap_only",
  destinationChain: "ETHEREUM_SEPOLIA",
};

const PARAMS = {
  route: ROUTE,
  walletId: "wallet-1",
  sourceAddress: "0xsource",
  arcAddress: "0xarc",
} as const;

const PASSED_REPORT: PreflightReport = {
  passed: true,
  checks: [{ name: "config", passed: true, detail: "all set" }],
};

const BRIDGE_RESULT: BridgeResult = {
  state: "success",
  amount: "100",
  steps: [
    { name: "approve", state: "success", txHash: "0xapprove" },
    { name: "burn", state: "success", txHash: "0xburn" },
    { name: "fetchAttestation", state: "success" },
    { name: "mint", state: "success", txHash: "0xmint" },
  ],
};

const SWAP_RESULT: RunSwapResult["result"] = {
  txHash: "0xswaphash",
  amountIn: "100",
  amountOut: "0.031",
  explorerUrl: "https://testnet.arcscan.app/tx/0xswaphash",
};

/** Drives the record forward like the real runBridge: ends in "minting". */
function fakeRunBridge(result: BridgeResult = BRIDGE_RESULT) {
  return vi.fn((params: RunBridgeParams) => {
    let record = params.record;
    for (const state of ["burning", "awaiting_attestation", "minting"] as const) {
      record = applyTransition(record, state)._unsafeUnwrap();
    }
    return okAsync({ record, result });
  });
}

/** Drives the record forward like the real runSwap: ends in "completed". */
function fakeRunSwap(result: RunSwapResult["result"] = SWAP_RESULT) {
  return vi.fn((params: RunSwapParams) => {
    let record = params.record;
    for (const state of ["swapping", "completed"] as const) {
      record = applyTransition(record, state)._unsafeUnwrap();
    }
    return okAsync({ record, result });
  });
}

function makeDeps(overrides: Partial<RunExecutionDeps> = {}): RunExecutionDeps {
  return {
    runPreflight: vi.fn(() => okAsync(PASSED_REPORT)),
    runBridge: fakeRunBridge(),
    runSwap: fakeRunSwap(),
    saveExecution: vi.fn((record: ExecutionRecord) => okAsync(record)),
    ...overrides,
  };
}

let baseDir: string;

beforeEach(async () => {
  baseDir = await mkdtemp(join(tmpdir(), "astrolabe-executor-orchestrate-"));
});

afterEach(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

describe("runExecution", () => {
  it("happy path: calls preflight -> bridge -> swap in order and returns all results", async () => {
    const deps = makeDeps();

    const outcome = await runExecution({ ...PARAMS, baseDir }, deps);

    expect(outcome.isOk()).toBe(true);
    const { record, bridgeResult, swapResult } = outcome._unsafeUnwrap();
    expect(record.state).toBe("completed");
    expect(bridgeResult).toBe(BRIDGE_RESULT);
    expect(swapResult).toBe(SWAP_RESULT);

    const preflightSpy = deps.runPreflight as ReturnType<typeof vi.fn>;
    const bridgeSpy = deps.runBridge as ReturnType<typeof vi.fn>;
    const swapSpy = deps.runSwap as ReturnType<typeof vi.fn>;
    expect(preflightSpy.mock.invocationCallOrder[0]).toBeLessThan(
      bridgeSpy.mock.invocationCallOrder[0] ?? 0,
    );
    expect(bridgeSpy.mock.invocationCallOrder[0]).toBeLessThan(
      swapSpy.mock.invocationCallOrder[0] ?? 0,
    );

    expect(preflightSpy).toHaveBeenCalledWith({
      sourceChain: "ETHEREUM_SEPOLIA",
      destinationChain: "ARC_TESTNET",
      walletId: "wallet-1",
      // swap amount + 0.05 bridge fee + 0.05 Arc gas reserve
      amount: "100.1",
      token: "USDC",
    });
    // Chain keys must be mapped to App Kit names, not passed through.
    expect(bridgeSpy.mock.calls[0]?.[0]).toMatchObject({
      fromChain: "Ethereum_Sepolia",
      toChain: "Arc_Testnet",
      fromAddress: "0xsource",
      toAddress: "0xarc",
      amount: "100.1",
      baseDir,
    });
    expect(swapSpy.mock.calls[0]?.[0]).toMatchObject({
      fromAddress: "0xarc",
      tokenIn: "USDC",
      tokenOut: "WETH",
      amountIn: "100",
      slippageBps: 300,
      baseDir,
    });

    // The orchestrator persists the initial "preflight" state and, once the
    // bridge is done, the bridge evidence; other states are persisted inside
    // runBridge/runSwap.
    const saveSpy = deps.saveExecution as ReturnType<typeof vi.fn>;
    const saved = saveSpy.mock.calls.map(([r]) => r as ExecutionRecord);
    expect(saved.map((r) => r.state)).toEqual(["preflight", "minting"]);
    expect(saved[0]?.plan).toMatchObject({
      arcAddress: "0xarc",
      tokenOut: "WETH",
      amountIn: "100",
    });
    expect(saved[1]?.evidence).toEqual([
      { step: "approve", txHash: "0xapprove" },
      { step: "burn", txHash: "0xburn" },
      { step: "mint", txHash: "0xmint" },
    ]);
  });

  it("with arcWalletId: a balance guard is passed to runSwap with the M4 retry delays", async () => {
    const getTokenBalances = vi.fn(async () =>
      ok([{ symbol: "USDC", amount: "150", decimals: 6, tokenAddress: "0x36" }]),
    );
    const deps = makeDeps({ getTokenBalances });

    const outcome = await runExecution({ ...PARAMS, arcWalletId: "arc-wallet", baseDir }, deps);

    expect(outcome.isOk()).toBe(true);
    expect(getTokenBalances).toHaveBeenCalledWith("arc-wallet");
    const [swapParams, swapDeps] = (deps.runSwap as ReturnType<typeof vi.fn>).mock.calls[0] ?? [];
    expect(swapParams.retryDelaysMs).toEqual([5_000, 15_000, 45_000]);
    expect(typeof swapDeps.checkUnswapped).toBe("function");
  });

  it("without arcWalletId: no balance guard, so runSwap cannot retry", async () => {
    const deps = makeDeps();

    await runExecution({ ...PARAMS, baseDir }, deps);

    const [, swapDeps] = (deps.runSwap as ReturnType<typeof vi.fn>).mock.calls[0] ?? [];
    expect(swapDeps.checkUnswapped).toBeUndefined();
  });

  it("swap_only route: UNSUPPORTED_ROUTE, no dep is ever called", async () => {
    const deps = makeDeps();

    const outcome = await runExecution({ ...PARAMS, route: SWAP_ONLY_ROUTE, baseDir }, deps);

    expect(outcome.isErr()).toBe(true);
    const error = outcome._unsafeUnwrapErr();
    expect(error.code).toBe("UNSUPPORTED_ROUTE");
    expect(error.message).toContain("only executable on ARC_TESTNET");
    expect(deps.saveExecution).not.toHaveBeenCalled();
    expect(deps.runPreflight).not.toHaveBeenCalled();
    expect(deps.runBridge).not.toHaveBeenCalled();
    expect(deps.runSwap).not.toHaveBeenCalled();
  });

  it("swap on Arc: preflight on the Arc wallet, no bridge, swap from preflight", async () => {
    const deps = makeDeps({
      runSwap: vi.fn((params: RunSwapParams) => {
        let record = params.record;
        for (const state of ["swapping", "completed"] as const) {
          record = applyTransition(record, state)._unsafeUnwrap();
        }
        return okAsync({ record, result: SWAP_RESULT });
      }),
    });
    const arcRoute: RouteOption = {
      ...ROUTE,
      strategy: "swap_only",
      sourceChain: "ARC_TESTNET",
      bridgeFee: { amount: "0", source: "fixed" },
    };

    const outcome = await runExecution({ ...PARAMS, route: arcRoute, baseDir }, deps);

    const { record, bridgeResult } = outcome._unsafeUnwrap();
    expect(record.state).toBe("completed");
    expect(bridgeResult).toBeNull();
    expect(deps.runBridge).not.toHaveBeenCalled();
    expect(deps.runPreflight).toHaveBeenCalledWith(
      expect.objectContaining({ sourceChain: "ARC_TESTNET", amount: "100.05", token: "USDC" }),
    );
    const swapRecord = (deps.runSwap as ReturnType<typeof vi.fn>).mock.calls[0]?.[0].record;
    expect(swapRecord.state).toBe("preflight");
  });

  it("non-Arc destination: UNSUPPORTED_ROUTE before any funds move", async () => {
    const deps = makeDeps();
    const baseRoute: RouteOption = { ...ROUTE, destinationChain: "BASE_SEPOLIA" };

    const outcome = await runExecution({ ...PARAMS, route: baseRoute, baseDir }, deps);

    expect(outcome.isErr()).toBe(true);
    const error = outcome._unsafeUnwrapErr();
    expect(error.code).toBe("UNSUPPORTED_ROUTE");
    expect(error.message).toContain("BASE_SEPOLIA");
    expect(deps.saveExecution).not.toHaveBeenCalled();
    expect(deps.runBridge).not.toHaveBeenCalled();
    expect(deps.runSwap).not.toHaveBeenCalled();
  });

  it("initial persist fails: PERSISTENCE_FAILURE, preflight never runs", async () => {
    const persistError = new ExecutorError("disk full", "PERSISTENCE_FAILURE");
    const deps = makeDeps({ saveExecution: vi.fn(() => errAsync(persistError)) });

    const outcome = await runExecution({ ...PARAMS, baseDir }, deps);

    expect(outcome.isErr()).toBe(true);
    expect(outcome._unsafeUnwrapErr()).toBe(persistError);
    expect(deps.runPreflight).not.toHaveBeenCalled();
    expect(deps.runBridge).not.toHaveBeenCalled();
  });

  it("preflight err passes through unchanged", async () => {
    const preflightError = new ExecutorError("boom", "PREFLIGHT_FAILED");
    const deps = makeDeps({ runPreflight: vi.fn(() => errAsync(preflightError)) });

    const outcome = await runExecution({ ...PARAMS, baseDir }, deps);

    expect(outcome.isErr()).toBe(true);
    expect(outcome._unsafeUnwrapErr()).toBe(preflightError);
    expect(deps.runBridge).not.toHaveBeenCalled();
    expect(deps.runSwap).not.toHaveBeenCalled();
  });

  it("preflight passed:false: record ends failed_funds_safe, error names the failing checks", async () => {
    const failedReport: PreflightReport = {
      passed: false,
      checks: [
        { name: "config", passed: true, detail: "all set" },
        { name: "balance", passed: false, detail: "Insufficient USDC: have 1, need 100" },
      ],
    };
    const deps = makeDeps({ runPreflight: vi.fn(() => okAsync(failedReport)) });

    const outcome = await runExecution({ ...PARAMS, baseDir }, deps);

    expect(outcome.isErr()).toBe(true);
    const error = outcome._unsafeUnwrapErr();
    expect(error.code).toBe("PREFLIGHT_FAILED");
    expect(error.message).toContain("balance: Insufficient USDC: have 1, need 100");
    expect(error.message).not.toContain("config");

    const saveSpy = deps.saveExecution as ReturnType<typeof vi.fn>;
    const lastSaved = saveSpy.mock.calls.at(-1)?.[0] as ExecutionRecord;
    expect(lastSaved.state).toBe("failed_funds_safe");
    expect(lastSaved.history.at(-1)).toMatchObject({
      from: "preflight",
      to: "failed_funds_safe",
    });
    expect(deps.runBridge).not.toHaveBeenCalled();
    expect(deps.runSwap).not.toHaveBeenCalled();
  });

  it("bridge err passes through unchanged, swap never runs", async () => {
    const bridgeError = new ExecutorError(
      'Bridge failed at step "burn": rpc down',
      "BRIDGE_FAILED",
      undefined,
      "burn",
    );
    const deps = makeDeps({ runBridge: vi.fn(() => errAsync(bridgeError)) });

    const outcome = await runExecution({ ...PARAMS, baseDir }, deps);

    expect(outcome.isErr()).toBe(true);
    expect(outcome._unsafeUnwrapErr()).toBe(bridgeError);
    expect(deps.runSwap).not.toHaveBeenCalled();
  });

  it("swap err after successful bridge: bridge tx hashes are appended to the message", async () => {
    const swapError = new ExecutorError("Swap failed: slippage exceeded", "SWAP_FAILED");
    const deps = makeDeps({ runSwap: vi.fn(() => errAsync(swapError)) });

    const outcome = await runExecution({ ...PARAMS, baseDir }, deps);

    expect(outcome.isErr()).toBe(true);
    const error = outcome._unsafeUnwrapErr();
    expect(error.code).toBe("SWAP_FAILED");
    expect(error.message).toContain("Swap failed: slippage exceeded");
    expect(error.message).toContain("bridge completed on-chain:");
    expect(error.message).toContain("burn 0xburn");
    expect(error.message).toContain("mint 0xmint");
  });
});
