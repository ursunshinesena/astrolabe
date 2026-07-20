import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyTransition, createExecution } from "../execution.js";
import { loadExecution, saveExecution } from "../persistence.js";

let baseDir: string;

beforeEach(async () => {
  baseDir = await mkdtemp(join(tmpdir(), "astrolabe-executor-"));
});

afterEach(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

describe("saveExecution / loadExecution", () => {
  it("round-trips a record: save then load equals original", async () => {
    const record = applyTransition(createExecution(), "preflight")._unsafeUnwrap();
    const saved = await saveExecution(record, baseDir);
    expect(saved.isOk()).toBe(true);
    const loaded = await loadExecution(record.id, baseDir);
    expect(loaded.isOk()).toBe(true);
    expect(loaded._unsafeUnwrap()).toEqual(record);
  });

  it("writes pretty-printed JSON with a trailing newline and no leftover tmp file", async () => {
    const record = createExecution();
    await saveExecution(record, baseDir);
    const filePath = join(baseDir, ".astrolabe", "executions", `${record.id}.json`);
    const raw = await readFile(filePath, "utf8");
    expect(raw).toBe(`${JSON.stringify(record, null, 2)}\n`);
    await expect(readFile(`${filePath}.tmp`, "utf8")).rejects.toThrow();
  });

  it("returns PERSISTENCE_FAILURE when loading a missing id", async () => {
    const result = await loadExecution("exec_does-not-exist_000000", baseDir);
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe("PERSISTENCE_FAILURE");
  });

  it("returns PERSISTENCE_FAILURE for a corrupted JSON file", async () => {
    const record = createExecution();
    await saveExecution(record, baseDir);
    const filePath = join(baseDir, ".astrolabe", "executions", `${record.id}.json`);
    await writeFile(filePath, "{ not valid json", "utf8");
    const result = await loadExecution(record.id, baseDir);
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe("PERSISTENCE_FAILURE");
  });

  it("returns PERSISTENCE_FAILURE for valid JSON that fails shape validation", async () => {
    const record = createExecution();
    await saveExecution(record, baseDir);
    const filePath = join(baseDir, ".astrolabe", "executions", `${record.id}.json`);
    await writeFile(
      filePath,
      `${JSON.stringify({ id: record.id, state: "warp_drive" })}\n`,
      "utf8",
    );
    const result = await loadExecution(record.id, baseDir);
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe("PERSISTENCE_FAILURE");
  });

  it("returns PERSISTENCE_FAILURE when saving to an unwritable location", async () => {
    const record = createExecution();
    const filePath = join(baseDir, ".astrolabe");
    await writeFile(filePath, "not a directory", "utf8");
    const result = await saveExecution(record, baseDir);
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe("PERSISTENCE_FAILURE");
  });
});
