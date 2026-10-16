import type { TokenBalance } from "@astrolabe/circle";
import type { IntentResult } from "@astrolabe/intent-parser";
import { FUNDING_CHAINS, type QuoteDeps, type Wallets, quoteRoutes } from "@astrolabe/pricing";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Result } from "neverthrow";
import { z } from "zod";
import type { ExecutionService } from "./executions.js";
import { RateLimiter } from "./rate-limit.js";

export type AppDeps = QuoteDeps & {
  parseIntent: (text: string) => Promise<IntentResult>;
  getTokenBalances: (walletId: string) => Promise<Result<TokenBalance[], Error>>;
  executions: ExecutionService;
  /** Circle wallets per chain. Execution needs at least the Arc wallet. */
  wallets: Wallets;
  /** ERC-8004 identity of the agent on Arc, when registered. */
  agentId?: string;
  corsOrigin?: string;
  limiter?: RateLimiter;
};

const IntentBody = z.object({ text: z.string().min(1).max(500) });
const QuoteBody = z
  .object({
    amount: z.string().regex(/^\d+(\.\d+)?$/, "amount must be a positive decimal string"),
    tokenIn: z.enum(["USDC", "EURC"]).default("USDC"),
    tokenOut: z.enum(["USDC", "EURC"]),
  })
  .refine((b) => b.tokenIn !== b.tokenOut, "tokenIn and tokenOut must differ");
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

/** The chain a recorded step's transaction lives on: approve/burn on the source. */
function stepChain(step: string, sourceChain: string | undefined): string | null {
  if (step === "approve" || step === "burn") return sourceChain ?? "ETHEREUM_SEPOLIA";
  if (step === "mint" || step === "swap" || step === "reputation") return "ARC_TESTNET";
  return null;
}

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
      fxHub: "ARC_TESTNET",
      executionEnabled: deps.wallets.ARC_TESTNET !== undefined,
      agentId: deps.agentId ?? null,
      wallets: Object.fromEntries(
        FUNDING_CHAINS.map((chain) => [chain, deps.wallets[chain]?.address ?? null]),
      ),
      explorers: EXPLORER_TX,
    }),
  );

  app.get("/api/balances", async (c) => {
    const out: Record<string, TokenBalance[] | { error: string }> = {};
    for (const chain of FUNDING_CHAINS) {
      const wallet = deps.wallets[chain];
      if (!wallet) continue;
      const res = await deps.getTokenBalances(wallet.walletId);
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
    const outcome = await quoteRoutes(body.data, deps.wallets, deps);
    const quoteId = deps.executions.storeQuote(outcome);
    return c.json({ quoteId, ...outcome });
  });

  app.post("/api/executions", async (c) => {
    if (!limiter.allow(clientKey(c.req.raw))) {
      return c.json({ error: "Too many execution requests — max 3 per 10 seconds" }, 429);
    }
    if (!deps.wallets.ARC_TESTNET) {
      return c.json({ error: "Execution is disabled: no Arc wallet configured" }, 503);
    }
    const body = ExecuteBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return c.json({ error: "Body must be { quoteId, approved: true }" }, 400);
    }
    const started = await deps.executions.start(body.data.quoteId, deps.wallets);
    if (!started.ok) return c.json({ error: started.error }, started.status);
    return c.json({ executionId: started.executionId }, 202);
  });

  app.get("/api/executions/:id", async (c) => {
    const id = c.req.param("id");
    if (!/^[\w-]+$/.test(id)) return c.json({ error: "Invalid id" }, 400);
    const found = await deps.executions.status(id);
    if (!found) return c.json({ error: "Not found" }, 404);
    const sourceChain = found.record?.plan?.sourceChain;
    const evidence = (found.record?.evidence ?? []).map((e) => {
      const chain = stepChain(e.step, sourceChain);
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
