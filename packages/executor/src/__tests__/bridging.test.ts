import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BridgeFailure,
  type BridgeParams,
  type BridgeResult,
  type BridgeStep,
} from "@astrolabe/circle";
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

  it("failure at mint (after the burn): stays in flight with App Kit's result, never funds-safe", async () => {
    const saveSpy = vi.fn((record: ExecutionRecord, dir?: string) => saveExecution(record, dir));
    const raw = { state: "error", steps: [{ name: "burn", state: "success", txHash: "0xb" }] };
    const deps: RunBridgeDeps = {
      bridgeUSDC: makeBridgeUSDC(
        ["approve", "burn", "fetchAttestation"],
        err(new BridgeFailure('Bridge failed at step "mint": insufficient attestation', raw)),
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
    expect(lastSaved.state).toBe("minting");
    expect(lastSaved.bridgeRaw).toEqual(raw);
    expect(lastSaved.error).toContain("in flight");
    expect(saveSpy.mock.calls.some(([r]) => r.state === "failed_funds_safe")).toBe(false);
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

describe("runBridge attestation timeout", () => {
  it("burn done but no attestation in time: ATTESTATION_TIMEOUT, record stays in awaiting_attestation", async () => {
    // Fires approve + burn, then the attestation never arrives.
    const bridgeUSDC: RunBridgeDeps["bridgeUSDC"] = async (params) => {
      params.onStep?.({ name: "approve", state: "success", txHash: "0xa" });
      params.onStep?.({ name: "burn", state: "success", txHash: "0xb" });
      return new Promise(() => {});
    };
    const saveSpy = vi.fn((record: ExecutionRecord, dir?: string) => saveExecution(record, dir));

    const outcome = await runBridge(
      { record: startingRecord(), ...BRIDGE_PARAMS, baseDir, attestationTimeoutMs: 30 },
      { bridgeUSDC, saveExecution: saveSpy },
    );

    expect(outcome.isErr()).toBe(true);
    const error = outcome._unsafeUnwrapErr();
    expect(error.code).toBe("ATTESTATION_TIMEOUT");
    expect(error.failedStep).toBe("fetchAttestation");
    const last = saveSpy.mock.calls.at(-1)?.[0] as ExecutionRecord;
    expect(last.state).toBe("awaiting_attestation");
    expect(last.error).toContain("in flight");
    expect(saveSpy.mock.calls.some(([r]) => r.state === "failed_funds_safe")).toBe(false);
  });

  it("a late attestation is still persisted, with a note", async () => {
    let finish: () => void = () => {};
    const bridgeUSDC: RunBridgeDeps["bridgeUSDC"] = async (params) => {
      params.onStep?.({ name: "burn", state: "success" });
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      params.onStep?.({ name: "fetchAttestation", state: "success" });
      return ok(SUCCESS_RESULT);
    };
    const saveSpy = vi.fn((record: ExecutionRecord, dir?: string) => saveExecution(record, dir));

    const outcome = await runBridge(
      { record: startingRecord(), ...BRIDGE_PARAMS, baseDir, attestationTimeoutMs: 20 },
      { bridgeUSDC, saveExecution: saveSpy },
    );
    expect(outcome._unsafeUnwrapErr().code).toBe("ATTESTATION_TIMEOUT");

    finish();
    await sleep(30);
    const last = saveSpy.mock.calls.at(-1)?.[0] as ExecutionRecord;
    expect(last.state).toBe("minting");
    expect(last.error).toContain("arrived after");
  });

  it("a transfer that fails after the timeout still leaves its App Kit result for resume", async () => {
    let fail: () => void = () => {};
    const raw = { state: "error", steps: [] };
    const bridgeUSDC: RunBridgeDeps["bridgeUSDC"] = async (params) => {
      params.onStep?.({ name: "burn", state: "success", txHash: "0xb" });
      await new Promise<void>((resolve) => {
        fail = resolve;
      });
      return err(new BridgeFailure('Bridge failed at step "fetchAttestation": expired', raw));
    };
    const saveSpy = vi.fn((record: ExecutionRecord, dir?: string) => saveExecution(record, dir));

    const outcome = await runBridge(
      { record: startingRecord(), ...BRIDGE_PARAMS, baseDir, attestationTimeoutMs: 20 },
      { bridgeUSDC, saveExecution: saveSpy },
    );
    expect(outcome._unsafeUnwrapErr().code).toBe("ATTESTATION_TIMEOUT");

    fail();
    await sleep(30);
    const last = saveSpy.mock.calls.at(-1)?.[0] as ExecutionRecord;
    expect(last.state).toBe("awaiting_attestation");
    expect(last.bridgeRaw).toEqual(raw);
  });

  it("an attestation inside the window cancels the timer", async () => {
    const outcome = await runBridge(
      { record: startingRecord(), ...BRIDGE_PARAMS, baseDir, attestationTimeoutMs: 20 },
      {
        bridgeUSDC: makeBridgeUSDC(
          ["approve", "burn", "fetchAttestation", "mint"],
          ok(SUCCESS_RESULT),
        ),
        saveExecution,
      },
    );
    expect(outcome.isOk()).toBe(true);
    await sleep(40); // the timer must not fire after success
    expect(outcome._unsafeUnwrap().record.state).toBe("minting");
  });
});
