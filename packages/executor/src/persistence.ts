import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ResultAsync } from "neverthrow";
import { z } from "zod";
import { ExecutorError } from "./errors.js";
import type { ExecutionRecord } from "./execution.js";
import { EXECUTOR_STATES } from "./states.js";

const TransitionRecordSchema = z.object({
  from: z.enum(EXECUTOR_STATES),
  to: z.enum(EXECUTOR_STATES),
  at: z.string(),
});

const ExecutionRecordSchema = z.object({
  id: z.string(),
  state: z.enum(EXECUTOR_STATES),
  createdAt: z.string(),
  updatedAt: z.string(),
  history: z.array(TransitionRecordSchema),
  error: z.string().nullable(),
  evidence: z
    .array(z.object({ step: z.string(), txHash: z.string(), explorerUrl: z.string().optional() }))
    .optional(),
  plan: z
    .object({
      sourceChain: z.string().optional(),
      arcAddress: z.string(),
      arcWalletId: z.string().optional(),
      tokenIn: z.string(),
      tokenOut: z.string(),
      amountIn: z.string(),
      slippageBps: z.number().int().optional(),
    })
    .optional(),
  bridgeRaw: z.unknown().optional(),
});

function executionsDir(baseDir: string): string {
  return join(baseDir, ".astrolabe", "executions");
}

export function saveExecution(
  record: ExecutionRecord,
  baseDir: string = process.cwd(),
): ResultAsync<ExecutionRecord, ExecutorError> {
  const dir = executionsDir(baseDir);
  const finalPath = join(dir, `${record.id}.json`);
  const tmpPath = `${finalPath}.tmp`;
  return ResultAsync.fromPromise(
    (async () => {
      await mkdir(dir, { recursive: true });
      await writeFile(tmpPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
      await rename(tmpPath, finalPath);
      return record;
    })(),
    (e) =>
      new ExecutorError(
        `Failed to save execution ${record.id}: ${e instanceof Error ? e.message : String(e)}`,
        "PERSISTENCE_FAILURE",
        e,
      ),
  );
}

export function loadExecution(
  id: string,
  baseDir: string = process.cwd(),
): ResultAsync<ExecutionRecord, ExecutorError> {
  const filePath = join(executionsDir(baseDir), `${id}.json`);
  return ResultAsync.fromPromise(
    (async () => {
      const raw = await readFile(filePath, "utf8");
      const parsed = ExecutionRecordSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        throw new Error(parsed.error.errors[0]?.message ?? "Invalid execution record shape");
      }
      return parsed.data;
    })(),
    (e) =>
      new ExecutorError(
        `Failed to load execution ${id}: ${e instanceof Error ? e.message : String(e)}`,
        "PERSISTENCE_FAILURE",
        e,
      ),
  );
}
