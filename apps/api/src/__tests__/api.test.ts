import type { TokenBalance } from "@astrolabe/circle";
import type { ExecutionRecord } from "@astrolabe/executor";
import type { SwapQuote } from "@astrolabe/pricing";
import { type QuoteDeps, type Wallets, quoteRoutes } from "@astrolabe/pricing";
import { err, ok, okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";
import { type AppDeps, createApp } from "../app.js";
import { ExecutionService, type ExecutionServiceDeps } from "../executions.js";
import { RateLimiter } from "../rate-limit.js";

const FX: SwapQuote = {
  chainKey: "ARC_TESTNET",
  tokenIn: "USDC",
  tokenOut: "EURC",
  amountIn: "5",
  amountOut: "6.38",
  gasEstimateWei: "0",
  source: "arc-app-kit",
};

const WALLETS: Wallets = {
  ARC_TESTNET: { walletId: "arc-w", address: "0xarc" },
  ETHEREUM_SEPOLIA: { walletId: "eth-w", address: "0xeth" },
  BASE_SEPOLIA: { walletId: "base-w", address: "0xbase" },
};

const usdc = (amount: string): TokenBalance => ({
  symbol: "USDC",
  amount,
  decimals: 6,
  tokenAddress: "0xusdc",
});
const gas: TokenBalance = { symbol: "ETH-SEPOLIA", amount: "0.04", decimals: 18, tokenAddress: "" };

/** Balances per wallet id: Arc is short, Ethereum funded, Base has no gas. */
const BALANCES: Record<string, TokenBalance[]> = {
  "arc-w": [usdc("1")],
  "eth-w": [usdc("13"), gas],
  "base-w": [usdc("20")],
};

function quoteDeps(over: Partial<QuoteDeps> = {}): QuoteDeps {
  return {
    getFxQuote: async () => ok(FX),
    getTokenBalances: async (id) => ok(BALANCES[id] ?? []),
    estimateBridgeFee: async (source) => ok(source === "BASE_SEPOLIA" ? "0.055" : "0.0195"),
    ...over,
  };
}

function record(state: ExecutionRecord["state"]): ExecutionRecord {
  return {
    id: "exec_1",
    state,
    createdAt: "t",
    updatedAt: "t",
    history: [],
    error: null,
    plan: {
      sourceChain: "BASE_SEPOLIA",
      arcAddress: "0xarc",
      tokenIn: "USDC",
      tokenOut: "EURC",
      amountIn: "5",
    },
    evidence: [
      { step: "burn", txHash: "0xburn" },
      { step: "swap", txHash: "0xswap" },
    ],
  };
}

function makeApp(over: Partial<AppDeps> = {}) {
  const runExecution = vi.fn(
    (_p: unknown, d: Parameters<ExecutionServiceDeps["runExecution"]>[1]) => {
      d.saveExecution(record("preflight"));
      return okAsync({} as never);
    },
  );
  const executions = new ExecutionService(
    {
      runExecution,
      saveExecution: (r) => okAsync(r),
      loadExecution: () => okAsync(record("minting")),
    },
    "/tmp",
  );
  const deps: AppDeps = {
    ...quoteDeps(),
    parseIntent: async () => ({
      action: "swap",
      sourceToken: "USDC",
      targetToken: "EURC",
      amount: "5",
    }),
    executions,
    wallets: WALLETS,
    limiter: new RateLimiter(3, 10_000),
    ...over,
  };
  return { app: createApp(deps), runExecution };
}

const post = (path: string, body: unknown) =>
  new Request(`http://x${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("quoteRoutes (funding plan)", () => {
  it("picks the funded, cheapest source and explains the others", async () => {
    const plan = await quoteRoutes(
      { amount: "5", tokenIn: "USDC", tokenOut: "EURC" },
      WALLETS,
      quoteDeps(),
    );

    expect(plan.rate).toBe("1.2760");
    expect(plan.winner).toMatchObject({
      sourceChain: "ETHEREUM_SEPOLIA",
      strategy: "bridge_then_swap",
      bridgeAmount: "5.0695",
      executable: true,
    });
    const reasons = Object.fromEntries(plan.routes.map((r) => [r.sourceChain, r.reason ?? "ok"]));
    expect(reasons).toEqual({
      ETHEREUM_SEPOLIA: "ok",
      ARC_TESTNET: "Needs 5.05 USDC, has 1",
      BASE_SEPOLIA: "No native gas for approve and burn",
      ARBITRUM_SEPOLIA: "No wallet on this chain",
    });
  });

  it("uses funds already on Arc without a bridge when they suffice", async () => {
    const plan = await quoteRoutes(
      { amount: "5", tokenIn: "USDC", tokenOut: "EURC" },
      WALLETS,
      quoteDeps({
        getTokenBalances: async (id) => ok(id === "arc-w" ? [usdc("9")] : (BALANCES[id] ?? [])),
      }),
    );
    expect(plan.winner).toMatchObject({
      sourceChain: "ARC_TESTNET",
      strategy: "swap_only",
      costUsdc: "0",
    });
  });

  it("reports a failed Arc quote instead of inventing routes", async () => {
    const plan = await quoteRoutes(
      { amount: "5", tokenIn: "USDC", tokenOut: "EURC" },
      WALLETS,
      quoteDeps({ getFxQuote: async () => err(new Error("no liquidity\nstack")) }),
    );
    expect(plan.routes).toEqual([]);
    expect(plan.error).toBe("No USDC→EURC quote on Arc: no liquidity");
  });
});

describe("API", () => {
  it("parses intents and validates bodies", async () => {
    const { app } = makeApp();
    expect((await app.request(post("/api/intents", { text: "5 usdc to euros" }))).status).toBe(200);
    expect((await app.request(post("/api/intents", {}))).status).toBe(400);
    expect((await app.request(post("/api/quotes", { amount: "5", tokenOut: "ETH" }))).status).toBe(
      400,
    );
    expect(
      (await app.request(post("/api/quotes", { amount: "5", tokenIn: "USDC", tokenOut: "USDC" })))
        .status,
    ).toBe(400);
  });

  it("executes an approved quote once from the winning source wallet (idempotency)", async () => {
    const { app, runExecution } = makeApp();
    const { quoteId } = await (
      await app.request(post("/api/quotes", { amount: "5", tokenOut: "EURC" }))
    ).json();

    expect((await app.request(post("/api/executions", { quoteId }))).status).toBe(400);
    const first = await app.request(post("/api/executions", { quoteId, approved: true }));
    expect(first.status).toBe(202);
    expect((await app.request(post("/api/executions", { quoteId, approved: true }))).status).toBe(
      409,
    );
    expect(runExecution).toHaveBeenCalledTimes(1);
    expect(runExecution.mock.calls[0]?.[0]).toMatchObject({
      walletId: "eth-w",
      sourceAddress: "0xeth",
      arcAddress: "0xarc",
      arcWalletId: "arc-w",
    });
  });

  it("refuses to execute when no route is feasible", async () => {
    const { app } = makeApp({ getTokenBalances: async () => ok([]) });
    const { quoteId } = await (
      await app.request(post("/api/quotes", { amount: "5", tokenOut: "EURC" }))
    ).json();
    expect((await app.request(post("/api/executions", { quoteId, approved: true }))).status).toBe(
      400,
    );
  });

  it("rate-limits execution requests to 3 per 10 seconds", async () => {
    const { app } = makeApp();
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await app.request(
        post("/api/executions", { quoteId: crypto.randomUUID(), approved: true }),
      );
      codes.push(res.status);
    }
    expect(codes).toEqual([404, 404, 404, 429]);
  });

  it("disables execution without an Arc wallet", async () => {
    const { app } = makeApp({ wallets: {} });
    const res = await app.request(
      post("/api/executions", { quoteId: crypto.randomUUID(), approved: true }),
    );
    expect(res.status).toBe(503);
  });

  it("links burn txs to the funding chain's explorer and swaps to Arc's", async () => {
    const { app } = makeApp();
    const body = await (await app.request("/api/executions/exec_1")).json();
    expect(body.evidence).toEqual([
      expect.objectContaining({
        chain: "BASE_SEPOLIA",
        explorerUrl: "https://sepolia.basescan.org/tx/0xburn",
      }),
      expect.objectContaining({
        chain: "ARC_TESTNET",
        explorerUrl: "https://testnet.arcscan.app/tx/0xswap",
      }),
    ]);
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
