import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SwapOnArcParams, SwapOnArcResult } from "@astrolabe/circle";
import { errAsync, okAsync } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExecutorError } from "../errors.js";
import { type ExecutionRecord, applyTransition, createExecution } from "../execution.js";
import { saveExecution } from "../persistence.js";
import { type RunSwapDeps, runSwap } from "../swapping.js";

const SWAP_PARAMS = {
  fromAddress: "0xfrom",
  tokenIn: "USDC",
  tokenOut: "WETH",
  amountIn: "100",
  apiKey: "test-api-key",
  entitySecret: "test-entity-secret",
} as const;

const SUCCESS_RESULT: SwapOnArcResult = {
  txHash: "0xswaphash",
  amountIn: "100",
  amountOut: "0.031",
  explorerUrl: "https://testnet.arcscan.app/tx/0xswaphash",
};

function makeSwapOnArc(result: SwapOnArcResult) {
  return vi.fn(async (_params: SwapOnArcParams) => result);
}

/** A record that has completed the bridge phase and sits in "minting". */
function mintingRecord(): ExecutionRecord {
  let record = createExecution();
  for (const state of ["preflight", "burning", "awaiting_attestation", "minting"] as const) {
    record = applyTransition(record, state)._unsafeUnwrap();
  }
  return record;
}

let baseDir: string;

beforeEach(async () => {
  baseDir = await mkdtemp(join(tmpdir(), "astrolabe-executor-swap-"));
});

afterEach(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

describe("runSwap", () => {
  it("happy path: transitions swapping -> completed, persisting each state", async () => {
    const saveSpy = vi.fn((record: ExecutionRecord, dir?: string) => saveExecution(record, dir));
    const deps: RunSwapDeps = {
      swapOnArc: makeSwapOnArc(SUCCESS_RESULT),
      saveExecution: saveSpy,
    };
    const record = mintingRecord();

    const outcome = await runSwap({ record, baseDir, ...SWAP_PARAMS }, deps);

    expect(outcome.isOk()).toBe(true);
    const { record: finalRecord, result } = outcome._unsafeUnwrap();
    expect(finalRecord.state).toBe("completed");
    expect(result).toBe(SUCCESS_RESULT);
    expect(saveSpy).toHaveBeenCalledTimes(2);
    expect(saveSpy.mock.calls.map(([r]) => r.state)).toEqual(["swapping", "completed"]);
    expect(finalRecord.history.slice(-2)).toMatchObject([
      { from: "minting", to: "swapping" },
      { from: "swapping", to: "completed" },
    ]);
  });

  it("record mid-bridge (burning): INVALID_TRANSITION, swap never called", async () => {
    const swapSpy = makeSwapOnArc(SUCCESS_RESULT);
    const saveSpy = vi.fn((record: ExecutionRecord, dir?: string) => saveExecution(record, dir));
    const deps: RunSwapDeps = { swapOnArc: swapSpy, saveExecution: saveSpy };
    let record = applyTransition(createExecution(), "preflight")._unsafeUnwrap();
    record = applyTransition(record, "burning")._unsafeUnwrap();

    const outcome = await runSwap({ record, baseDir, ...SWAP_PARAMS }, deps);

    expect(outcome.isErr()).toBe(true);
    expect(outcome._unsafeUnwrapErr().code).toBe("INVALID_TRANSITION");
    expect(swapSpy).not.toHaveBeenCalled();
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("initial persist fails: PERSISTENCE_FAILURE, swap never called", async () => {
    const swapSpy = makeSwapOnArc(SUCCESS_RESULT);
    const persistError = new ExecutorError("disk full", "PERSISTENCE_FAILURE");
    const deps: RunSwapDeps = {
      swapOnArc: swapSpy,
      saveExecution: vi.fn(() => errAsync(persistError)),
    };
    const record = mintingRecord();

    const outcome = await runSwap({ record, baseDir, ...SWAP_PARAMS }, deps);

    expect(outcome.isErr()).toBe(true);
    expect(outcome._unsafeUnwrapErr()).toBe(persistError);
    expect(swapSpy).not.toHaveBeenCalled();
  });

  it("swapOnArc throws: record ends failed_funds_safe with SWAP_FAILED", async () => {
    const saveSpy = vi.fn((record: ExecutionRecord, dir?: string) => saveExecution(record, dir));
    const deps: RunSwapDeps = {
      swapOnArc: vi.fn(async () => {
        throw new Error("slippage exceeded");
      }),
      saveExecution: saveSpy,
    };
    const record = mintingRecord();

    const outcome = await runSwap({ record, baseDir, ...SWAP_PARAMS }, deps);

    expect(outcome.isErr()).toBe(true);
    const error = outcome._unsafeUnwrapErr();
    expect(error.code).toBe("SWAP_FAILED");
    expect(error.message).toBe("Swap failed: slippage exceeded");
    // failedStep is bridge-specific and must stay unset for swaps.
    expect(error.failedStep).toBeUndefined();

    const lastSaved = saveSpy.mock.calls.at(-1)?.[0] as ExecutionRecord;
    expect(lastSaved.state).toBe("failed_funds_safe");
    expect(lastSaved.history.at(-1)).toMatchObject({
      from: "swapping",
      to: "failed_funds_safe",
    });
  });

  it("swapOnArc throws and the failure persist also fails: persistence error is surfaced", async () => {
    const persistError = new ExecutorError("disk full", "PERSISTENCE_FAILURE");
    const deps: RunSwapDeps = {
      swapOnArc: vi.fn(async () => {
        throw new Error("slippage exceeded");
      }),
      // First save (swapping) succeeds; the failed_funds_safe save fails.
      saveExecution: vi.fn((record: ExecutionRecord) =>
        record.state === "failed_funds_safe" ? errAsync(persistError) : okAsync(record),
      ),
    };
    const record = mintingRecord();

    const outcome = await runSwap({ record, baseDir, ...SWAP_PARAMS }, deps);

    expect(outcome.isErr()).toBe(true);
    expect(outcome._unsafeUnwrapErr()).toBe(persistError);
    expect(outcome._unsafeUnwrapErr().code).toBe("PERSISTENCE_FAILURE");
  });

  it("swap succeeds but the final persist fails: PERSISTENCE_FAILURE with txHash, no failed_funds_safe", async () => {
    const persistError = new ExecutorError("disk full", "PERSISTENCE_FAILURE");
    const saveSpy = vi.fn((record: ExecutionRecord) =>
      record.state === "completed" ? errAsync(persistError) : okAsync(record),
    );
    const deps: RunSwapDeps = {
      swapOnArc: makeSwapOnArc(SUCCESS_RESULT),
      saveExecution: saveSpy,
    };
    const record = mintingRecord();

    const outcome = await runSwap({ record, baseDir, ...SWAP_PARAMS }, deps);

    expect(outcome.isErr()).toBe(true);
    const error = outcome._unsafeUnwrapErr();
    expect(error.code).toBe("PERSISTENCE_FAILURE");
    expect(error.message).toContain(SUCCESS_RESULT.txHash);
    expect(error.message).toContain("Swap succeeded");
    // The chain says the swap happened, so the record must never be marked
    // failed_funds_safe here.
    expect(saveSpy.mock.calls.map(([r]) => r.state)).toEqual(["swapping", "completed"]);
  });

  it("forwards slippageBps when provided and omits it when not", async () => {
    const swapSpy = makeSwapOnArc(SUCCESS_RESULT);
    const deps: RunSwapDeps = {
      swapOnArc: swapSpy,
      saveExecution: vi.fn((record: ExecutionRecord) => okAsync(record)),
    };

    await runSwap({ record: mintingRecord(), baseDir, ...SWAP_PARAMS, slippageBps: 50 }, deps);
    expect(swapSpy.mock.calls[0]?.[0]).toMatchObject({ ...SWAP_PARAMS, slippageBps: 50 });

    await runSwap({ record: mintingRecord(), baseDir, ...SWAP_PARAMS }, deps);
    // Omitted means the property is absent entirely, letting swapOnArc apply
    // its own default — not present with an undefined value.
    expect(swapSpy.mock.calls[1]?.[0]).not.toHaveProperty("slippageBps");
  });
});
