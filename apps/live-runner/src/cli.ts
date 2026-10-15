/**
 * Astrolabe live runner — drives the real executor against Circle testnets.
 *
 * Usage (from the repo root):
 *   pnpm --filter @astrolabe/live-runner live check
 *   pnpm --filter @astrolabe/live-runner live setup-arc-wallet [--write]
 *   pnpm --filter @astrolabe/live-runner live run --amount 1 --to EURC [--execute]
 *   pnpm --filter @astrolabe/live-runner live status <executionId>
 *   pnpm --filter @astrolabe/live-runner live resume <executionId>
 *
 * `run` is a dry run unless --execute is passed (CLAUDE.md §6.6).
 * Secrets come only from .env.local / process.env and are never printed.
 */
import { appendFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  CIRCLE_BLOCKCHAIN,
  createWallet,
  estimateBridgeFee,
  getTokenBalances,
  listWallets,
} from "@astrolabe/circle";
import { loadExecution, resumeExecution, runExecution } from "@astrolabe/executor";
import { getQuote } from "@astrolabe/pricing";
import { loadEnvFile, missingKeys } from "./env.js";
import { ARC_TESTNET_SWAP_TOKENS, buildArcRoute, formatEvidence, formatPreview } from "./route.js";

// Compiled to apps/live-runner/dist/cli.js, three levels below the repo root.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const ENV_PATH = resolve(REPO_ROOT, ".env.local");

const CORE_KEYS = ["CIRCLE_API_KEY", "CIRCLE_ENTITY_SECRET"] as const;
const SOURCE_KEYS = ["CIRCLE_WALLET_ID_ETH_SEPOLIA", "CIRCLE_WALLET_ADDR_ETH_SEPOLIA"] as const;
const ARC_KEYS = ["CIRCLE_WALLET_ID_ARC_TESTNET", "CIRCLE_WALLET_ADDR_ARC_TESTNET"] as const;

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function requireEnv(keys: readonly string[]): void {
  const missing = missingKeys(process.env, keys);
  if (missing.length > 0) fail(`Missing in .env.local: ${missing.join(", ")}`);
}

async function printBalances(label: string, walletId: string | undefined): Promise<void> {
  if (!walletId) {
    console.log(`  ${label.padEnd(18)} (not configured)`);
    return;
  }
  const res = await getTokenBalances(walletId);
  if (res.isErr()) {
    console.log(`  ${label.padEnd(18)} error: ${res.error.message}`);
    return;
  }
  const text = res.value.map((b) => `${b.amount} ${b.symbol}`).join(", ") || "empty";
  console.log(`  ${label.padEnd(18)} ${text}`);
}

async function cmdCheck(): Promise<void> {
  const keys = [...CORE_KEYS, ...SOURCE_KEYS, ...ARC_KEYS, "CIRCLE_WALLET_SET_ID"];
  for (const key of keys) {
    console.log(`  ${process.env[key] ? "✓" : "✗"} ${key}`);
  }
  requireEnv(CORE_KEYS);
  console.log("\nBalances:");
  await printBalances("Ethereum Sepolia", process.env.CIRCLE_WALLET_ID_ETH_SEPOLIA);
  await printBalances("Base Sepolia", process.env.CIRCLE_WALLET_ID_BASE_SEPOLIA);
  await printBalances("Arc Testnet", process.env.CIRCLE_WALLET_ID_ARC_TESTNET);
}

async function cmdSetupArcWallet(write: boolean): Promise<void> {
  requireEnv([...CORE_KEYS, "CIRCLE_WALLET_SET_ID"]);
  if (process.env.CIRCLE_WALLET_ID_ARC_TESTNET) {
    console.log(`Arc wallet already configured: ${process.env.CIRCLE_WALLET_ADDR_ARC_TESTNET}`);
    return;
  }
  const walletSetId = process.env.CIRCLE_WALLET_SET_ID as string;

  // Reuse an existing Arc wallet in the set rather than creating duplicates.
  const listed = await listWallets(walletSetId);
  if (listed.isErr()) fail(`listWallets: ${listed.error.message}`);
  let wallet = listed.value.find((w) => w.blockchain === CIRCLE_BLOCKCHAIN.ARC_TESTNET);
  if (wallet) {
    console.log("Found an existing ARC-TESTNET wallet in the wallet set.");
  } else {
    const created = await createWallet(walletSetId, CIRCLE_BLOCKCHAIN.ARC_TESTNET);
    if (created.isErr()) fail(`createWallet: ${created.error.message}`);
    wallet = created.value;
    console.log("Created a new ARC-TESTNET wallet.");
  }

  const lines = `CIRCLE_WALLET_ID_ARC_TESTNET=${wallet.id}\nCIRCLE_WALLET_ADDR_ARC_TESTNET=${wallet.address}\n`;
  if (write) {
    appendFileSync(ENV_PATH, `\n${lines}`);
    console.log(`Appended to .env.local:\n${lines}`);
  } else {
    console.log(`Add these to .env.local (or re-run with --write):\n${lines}`);
  }
}

async function cmdRun(amount: string, tokenOut: string, execute: boolean): Promise<void> {
  requireEnv([...CORE_KEYS, ...SOURCE_KEYS, ...ARC_KEYS]);
  const upper = tokenOut.toUpperCase();
  if (!(ARC_TESTNET_SWAP_TOKENS as readonly string[]).includes(upper) || upper === "USDC") {
    fail(`--to must be one of: ${ARC_TESTNET_SWAP_TOKENS.filter((t) => t !== "USDC").join(", ")}`);
  }
  const arcAddress = process.env.CIRCLE_WALLET_ADDR_ARC_TESTNET as string;

  const quote = await getQuote({
    chainKey: "ARC_TESTNET",
    tokenIn: "USDC",
    tokenOut: upper,
    amountIn: amount,
    fromAddress: arcAddress,
  });
  if (quote.isErr()) fail(`Arc quote failed: ${quote.error.message}`);

  // Live CCTP fee; fall back to the fixed placeholder if the estimate fails.
  const fee = await estimateBridgeFee({
    fromChain: "Ethereum_Sepolia",
    toChain: "Arc_Testnet",
    fromAddress: process.env.CIRCLE_WALLET_ADDR_ETH_SEPOLIA as string,
    toAddress: arcAddress,
    amount,
  });
  if (fee.isErr())
    console.warn(`(bridge fee estimate failed, using fixed fee: ${fee.error.message})`);
  const route = buildArcRoute(
    "ETHEREUM_SEPOLIA",
    quote.value,
    fee.isOk() ? { amount: fee.value, source: "estimate" } : undefined,
  );
  console.log(formatPreview(route));

  if (!execute) {
    console.log("\nDry run only. Re-run with --execute to send real testnet transactions.");
    return;
  }

  console.log("\nExecuting… (state is persisted under .astrolabe/executions/)");
  const outcome = await runExecution({
    route,
    walletId: process.env.CIRCLE_WALLET_ID_ETH_SEPOLIA as string,
    sourceAddress: process.env.CIRCLE_WALLET_ADDR_ETH_SEPOLIA as string,
    arcAddress,
    arcWalletId: process.env.CIRCLE_WALLET_ID_ARC_TESTNET as string,
    baseDir: REPO_ROOT,
  });
  if (outcome.isErr()) {
    fail(`${outcome.error.code}: ${outcome.error.message}`);
  }
  const { record, bridgeResult, swapResult } = outcome.value;
  console.log(`\n✓ ${record.id} -> ${record.state}`);
  console.log(
    `  path: ${[record.history[0]?.from, ...record.history.map((h) => h.to)].join(" -> ")}`,
  );
  console.log(`  received: ${swapResult.amountOut ?? "?"} ${upper}`);
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
      to: { type: "string", default: "EURC" },
      execute: { type: "boolean", default: false },
      write: { type: "boolean", default: false },
    },
  });
  const [command, arg] = positionals;
  switch (command) {
    case "check":
      return cmdCheck();
    case "setup-arc-wallet":
      return cmdSetupArcWallet(values.write);
    case "run":
      return cmdRun(values.amount, values.to, values.execute);
    case "status":
      return cmdStatus(arg);
    case "resume":
      return cmdResume(arg);
    default:
      fail(
        "Commands: check | setup-arc-wallet [--write] | run [--amount N --to EURC --execute] | status <id>",
      );
  }
}

main().catch((e: unknown) => fail(e instanceof Error ? e.message : String(e)));
