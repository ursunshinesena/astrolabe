import type { ExecutionRecord } from "@astrolabe/executor";
import type { SwapQuote } from "@astrolabe/pricing";
import { QuoteError } from "@astrolabe/pricing";
import { err, errAsync, ok, okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";
import { type AppDeps, createApp } from "../app.js";
import { ExecutionService, type ExecutionServiceDeps } from "../executions.js";
import { RateLimiter } from "../rate-limit.js";

const ARC_QUOTE: SwapQuote = {
  chainKey: "ARC_TESTNET",
  tokenIn: "USDC",
  tokenOut: "EURC",
  amountIn: "10",
  amountOut: "8.6",
  gasEstimateWei: "0",
  source: "arc-app-kit",
};

const WALLET = { walletId: "w", sourceAddress: "0xsrc", arcAddress: "0xarc", arcWalletId: "aw" };

function record(state: ExecutionRecord["state"]): ExecutionRecord {
  return {
    id: "exec_1",
    state,
    createdAt: "t",
    updatedAt: "t",
    history: [],
    error: null,
    evidence: [{ step: "burn", txHash: "0xburn" }],
  };
}

function makeApp(overrides: Partial<AppDeps> = {}, svcDeps: Partial<ExecutionServiceDeps> = {}) {
  const runExecution = vi.fn((_p, d) => {
    d.saveExecution(record("preflight"));
    return okAsync({} as never);
  });
  const executions = new ExecutionService(
    {
      runExecution,
      saveExecution: (r) => okAsync(r),
      loadExecution: () => okAsync(record("minting")),
      ...svcDeps,
    },
    "/tmp",
  );
  const getQuote = vi.fn((p: { chainKey: string }) =>
    p.chainKey === "ARC_TESTNET"
      ? okAsync(ARC_QUOTE)
      : errAsync(new QuoteError("pool missing", p.chainKey as "BASE_SEPOLIA")),
  );
  const deps: AppDeps = {
    parseIntent: async () => ({
      action: "swap",
      sourceToken: "USDC",
      targetToken: "EURC",
      amount: "10",
    }),
    getQuote,
    getTokenBalances: async () => ok([]),
    executions,
    wallet: WALLET,
    limiter: new RateLimiter(3, 10_000),
    ...overrides,
  };
  return { app: createApp(deps), runExecution, getQuote };
}

const post = (path: string, body: unknown) =>
  new Request(`http://x${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("API", () => {
  it("parses intents and validates the body", async () => {
    const { app } = makeApp();
    expect((await app.request(post("/api/intents", { text: "10 usdc to euros" }))).status).toBe(
      200,
    );
    expect((await app.request(post("/api/intents", {}))).status).toBe(400);
  });

  it("quotes EURC on Arc only and marks the bridge route executable", async () => {
    const { app, getQuote } = makeApp();
    const res = await app.request(post("/api/quotes", { amount: "10", tokenOut: "EURC" }));
    const body = await res.json();
    expect(getQuote).toHaveBeenCalledTimes(1);
    expect(getQuote.mock.calls[0]?.[0]).toMatchObject({
      chainKey: "ARC_TESTNET",
      fromAddress: "0xarc",
    });
    expect(body.winner).toMatchObject({ destinationChain: "ARC_TESTNET", executable: true });
    expect(body.quoteId).toMatch(/[0-9a-f-]{36}/);
  });

  it("keeps per-chain quote failures visible for ETH targets", async () => {
    const { app } = makeApp();
    const body = await (
      await app.request(post("/api/quotes", { amount: "10", tokenOut: "ETH" }))
    ).json();
    expect(body.routes).toEqual([]);
    expect(body.failures).toHaveLength(3);
  });

  it("executes an approved quote once; a duplicate is rejected (idempotency)", async () => {
    const { app, runExecution } = makeApp();
    const { quoteId } = await (
      await app.request(post("/api/quotes", { amount: "10", tokenOut: "EURC" }))
    ).json();

    expect((await app.request(post("/api/executions", { quoteId }))).status).toBe(400); // not approved
    const first = await app.request(post("/api/executions", { quoteId, approved: true }));
    expect(first.status).toBe(202);
    expect(await first.json()).toEqual({ executionId: "exec_1" });
    const again = await app.request(post("/api/executions", { quoteId, approved: true }));
    expect(again.status).toBe(409);
    expect(runExecution).toHaveBeenCalledTimes(1);
    expect(runExecution.mock.calls[0]?.[0]).toMatchObject({ arcWalletId: "aw", walletId: "w" });
  });

  it("rejects routes that are not executable", async () => {
    const getQuote = vi.fn(() =>
      okAsync({
        ...ARC_QUOTE,
        chainKey: "BASE_SEPOLIA" as const,
        tokenOut: "WETH",
        source: "uniswap-v3" as const,
      }),
    );
    const { app } = makeApp({ getQuote });
    const { quoteId } = await (
      await app.request(post("/api/quotes", { amount: "10", tokenOut: "ETH" }))
    ).json();
    const res = await app.request(post("/api/executions", { quoteId, approved: true }));
    expect(res.status).toBe(400);
  });

  it("rate-limits execution requests to 3 per 10 seconds", async () => {
    const { app } = makeApp();
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) {
      codes.push(
        (
          await app.request(
            post("/api/executions", { quoteId: crypto.randomUUID(), approved: true }),
          )
        ).status,
      );
    }
    expect(codes).toEqual([404, 404, 404, 429]);
  });

  it("disables execution when wallets are not configured", async () => {
    const { app } = makeApp({ wallet: null });
    const res = await app.request(
      post("/api/executions", { quoteId: crypto.randomUUID(), approved: true }),
    );
    expect(res.status).toBe(503);
  });

  it("returns execution status with explorer links per step", async () => {
    const { app } = makeApp();
    const body = await (await app.request("/api/executions/exec_1")).json();
    expect(body.state).toBe("minting");
    expect(body.evidence[0]).toMatchObject({
      step: "burn",
      chain: "ETHEREUM_SEPOLIA",
      explorerUrl: "https://sepolia.etherscan.io/tx/0xburn",
    });
  });
});

describe("RateLimiter", () => {
  it("frees capacity once the window passes", () => {
    let t = 0;
    const limiter = new RateLimiter(3, 10_000, () => t);
    expect([1, 2, 3, 4].map(() => limiter.allow("a"))).toEqual([true, true, true, false]);
    expect(limiter.allow("b")).toBe(true);
    t = 10_001;
    expect(limiter.allow("a")).toBe(true);
  });
});

describe("quoteRoutes bridge fee", () => {
  it("uses the live fee estimate per destination and falls back to the fixed fee", async () => {
    const { quoteRoutes } = await import("../quotes.js");
    const getQuote = vi.fn(() => okAsync(ARC_QUOTE));
    const live = await quoteRoutes(
      { amount: "10", tokenOut: "EURC" },
      { getQuote, estimateBridgeFee: async () => ok("0.021564") },
    );
    expect(live.winner?.bridgeFee).toEqual({ amount: "0.021564", source: "estimate" });
    expect(live.winner?.bridgeAmount).toBe("10.071564");

    const fallback = await quoteRoutes(
      { amount: "10", tokenOut: "EURC" },
      { getQuote, estimateBridgeFee: async () => err(new Error("down")) },
    );
    expect(fallback.winner?.bridgeFee).toEqual({ amount: "0.05", source: "fixed" });
  });
});
