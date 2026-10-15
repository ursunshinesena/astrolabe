import { randomUUID } from "node:crypto";
import type {
  ExecutionRecord,
  ExecutorError,
  RunExecutionParams,
  RunExecutionResult,
} from "@astrolabe/executor";
import type { ResultAsync } from "neverthrow";
import type { QuoteOutcome, RouteView } from "./quotes.js";

const QUOTE_TTL_MS = 2 * 60_000;

type StoredQuote = { outcome: QuoteOutcome; createdAt: number };

export type ExecutionServiceDeps = {
  runExecution: (
    params: RunExecutionParams,
    deps: {
      saveExecution: (
        r: ExecutionRecord,
        dir?: string,
      ) => ResultAsync<ExecutionRecord, ExecutorError>;
    },
  ) => ResultAsync<RunExecutionResult, ExecutorError>;
  saveExecution: (r: ExecutionRecord, dir?: string) => ResultAsync<ExecutionRecord, ExecutorError>;
  loadExecution: (id: string, dir?: string) => ResultAsync<ExecutionRecord, ExecutorError>;
  now?: () => number;
};

export type WalletConfig = {
  walletId: string;
  sourceAddress: string;
  arcAddress: string;
  arcWalletId?: string;
};

export type StartResult =
  | { ok: true; executionId: string }
  | { ok: false; status: 400 | 404 | 409 | 410 | 500; error: string };

/**
 * Holds quotes server-side (the client approves a quote id, never sends a
 * route of its own) and starts at most one execution per quote: the quote id
 * is the intent id for idempotency (CLAUDE.md §6.4).
 */
export class ExecutionService {
  private readonly quotes = new Map<string, StoredQuote>();
  private readonly started = new Map<string, string>();
  private readonly finalErrors = new Map<string, string>();

  constructor(
    private readonly deps: ExecutionServiceDeps,
    private readonly baseDir: string,
  ) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  storeQuote(outcome: QuoteOutcome): string {
    const id = randomUUID();
    this.quotes.set(id, { outcome, createdAt: this.now() });
    return id;
  }

  async start(quoteId: string, wallet: WalletConfig): Promise<StartResult> {
    if (this.started.has(quoteId)) {
      return { ok: false, status: 409, error: "This quote has already been executed" };
    }
    const stored = this.quotes.get(quoteId);
    if (!stored) return { ok: false, status: 404, error: "Unknown quote" };
    if (this.now() - stored.createdAt > QUOTE_TTL_MS) {
      return { ok: false, status: 410, error: "Quote expired — request a fresh one" };
    }
    const route: RouteView | null = stored.outcome.winner;
    if (!route?.executable) {
      return { ok: false, status: 400, error: route?.reason ?? "No executable route" };
    }
    // Claim the quote before any await so a concurrent duplicate is rejected.
    this.started.set(quoteId, "");

    let resolveId: (id: string) => void = () => {};
    const firstSave = new Promise<string>((resolve) => {
      resolveId = resolve;
    });
    const save = (record: ExecutionRecord, dir?: string) => {
      resolveId(record.id);
      return this.deps.saveExecution(record, dir);
    };

    const run = this.deps
      .runExecution({ route, ...wallet, baseDir: this.baseDir }, { saveExecution: save })
      .then((outcome) => {
        if (outcome.isErr()) {
          // Remember the reason even when the executor rejected before
          // persisting anything (e.g. an unsupported route).
          firstSave.then((id) => this.finalErrors.set(id, outcome.error.message));
          resolveId(`rejected_${quoteId}`);
          this.finalErrors.set(
            `rejected_${quoteId}`,
            `${outcome.error.code}: ${outcome.error.message}`,
          );
        }
        return outcome;
      });
    void run;

    const executionId = await firstSave;
    this.started.set(quoteId, executionId);
    return { ok: true, executionId };
  }

  async status(
    id: string,
  ): Promise<{ record: ExecutionRecord | null; error: string | null } | null> {
    const loaded = await this.deps.loadExecution(id, this.baseDir);
    const finalError = this.finalErrors.get(id) ?? null;
    if (loaded.isOk()) {
      return { record: loaded.value, error: loaded.value.error ?? finalError };
    }
    if (finalError) return { record: null, error: finalError };
    return null;
  }
}
