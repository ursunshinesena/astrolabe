import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getTokenBalances } from "@astrolabe/circle";
import {
  loadExecution,
  runBridge,
  runExecution,
  runPreflight,
  runSwap,
  saveExecution,
} from "@astrolabe/executor";
import { parseIntent } from "@astrolabe/intent-parser";
import { getQuote } from "@astrolabe/pricing";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { ExecutionService, type WalletConfig } from "./executions.js";

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

function walletFromEnv(env: NodeJS.ProcessEnv): WalletConfig | null {
  const walletId = env.CIRCLE_WALLET_ID_ETH_SEPOLIA;
  const sourceAddress = env.CIRCLE_WALLET_ADDR_ETH_SEPOLIA;
  const arcAddress = env.CIRCLE_WALLET_ADDR_ARC_TESTNET;
  if (
    !env.CIRCLE_API_KEY ||
    !env.CIRCLE_ENTITY_SECRET ||
    !walletId ||
    !sourceAddress ||
    !arcAddress
  ) {
    return null;
  }
  return {
    walletId,
    sourceAddress,
    arcAddress,
    ...(env.CIRCLE_WALLET_ID_ARC_TESTNET ? { arcWalletId: env.CIRCLE_WALLET_ID_ARC_TESTNET } : {}),
  };
}

const RPC_ENV: Record<string, string> = {
  ETHEREUM_SEPOLIA: "ETH_SEPOLIA_RPC_URL",
  BASE_SEPOLIA: "BASE_SEPOLIA_RPC_URL",
  ARBITRUM_SEPOLIA: "ARB_SEPOLIA_RPC_URL",
};

loadEnvLocal();

const wallet = walletFromEnv(process.env);
const executions = new ExecutionService(
  {
    runExecution: (params, d) =>
      runExecution(params, { runPreflight, runBridge, runSwap, saveExecution: d.saveExecution }),
    saveExecution,
    loadExecution,
  },
  REPO_ROOT,
);

const app = createApp({
  parseIntent: (text) => parseIntent(text),
  // Use the RPCs from .env.local where set; viem's public defaults otherwise.
  getQuote: (params) => {
    const rpcUrl = process.env[RPC_ENV[params.chainKey] ?? ""];
    return getQuote(rpcUrl ? { ...params, rpcUrl } : params);
  },
  getTokenBalances,
  executions,
  wallet,
  corsOrigin: process.env.WEB_ORIGIN ?? "*",
});

const port = Number(process.env.PORT ?? 3001);
serve({ fetch: app.fetch, port }, () => {
  console.log(
    `Astrolabe API on http://localhost:${port} (execution ${wallet ? "enabled" : "disabled"})`,
  );
});
