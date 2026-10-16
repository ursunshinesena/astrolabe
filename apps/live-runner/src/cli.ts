/**
 * Astrolabe live runner — drives the real executor against Circle testnets.
 *
 * Usage (from the repo root, after `pnpm build`):
 *   pnpm --filter @astrolabe/live-runner live check
 *   pnpm --filter @astrolabe/live-runner live setup-wallets [--write]
 *   pnpm --filter @astrolabe/live-runner live run --amount 5 [--from USDC --to EURC] [--execute]
 *   pnpm --filter @astrolabe/live-runner live status <executionId>
 *   pnpm --filter @astrolabe/live-runner live resume <executionId>
 *
 * `run` plans where to take the funds from (Arc, or a chain bridged in with
 * CCTP V2) and is a dry run unless --execute is passed (CLAUDE.md §6.6).
 * Secrets come only from .env.local / process.env and are never printed.
 */
import { appendFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { CIRCLE_CHAIN_NAMES } from "@astrolabe/chains";
import {
  type AppKitChain,
  CIRCLE_BLOCKCHAIN,
  type CircleBlockchain,
  createWallet,
  estimateBridgeFee,
  getTokenBalances,
  listWallets,
} from "@astrolabe/circle";
import { loadExecution, resumeExecution, runExecution } from "@astrolabe/executor";
import {
  FUNDING_CHAINS,
  WALLET_ENV_SUFFIX,
  getArcQuote,
  quoteRoutes,
  walletsFromEnv,
} from "@astrolabe/pricing";
import { err, ok } from "neverthrow";
import { loadEnvFile, missingKeys } from "./env.js";
import { formatEvidence, formatPlan } from "./route.js";

// Compiled to apps/live-runner/dist/cli.js, three levels below the repo root.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const ENV_PATH = resolve(REPO_ROOT, ".env.local");

const CORE_KEYS = ["CIRCLE_API_KEY", "CIRCLE_ENTITY_SECRET"] as const;

const BLOCKCHAIN_OF: Record<string, CircleBlockchain> = {
  ETHEREUM_SEPOLIA: CIRCLE_BLOCKCHAIN.ETH_SEPOLIA,
  BASE_SEPOLIA: CIRCLE_BLOCKCHAIN.BASE_SEPOLIA,
  ARBITRUM_SEPOLIA: CIRCLE_BLOCKCHAIN.ARB_SEPOLIA,
  ARC_TESTNET: CIRCLE_BLOCKCHAIN.ARC_TESTNET,
};

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function requireEnv(keys: readonly string[]): void {
  const missing = missingKeys(process.env, keys);
  if (missing.length > 0) fail(`Missing in .env.local: ${missing.join(", ")}`);
}

async function cmdCheck(): Promise<void> {
  requireEnv(CORE_KEYS);
  const wallets = walletsFromEnv(process.env);
  for (const chain of FUNDING_CHAINS) {
    const wallet = wallets[chain];
    if (!wallet) {
      console.log(`  ${chain.padEnd(18)} (no wallet — run setup-wallets)`);
      continue;
    }
    const res = await getTokenBalances(wallet.walletId);
    const text = res.isErr()
      ? `error: ${res.error.message}`
      : res.value.map((b) => `${b.amount} ${b.symbol}`).join(", ") || "empty";
    console.log(`  ${chain.padEnd(18)} ${text}`);
  }
}

/** Finds or creates a wallet on every funding chain, in the configured wallet set. */
async function cmdSetupWallets(write: boolean): Promise<void> {
  requireEnv([...CORE_KEYS, "CIRCLE_WALLET_SET_ID"]);
  const walletSetId = process.env.CIRCLE_WALLET_SET_ID as string;
  const configured = walletsFromEnv(process.env);
  const listed = await listWallets(walletSetId);
  if (listed.isErr()) fail(`listWallets: ${listed.error.message}`);

  let lines = "";
  for (const chain of FUNDING_CHAINS) {
    if (configured[chain]) {
      console.log(`  ${chain.padEnd(18)} already configured`);
      continue;
    }
    const blockchain = BLOCKCHAIN_OF[chain] as CircleBlockchain;
    let wallet = listed.value.find((w) => w.blockchain === blockchain);
    if (!wallet) {
      const created = await createWallet(walletSetId, blockchain);
      if (created.isErr()) fail(`createWallet ${chain}: ${created.error.message}`);
      wallet = created.value;
    }
    console.log(`  ${chain.padEnd(18)} ${wallet.address}`);
    const suffix = WALLET_ENV_SUFFIX[chain];
    lines += `CIRCLE_WALLET_ID_${suffix}=${wallet.id}\nCIRCLE_WALLET_ADDR_${suffix}=${wallet.address}\n`;
  }
  if (!lines) return;
  if (write) {
    appendFileSync(ENV_PATH, `\n${lines}`);
    console.log("Appended the new wallets to .env.local.");
  } else {
    console.log(`Add these to .env.local (or re-run with --write):\n${lines}`);
  }
}

async function cmdRun(amount: string, from: string, to: string, execute: boolean): Promise<void> {
  requireEnv([...CORE_KEYS, "CIRCLE_WALLET_ID_ARC_TESTNET", "CIRCLE_WALLET_ADDR_ARC_TESTNET"]);
  const tokenIn = from.toUpperCase();
  const tokenOut = to.toUpperCase();
  const pair = new Set([tokenIn, tokenOut]);
  if (tokenIn === tokenOut || !pair.has("USDC") || !pair.has("EURC")) {
    fail("Astrolabe converts USDC <-> EURC: use --from USDC --to EURC or the reverse");
  }
  const wallets = walletsFromEnv(process.env);
  const arc = wallets.ARC_TESTNET;
  if (!arc) fail("No Arc wallet configured — run setup-wallets");
  const apiKey = process.env.CIRCLE_API_KEY as string;
  const entitySecret = process.env.CIRCLE_ENTITY_SECRET as string;

  const plan = await quoteRoutes({ amount, tokenIn, tokenOut }, wallets, {
    getFxQuote: async (p) => {
      try {
        return ok(await getArcQuote({ ...p, fromAddress: arc.address, apiKey, entitySecret }));
      } catch (e) {
        return err(e instanceof Error ? e : new Error(String(e)));
      }
    },
    getTokenBalances,
    estimateBridgeFee: (source, value) => {
      const wallet = wallets[source];
      if (!wallet) return Promise.resolve(err(new Error("Wallet missing")));
      return estimateBridgeFee({
        fromChain: CIRCLE_CHAIN_NAMES[source] as AppKitChain,
        toChain: CIRCLE_CHAIN_NAMES.ARC_TESTNET as AppKitChain,
        fromAddress: wallet.address,
        toAddress: arc.address,
        amount: value,
      });
    },
  });
  console.log(formatPlan(plan));

  const route = plan.winner;
  if (!route) process.exit(1);
  if (!execute) {
    console.log("\nDry run only. Re-run with --execute to send real testnet transactions.");
    return;
  }
  const source = wallets[route.sourceChain];
  if (!source) fail(`No wallet on ${route.sourceChain}`);

  console.log("\nExecuting… (state is persisted under .astrolabe/executions/)");
  const outcome = await runExecution({
    route,
    walletId: source.walletId,
    sourceAddress: source.address,
    arcAddress: arc.address,
    arcWalletId: arc.walletId,
    baseDir: REPO_ROOT,
  });
  if (outcome.isErr()) fail(`${outcome.error.code}: ${outcome.error.message}`);
  const { record, bridgeResult, swapResult } = outcome.value;
  console.log(`\n✓ ${record.id} -> ${record.state}`);
  console.log(
    `  path: ${[record.history[0]?.from, ...record.history.map((h) => h.to)].join(" -> ")}`,
  );
  console.log(`  received: ${swapResult.amountOut ?? "?"} ${tokenOut}`);
  console.log(`Transactions:\n${formatEvidence(bridgeResult, swapResult)}`);
}

async function cmdStatus(id: string | undefined): Promise<void> {
  if (!id) fail("Usage: status <executionId>");
  const loaded = await loadExecution(id, REPO_ROOT);
  if (loaded.isErr()) fail(loaded.error.message);
  console.log(JSON.stringify(loaded.value, null, 2));
}

async function cmdResume(id: string | undefined): Promise<void> {
  if (!id) fail("Usage: resume <executionId>");
  requireEnv(CORE_KEYS);
  const outcome = await resumeExecution({
    id,
    apiKey: process.env.CIRCLE_API_KEY as string,
    entitySecret: process.env.CIRCLE_ENTITY_SECRET as string,
    baseDir: REPO_ROOT,
  });
  if (outcome.isErr()) fail(`${outcome.error.code}: ${outcome.error.message}`);
  const { record, action } = outcome.value;
  console.log(`✓ ${record.id}: ${action} -> ${record.state}`);
  for (const e of record.evidence ?? []) console.log(`  ${e.step.padEnd(17)} ${e.txHash}`);
}

async function main(): Promise<void> {
  if (!loadEnvFile(ENV_PATH)) {
    console.warn(`(no .env.local at ${ENV_PATH}; using process.env only)`);
  }
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      amount: { type: "string", default: "1" },
      from: { type: "string", default: "USDC" },
      to: { type: "string", default: "EURC" },
      execute: { type: "boolean", default: false },
      write: { type: "boolean", default: false },
    },
  });
  const [command, arg] = positionals;
  switch (command) {
    case "check":
      return cmdCheck();
    case "setup-wallets":
      return cmdSetupWallets(values.write);
    case "run":
      return cmdRun(values.amount, values.from, values.to, values.execute);
    case "status":
      return cmdStatus(arg);
    case "resume":
      return cmdResume(arg);
    default:
      fail(
        "Commands: check | setup-wallets [--write] | run [--amount N --from USDC --to EURC --execute] | status <id> | resume <id>",
      );
  }
}

main().catch((e: unknown) => fail(e instanceof Error ? e.message : String(e)));
