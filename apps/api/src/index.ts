import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CIRCLE_CHAIN_NAMES } from "@astrolabe/chains";
import { type AppKitChain, estimateBridgeFee, getTokenBalances } from "@astrolabe/circle";
import {
  loadExecution,
  recordReputation,
  runBridge,
  runExecution,
  runPreflight,
  runSwap,
  saveExecution,
} from "@astrolabe/executor";
import { parseIntent } from "@astrolabe/intent-parser";
import { getArcQuote, walletsFromEnv } from "@astrolabe/pricing";
import { serve } from "@hono/node-server";
import { err, ok } from "neverthrow";
import { createApp } from "./app.js";
import { ExecutionService } from "./executions.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/** Loads .env.local without overriding variables already set in the environment. */
function loadEnvLocal(): void {
  let text: string;
  try {
    text = readFileSync(resolve(REPO_ROOT, ".env.local"), "utf8");
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    const eq = trimmed.indexOf("=");
    if (!trimmed || trimmed.startsWith("#") || eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^(['"])(.*)\1$/, "$2");
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvLocal();

// Without Circle credentials no wallet is usable: quote-only mode.
const wallets =
  process.env.CIRCLE_API_KEY && process.env.CIRCLE_ENTITY_SECRET ? walletsFromEnv(process.env) : {};
const apiKey = process.env.CIRCLE_API_KEY ?? "";
const entitySecret = process.env.CIRCLE_ENTITY_SECRET ?? "";

const executions = new ExecutionService(
  {
    runExecution: (params, d) =>
      runExecution(params, { runPreflight, runBridge, runSwap, saveExecution: d.saveExecution }),
    saveExecution,
    loadExecution,
    onCompleted: async (record) => {
      const agentId = process.env.ERC8004_AGENT_ID;
      const validatorWalletId = process.env.CIRCLE_WALLET_ID_ARC_VALIDATOR;
      if (!agentId || !validatorWalletId) return;
      const rated = await recordReputation({
        record,
        agentId,
        validatorWalletId,
        baseDir: REPO_ROOT,
      });
      if (rated.isErr()) console.warn(rated.error.message);
    },
  },
  REPO_ROOT,
);

const app = createApp({
  parseIntent: (text) => parseIntent(text),
  getFxQuote: async ({ tokenIn, tokenOut, amountIn }) => {
    const arc = wallets.ARC_TESTNET;
    if (!arc) return err(new Error("No Arc wallet configured"));
    try {
      return ok(
        await getArcQuote({
          fromAddress: arc.address,
          tokenIn,
          tokenOut,
          amountIn,
          apiKey,
          entitySecret,
        }),
      );
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  },
  getTokenBalances,
  estimateBridgeFee: (source, amount) => {
    const from = wallets[source];
    const to = wallets.ARC_TESTNET;
    if (!from || !to) return Promise.resolve(err(new Error("Wallet missing")));
    return estimateBridgeFee({
      fromChain: CIRCLE_CHAIN_NAMES[source] as AppKitChain,
      toChain: CIRCLE_CHAIN_NAMES.ARC_TESTNET as AppKitChain,
      fromAddress: from.address,
      toAddress: to.address,
      amount,
    });
  },
  executions,
  wallets,
  ...(process.env.ERC8004_AGENT_ID ? { agentId: process.env.ERC8004_AGENT_ID } : {}),
  corsOrigin: process.env.WEB_ORIGIN ?? "*",
});

const port = Number(process.env.PORT ?? 3001);
serve({ fetch: app.fetch, port }, () => {
  const configured = Object.keys(wallets).join(", ") || "none";
  console.log(`Astrolabe API on http://localhost:${port} (wallets: ${configured})`);
});
