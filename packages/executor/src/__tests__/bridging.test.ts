import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BridgeParams, BridgeResult, BridgeStep } from "@astrolabe/circle";
import { type Result, ResultAsync, err, ok } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type RunBridgeDeps, runBridge } from "../bridging.js";
import { type ExecutionRecord, applyTransition, createExecution } from "../execution.js";
import { saveExecution } from "../persistence.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const BRIDGE_PARAMS = {
  fromChain: "Ethereum_Sepolia",
  toChain: "Base_Sepolia",
  fromAddress: "0xfrom",
  toAddress: "0xto",
  amount: "50",
} as const;

const SUCCESS_RESULT: BridgeResult = {
  state: "success",
  amount: "50",
  steps: [
    { name: "approve", state: "success" },
    { name: "burn", state: "success" },
    { name: "fetchAttestation", state: "success" },
    { name: "mint", state: "success" },
  ],
};

/** A fake bridgeUSDC that fires onStep for each given step name, in order, then resolves. */
function makeBridgeUSDC(
  steps: BridgeStep["name"][],
  finalResult: Result<BridgeResult, Error>,
): typeof import("@astrolabe/circle").bridgeUSDC {
  return async (params: BridgeParams) => {
    for (const name of steps) {
      params.onStep?.({ name, state: "success" });
    }
    return finalResult;
  };
}

function startingRecord(): ExecutionRecord {
  return applyTransition(createExecution(), "preflight")._unsafeUnwrap();
}

let baseDir: string;

beforeEach(async () => {
  baseDir = await mkdtemp(join(tmpdir(), "astrolabe-executor-bridge-"));
});

afterEach(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

describe("runBridge", () => {
  it("happy path: transitions burning -> awaiting_attestation -> minting with correct history", async () => {
    const saveSpy = vi.fn((record: ExecutionRecord, dir?: string) => saveExecution(record, dir));
    const deps: RunBridgeDeps = {
      bridgeUSDC: makeBridgeUSDC(
        ["approve", "burn", "fetchAttestation", "mint"],
        ok(SUCCESS_RESULT),
      ),
      saveExecution: saveSpy,
    };
    const record = startingRecord();

    const outcome = await runBridge({ record, baseDir, ...BRIDGE_PARAMS }, deps);

    expect(outcome.isOk()).toBe(true);
    const { record: finalRecord, result } = outcome._unsafeUnwrap();
    expect(finalRecord.state).toBe("minting");
    expect(result).toBe(SUCCESS_RESULT);
    expect(finalRecord.history.map((h) => `${h.from}->${h.to}`)).toEqual([
      "created->preflight",
      "preflight->burning",
      "burning->awaiting_attestation",
      "awaiting_attestation->minting",
    ]);
  });

  it("approve and mint steps cause no state transition or extra persistence call", async () => {
    const saveSpy = vi.fn((record: ExecutionRecord, dir?: string) => saveExecution(record, dir));
    const deps: RunBridgeDeps = {
      bridgeUSDC: makeBridgeUSDC(
        ["approve", "burn", "fetchAttestation", "mint"],
        ok(SUCCESS_RESULT),
      ),
      saveExecution: saveSpy,
    };
    const record = startingRecord();

    await runBridge({ record, baseDir, ...BRIDGE_PARAMS }, deps);

    // 1 save for the initial preflight -> burning transition, plus one each
    // for burn and fetchAttestation. approve/mint add none.
    expect(saveSpy).toHaveBeenCalledTimes(3);
    const savedStates = saveSpy.mock.calls.map(([r]) => r.state);
    expect(savedStates).toEqual(["burning", "awaiting_attestation", "minting"]);
  });

  it("failure at burn: ends in failed_funds_safe with BRIDGE_FAILED / failedStep burn", async () => {
    const saveSpy = vi.fn((record: ExecutionRecord, dir?: string) => saveExecution(record, dir));
    const deps: RunBridgeDeps = {
      bridgeUSDC: makeBridgeUSDC(
        ["approve"],
        err(new Error('Bridge failed at step "burn": transaction reverted')),
      ),
      saveExecution: saveSpy,
    };
    const record = startingRecord();

    const outcome = await runBridge({ record, baseDir, ...BRIDGE_PARAMS }, deps);

    expect(outcome.isErr()).toBe(true);
    const error = outcome._unsafeUnwrapErr();
    expect(error.code).toBe("BRIDGE_FAILED");
    expect(error.failedStep).toBe("burn");

    // Confirm the persisted record actually ended up failed_funds_safe.
    const lastSaved = saveSpy.mock.calls.at(-1)?.[0] as ExecutionRecord;
    expect(lastSaved.state).toBe("failed_funds_safe");
    expect(lastSaved.history.at(-1)).toMatchObject({
      from: "burning",
      to: "failed_funds_safe",
    });
  });

  it("failure at mint: ends in failed_funds_safe with BRIDGE_FAILED / failedStep mint", async () => {
    const saveSpy = vi.fn((record: ExecutionRecord, dir?: string) => saveExecution(record, dir));
    const deps: RunBridgeDeps = {
      bridgeUSDC: makeBridgeUSDC(
        ["approve", "burn", "fetchAttestation"],
        err(new Error('Bridge failed at step "mint": insufficient attestation')),
      ),
      saveExecution: saveSpy,
    };
    const record = startingRecord();

    const outcome = await runBridge({ record, baseDir, ...BRIDGE_PARAMS }, deps);

    expect(outcome.isErr()).toBe(true);
    const error = outcome._unsafeUnwrapErr();
    expect(error.code).toBe("BRIDGE_FAILED");
    expect(error.failedStep).toBe("mint");

    const lastSaved = saveSpy.mock.calls.at(-1)?.[0] as ExecutionRecord;
    expect(lastSaved.state).toBe("failed_funds_safe");
    // The record progressed through minting (via fetchAttestation) before failing.
    expect(lastSaved.history.map((h) => h.to)).toEqual([
      "preflight",
      "burning",
      "awaiting_attestation",
      "minting",
      "failed_funds_safe",
    ]);
  });

  it("serializes persistence writes in step order even when a later save resolves faster", async () => {
    const saveOrder: string[] = [];
    const fakeSave: RunBridgeDeps["saveExecution"] = (record) =>
      ResultAsync.fromSafePromise(
        (async () => {
          // awaiting_attestation's save is slow; minting's save is fast.
          // Without serialization the fast one could resolve first and
          // corrupt the persisted order.
          await sleep(record.state === "awaiting_attestation" ? 30 : 5);
          saveOrder.push(record.state);
          return record;
        })(),
      );
    const deps: RunBridgeDeps = {
      bridgeUSDC: makeBridgeUSDC(
        ["approve", "burn", "fetchAttestation", "mint"],
        ok(SUCCESS_RESULT),
      ),
      saveExecution: fakeSave,
    };
    const record = startingRecord();

    await runBridge({ record, baseDir, ...BRIDGE_PARAMS }, deps);

    expect(saveOrder).toEqual(["burning", "awaiting_attestation", "minting"]);
  });
});
