/**
 * M4b fault injection: swaps that fail transiently, swaps whose outcome is
 * unknown, and executions interrupted at every persisted state.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BridgeFailure, type SwapOnArcResult, type TokenBalance } from "@astrolabe/circle";
import { err, ok } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ExecutionRecord, applyTransition, createExecution } from "../execution.js";
import { loadExecution, saveExecution } from "../persistence.js";
import { type ResumeExecutionDeps, resumeExecution } from "../resume.js";
import { makeBalanceGuard } from "../swap-guard.js";
import { type RunSwapDeps, runSwap } from "../swapping.js";

const SWAP_PARAMS = {
  fromAddress: "0xarc",
  tokenIn: "USDC",
  tokenOut: "EURC",
  amountIn: "10",
  apiKey: "k",
  entitySecret: "s",
} as const;

const SUCCESS: SwapOnArcResult = {
  txHash: "0xswap",
  amountIn: "10",
  amountOut: "8.6",
  explorerUrl: "https://testnet.arcscan.app/tx/0xswap",
};

const noSleep = vi.fn(async () => {});

function usdc(amount: string): TokenBalance[] {
  return [{ symbol: "USDC", amount, decimals: 6, tokenAddress: "0x36" }];
}

function recordIn(state: ExecutionRecord["state"]): ExecutionRecord {
  const path = ["preflight", "burning", "awaiting_attestation", "minting", "swapping"] as const;
  let record: ExecutionRecord = {
    ...createExecution(),
    plan: {
      arcAddress: "0xarc",
      arcWalletId: "arc-w",
      tokenIn: "USDC",
      tokenOut: "EURC",
      amountIn: "10",
    },
  };
  for (const next of path) {
    if (record.state === state) break;
    record = applyTransition(record, next)._unsafeUnwrap();
  }
  return record;
}

let baseDir: string;
beforeEach(async () => {
  baseDir = await mkdtemp(join(tmpdir(), "astrolabe-m4b-"));
  noSleep.mockClear();
});
afterEach(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

describe("runSwap retries (guarded)", () => {
  it("transient failures: retries with the configured waits, then completes with evidence", async () => {
    const swapOnArc = vi
      .fn()
      .mockRejectedValueOnce(new Error("rpc timeout"))
      .mockRejectedValueOnce(new Error("rpc timeout"))
      .mockResolvedValueOnce(SUCCESS);
    const checkUnswapped = vi.fn(async () => ok(true));
    const deps: RunSwapDeps = { swapOnArc, saveExecution, checkUnswapped, sleep: noSleep };

    const outcome = await runSwap(
      { record: recordIn("minting"), baseDir, ...SWAP_PARAMS, retryDelaysMs: [5, 15, 45] },
      deps,
    );

    expect(outcome.isOk()).toBe(true);
    expect(swapOnArc).toHaveBeenCalledTimes(3);
    expect(noSleep.mock.calls).toEqual([[5], [15]]);
    const { record } = outcome._unsafeUnwrap();
    expect(record.state).toBe("completed");
    expect(record.evidence).toEqual([
      { step: "swap", txHash: "0xswap", explorerUrl: SUCCESS.explorerUrl },
    ]);
  });

  it("retries exhausted: failed_funds_safe, error names the attempts and where the USDC is", async () => {
    const swapOnArc = vi.fn().mockRejectedValue(new Error("no liquidity"));
    const deps: RunSwapDeps = {
      swapOnArc,
      saveExecution,
      checkUnswapped: async () => ok(true),
      sleep: noSleep,
    };

    const outcome = await runSwap(
      { record: recordIn("minting"), baseDir, ...SWAP_PARAMS, retryDelaysMs: [5, 15, 45] },
      deps,
    );

    expect(swapOnArc).toHaveBeenCalledTimes(4);
    expect(outcome._unsafeUnwrapErr().code).toBe("SWAP_FAILED");
    expect(outcome._unsafeUnwrapErr().message).toContain("after 4 attempts");
    const saved = await findOnlyRecord();
    expect(saved.state).toBe("failed_funds_safe");
    expect(saved.error).toContain("USDC remains on Arc at 0xarc");
  });

  it("outcome unknown: stops at once, stays in swapping and is never marked funds-safe", async () => {
    const swapOnArc = vi.fn().mockRejectedValue(new Error("response lost"));
    const deps: RunSwapDeps = {
      swapOnArc,
      saveExecution,
      checkUnswapped: async () => ok(false),
      sleep: noSleep,
    };

    const outcome = await runSwap(
      { record: recordIn("minting"), baseDir, ...SWAP_PARAMS, retryDelaysMs: [5, 15, 45] },
      deps,
    );

    expect(swapOnArc).toHaveBeenCalledTimes(1);
    expect(outcome._unsafeUnwrapErr().code).toBe("SWAP_UNCERTAIN");
    const saved = await findOnlyRecord();
    expect(saved.state).toBe("swapping");
    expect(saved.error).toContain("uncertain");
  });

  it("no guard: never retries even when delays are configured", async () => {
    const swapOnArc = vi.fn().mockRejectedValue(new Error("boom"));
    const outcome = await runSwap(
      { record: recordIn("minting"), baseDir, ...SWAP_PARAMS, retryDelaysMs: [5, 15, 45] },
      { swapOnArc, saveExecution, sleep: noSleep },
    );
    expect(swapOnArc).toHaveBeenCalledTimes(1);
    expect(outcome._unsafeUnwrapErr().code).toBe("SWAP_FAILED");
  });
});

describe("makeBalanceGuard", () => {
  it("proves unswapped while the balance holds, flags a spend of the amount", async () => {
    const reads = [usdc("25"), usdc("24.99"), usdc("15")];
    const guard = await makeBalanceGuard({
      walletId: "w",
      token: "USDC",
      amountIn: "10",
      getTokenBalances: async () => ok(reads.shift() ?? []),
    });
    expect(guard).not.toBeNull();
    expect((await guard?.())?._unsafeUnwrap()).toBe(true); // only gas moved
    expect((await guard?.())?._unsafeUnwrap()).toBe(false); // amountIn spent
  });

  it("returns null when the snapshot fails or the balance is below amountIn", async () => {
    expect(
      await makeBalanceGuard({
        walletId: "w",
        token: "USDC",
        amountIn: "10",
        getTokenBalances: async () => err(new Error("x")),
      }),
    ).toBeNull();
    expect(
      await makeBalanceGuard({
        walletId: "w",
        token: "USDC",
        amountIn: "10",
        getTokenBalances: async () => ok(usdc("3")),
      }),
    ).toBeNull();
  });
});

describe("resumeExecution", () => {
  function deps(overrides: Partial<ResumeExecutionDeps> = {}): ResumeExecutionDeps {
    return {
      loadExecution,
      saveExecution,
      runSwap: vi.fn(),
      swapOnArc: vi.fn(async () => SUCCESS),
      retryBridge: vi.fn(async () =>
        ok({
          state: "success",
          amount: "10.07",
          steps: [
            { name: "burn", state: "success", txHash: "0xburn" },
            { name: "mint", state: "success", txHash: "0xmint" },
          ],
        }),
      ),
      getTokenBalances: async () => ok(usdc("10")),
      sleep: noSleep,
      ...overrides,
    };
  }
  const resume = (id: string, d: ResumeExecutionDeps) =>
    resumeExecution({ id, apiKey: "k", entitySecret: "s", baseDir }, d);

  it("terminal records are left alone", async () => {
    const record = applyTransition(recordIn("minting"), "failed_funds_safe")._unsafeUnwrap();
    await saveExecution(record, baseDir);
    const out = await resume(record.id, deps());
    expect(out._unsafeUnwrap().action).toBe("none");
  });

  it("interrupted before the burn: closed as failed_funds_safe", async () => {
    const record = recordIn("preflight");
    await saveExecution(record, baseDir);
    const out = await resume(record.id, deps());
    expect(out._unsafeUnwrap()).toMatchObject({
      action: "closed",
      record: { state: "failed_funds_safe" },
    });
  });

  it.each(["burning", "awaiting_attestation", "swapping"] as const)(
    "interrupted in %s: RESUME_UNSUPPORTED, nothing is sent",
    async (state) => {
      const record = recordIn(state);
      await saveExecution(record, baseDir);
      const d = deps();
      const out = await resume(record.id, d);
      expect(out._unsafeUnwrapErr().code).toBe("RESUME_UNSUPPORTED");
      expect(d.runSwap).not.toHaveBeenCalled();
    },
  );

  it("interrupted in minting with USDC on Arc: runs the guarded swap to completion", async () => {
    const record = recordIn("minting");
    await saveExecution(record, baseDir);
    // The real runSwap, with only the chain call faked.
    const d = deps({ runSwap });

    const out = await resume(record.id, d);

    expect(out.isOk()).toBe(true);
    expect(out._unsafeUnwrap()).toMatchObject({
      action: "swapped",
      record: { state: "completed" },
    });
    expect(d.swapOnArc).toHaveBeenCalledTimes(1);
  });

  it("bridge failed after the burn: retryBridge finishes it, then the swap runs", async () => {
    const record = {
      ...recordIn("awaiting_attestation"),
      evidence: [{ step: "burn", txHash: "0xburn" }],
      bridgeRaw: { state: "error" },
    };
    await saveExecution(record, baseDir);
    const d = deps({ runSwap });

    const out = await resume(record.id, d);

    expect(d.retryBridge).toHaveBeenCalledWith({ state: "error" });
    const result = out._unsafeUnwrap();
    expect(result.action).toBe("bridged_and_swapped");
    expect(result.record.state).toBe("completed");
    expect(result.record.bridgeRaw).toBeUndefined();
    expect(result.record.evidence?.map((e) => e.step)).toEqual(["burn", "mint", "swap"]);
  });

  it("bridge retry fails again: BRIDGE_FAILED, newer App Kit result kept, no swap", async () => {
    const record = { ...recordIn("minting"), bridgeRaw: { state: "error", attempt: 1 } };
    await saveExecution(record, baseDir);
    const newer = { state: "error", attempt: 2 };
    const d = deps({
      retryBridge: vi.fn(async () => err(new BridgeFailure("mint reverted", newer))),
    });

    const out = await resume(record.id, d);

    expect(out._unsafeUnwrapErr().code).toBe("BRIDGE_FAILED");
    expect(d.swapOnArc).not.toHaveBeenCalled();
    const saved = (await loadExecution(record.id, baseDir))._unsafeUnwrap();
    expect(saved.state).toBe("minting");
    expect(saved.bridgeRaw).toEqual(newer);
  });

  it("interrupted in minting before the USDC arrived: RESUME_UNSUPPORTED", async () => {
    const record = recordIn("minting");
    await saveExecution(record, baseDir);
    const out = await resume(record.id, deps({ getTokenBalances: async () => ok(usdc("0")) }));
    expect(out._unsafeUnwrapErr().message).toContain("not confirmed on Arc");
  });
});

async function findOnlyRecord(): Promise<ExecutionRecord> {
  const { readdir } = await import("node:fs/promises");
  const files = await readdir(join(baseDir, ".astrolabe", "executions"));
  const id = files[0]?.replace(/\.json$/, "") ?? "";
  return (await loadExecution(id, baseDir))._unsafeUnwrap();
}
