import type { TokenBalance } from "@astrolabe/circle";
import type { IntentResult } from "@astrolabe/intent-parser";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Result } from "neverthrow";
import { z } from "zod";
import type { ExecutionService, WalletConfig } from "./executions.js";
import { type QuoteDeps, type QuoteOutcome, quoteRoutes } from "./quotes.js";
import { RateLimiter } from "./rate-limit.js";

export type AppDeps = QuoteDeps & {
  parseIntent: (text: string) => Promise<IntentResult>;
  getTokenBalances: (walletId: string) => Promise<Result<TokenBalance[], Error>>;
  executions: ExecutionService;
  /** Null when the Circle wallets are not configured — execution is then disabled. */
  wallet: WalletConfig | null;
  corsOrigin?: string;
  limiter?: RateLimiter;
};

const IntentBody = z.object({ text: z.string().min(1).max(500) });
const QuoteBody = z.object({
  amount: z.string().regex(/^\d+(\.\d+)?$/, "amount must be a positive decimal string"),
  tokenOut: z.string().min(1),
});
const ExecuteBody = z.object({
  quoteId: z.string().uuid(),
  // Dry-run is the default: nothing is sent unless the client explicitly
  // approves the previewed quote (CLAUDE.md §6.6).
  approved: z.literal(true),
});

const EXPLORER_TX: Record<string, string> = {
  ETHEREUM_SEPOLIA: "https://sepolia.etherscan.io/tx/",
  BASE_SEPOLIA: "https://sepolia.basescan.org/tx/",
  ARBITRUM_SEPOLIA: "https://sepolia.arbiscan.io/tx/",
  ARC_TESTNET: "https://testnet.arcscan.app/tx/",
};

/** Which chain each recorded step's transaction lives on (source → Arc route). */
const STEP_CHAIN: Record<string, string> = {
  approve: "ETHEREUM_SEPOLIA",
  burn: "ETHEREUM_SEPOLIA",
  mint: "ARC_TESTNET",
  swap: "ARC_TESTNET",
};

function clientKey(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  const limiter = deps.limiter ?? new RateLimiter();

  app.use("*", cors({ origin: deps.corsOrigin ?? "*" }));

  app.get("/health", (c) => c.json({ status: "ok", timestamp: new Date().toISOString() }));

  app.get("/api/config", (c) =>
    c.json({
      network: "testnet",
      sourceChain: "ETHEREUM_SEPOLIA",
      executionEnabled: deps.wallet !== null,
      sourceAddress: deps.wallet?.sourceAddress ?? null,
      arcAddress: deps.wallet?.arcAddress ?? null,
      explorers: EXPLORER_TX,
    }),
  );

  app.get("/api/balances", async (c) => {
    if (!deps.wallet) return c.json({ error: "Wallets are not configured" }, 503);
    const entries: Array<[string, string | undefined]> = [
      ["ETHEREUM_SEPOLIA", deps.wallet.walletId],
      ["ARC_TESTNET", deps.wallet.arcWalletId],
    ];
    const out: Record<string, TokenBalance[] | { error: string }> = {};
    for (const [chain, id] of entries) {
      if (!id) continue;
      const res = await deps.getTokenBalances(id);
      out[chain] = res.isOk() ? res.value : { error: res.error.message };
    }
    return c.json(out);
  });

  app.post("/api/intents", async (c) => {
    const body = IntentBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "Body must be { text: string }" }, 400);
    return c.json(await deps.parseIntent(body.data.text));
  });

  app.post("/api/quotes", async (c) => {
    const body = QuoteBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return c.json({ error: body.error.errors[0]?.message ?? "Invalid body" }, 400);
    }
    const outcome: QuoteOutcome = await quoteRoutes(
      { ...body.data, ...(deps.wallet ? { arcAddress: deps.wallet.arcAddress } : {}) },
      deps,
    );
    const quoteId = deps.executions.storeQuote(outcome);
    return c.json({ quoteId, ...outcome });
  });

  app.post("/api/executions", async (c) => {
    if (!limiter.allow(clientKey(c.req.raw))) {
      return c.json({ error: "Too many execution requests — max 3 per 10 seconds" }, 429);
    }
    if (!deps.wallet)
      return c.json({ error: "Execution is disabled: wallets not configured" }, 503);
    const body = ExecuteBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return c.json({ error: "Body must be { quoteId, approved: true }" }, 400);
    }
    const started = await deps.executions.start(body.data.quoteId, deps.wallet);
    if (!started.ok) return c.json({ error: started.error }, started.status);
    return c.json({ executionId: started.executionId }, 202);
  });

  app.get("/api/executions/:id", async (c) => {
    const id = c.req.param("id");
    if (!/^[\w-]+$/.test(id)) return c.json({ error: "Invalid id" }, 400);
    const found = await deps.executions.status(id);
    if (!found) return c.json({ error: "Not found" }, 404);
    const evidence = (found.record?.evidence ?? []).map((e) => {
      const chain = STEP_CHAIN[e.step];
      return {
        ...e,
        chain: chain ?? null,
        explorerUrl: e.explorerUrl ?? (chain ? `${EXPLORER_TX[chain]}${e.txHash}` : undefined),
      };
    });
    return c.json({
      id,
      state: found.record?.state ?? "failed_funds_safe",
      history: found.record?.history ?? [],
      plan: found.record?.plan ?? null,
      evidence,
      error: found.error,
      updatedAt: found.record?.updatedAt ?? null,
    });
  });

  return app;
}
