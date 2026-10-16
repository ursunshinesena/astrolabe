import { randomUUID } from "node:crypto";
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { type Result, err, ok } from "neverthrow";
import { http, type Hex, createPublicClient, keccak256, parseAbi, stringToHex } from "viem";
import { pollTransaction } from "./wallets.js";

/**
 * ERC-8004 (trustless agents) registries on Arc Testnet.
 * Source: docs.arc.io/arc/tutorials/register-your-first-ai-agent
 */
export const ERC8004_ARC_TESTNET = {
  identityRegistry: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
  reputationRegistry: "0x8004B663056A597Dffe9eCcC1965A193B7388713",
} as const;

const ARC_RPC = "https://rpc.testnet.arc.network";
const ARC_USDC = "0x3600000000000000000000000000000000000000";
const TRANSFER_TOPIC = keccak256(stringToHex("Transfer(address,address,uint256)"));

const IDENTITY_ABI = parseAbi([
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)",
]);

function client() {
  const apiKey = process.env.CIRCLE_API_KEY;
  const entitySecret = process.env.CIRCLE_ENTITY_SECRET;
  if (!apiKey || !entitySecret) {
    throw new Error("CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET env vars must be set");
  }
  return initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });
}

function arcRpc() {
  return createPublicClient({ transport: http(process.env.ARC_TESTNET_RPC_URL || ARC_RPC) });
}

/**
 * Sends one contract call from a developer-controlled wallet on Arc and waits
 * for it. The idempotency key makes a repeated call with the same key a no-op
 * on Circle's side instead of a second transaction.
 */
async function execute(params: {
  walletId: string;
  contractAddress: string;
  abiFunctionSignature: string;
  abiParameters: Array<string | number | boolean>;
  idempotencyKey?: string;
}): Promise<Result<string, Error>> {
  try {
    const res = await client().createContractExecutionTransaction({
      walletId: params.walletId,
      contractAddress: params.contractAddress,
      abiFunctionSignature: params.abiFunctionSignature,
      abiParameters: params.abiParameters,
      idempotencyKey: params.idempotencyKey ?? randomUUID(),
      fee: { type: "level", config: { feeLevel: "MEDIUM" } },
    });
    const id = res.data?.id;
    if (!id) return err(new Error(`${params.abiFunctionSignature}: no transaction id`));
    const done = await pollTransaction(id);
    if (done.isErr()) return err(done.error);
    if (done.value.state !== "COMPLETE" || !done.value.txHash) {
      return err(new Error(`${params.abiFunctionSignature} ended ${done.value.state}`));
    }
    return ok(done.value.txHash);
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

/** Agent card stored as the identity token's URI (a data: URI, no hosting needed). */
export function agentMetadataURI(card: Record<string, unknown>): string {
  return `data:application/json;base64,${Buffer.from(JSON.stringify(card)).toString("base64")}`;
}

/** Reads the minted token id from the registry's Transfer(0x0 -> owner) log. */
export function agentIdFromLogs(
  logs: ReadonlyArray<{ address: string; topics: readonly Hex[] }>,
  ownerAddress: string,
): string | null {
  const owner = ownerAddress.toLowerCase().replace(/^0x/, "");
  for (const log of logs) {
    if (log.address.toLowerCase() !== ERC8004_ARC_TESTNET.identityRegistry.toLowerCase()) continue;
    const [topic, , to, tokenId] = log.topics;
    if (topic !== TRANSFER_TOPIC || !to || !tokenId) continue;
    if (!to.toLowerCase().endsWith(owner)) continue;
    return BigInt(tokenId).toString();
  }
  return null;
}

/** Registers the agent in the ERC-8004 IdentityRegistry and returns its id. */
export async function registerAgent(params: {
  ownerWalletId: string;
  ownerAddress: string;
  metadataURI: string;
}): Promise<Result<{ agentId: string; txHash: string }, Error>> {
  const sent = await execute({
    walletId: params.ownerWalletId,
    contractAddress: ERC8004_ARC_TESTNET.identityRegistry,
    abiFunctionSignature: "register(string)",
    abiParameters: [params.metadataURI],
  });
  if (sent.isErr()) return err(sent.error);
  try {
    const receipt = await arcRpc().getTransactionReceipt({ hash: sent.value as Hex });
    const agentId = agentIdFromLogs(receipt.logs, params.ownerAddress);
    if (!agentId) return err(new Error(`No identity Transfer log in ${sent.value}`));
    return ok({ agentId, txHash: sent.value });
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

/** Reads an agent's owner and card from the IdentityRegistry. */
export async function readAgent(
  agentId: string,
): Promise<Result<{ owner: string; tokenURI: string }, Error>> {
  try {
    const rpc = arcRpc();
    const id = BigInt(agentId);
    const [owner, tokenURI] = await Promise.all([
      rpc.readContract({
        address: ERC8004_ARC_TESTNET.identityRegistry,
        abi: IDENTITY_ABI,
        functionName: "ownerOf",
        args: [id],
      }),
      rpc.readContract({
        address: ERC8004_ARC_TESTNET.identityRegistry,
        abi: IDENTITY_ABI,
        functionName: "tokenURI",
        args: [id],
      }),
    ]);
    return ok({ owner, tokenURI });
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

/**
 * Records a completed execution in the ERC-8004 ReputationRegistry, from a
 * validator wallet (the owner may not rate its own agent). The feedback URI
 * is the execution's swap on the explorer, hashed as the feedback hash, so
 * the reputation entry points at the receipt. Keyed by execution id so a
 * retry never rates the same execution twice.
 */
export async function giveAgentFeedback(params: {
  validatorWalletId: string;
  agentId: string;
  executionId: string;
  feedbackURI: string;
  score?: number;
}): Promise<Result<string, Error>> {
  return execute({
    walletId: params.validatorWalletId,
    contractAddress: ERC8004_ARC_TESTNET.reputationRegistry,
    abiFunctionSignature: "giveFeedback(uint256,int128,uint8,string,string,string,string,bytes32)",
    abiParameters: [
      params.agentId,
      String(params.score ?? 100),
      "0",
      "fx_execution",
      "completed",
      "",
      params.feedbackURI,
      keccak256(stringToHex(params.feedbackURI)),
    ],
    idempotencyKey: uuidFrom(params.executionId),
  });
}

/** Sends a little USDC on Arc (gas for the validator wallet). */
export async function sendArcUsdc(params: {
  fromWalletId: string;
  toAddress: string;
  amount: string;
}): Promise<Result<string, Error>> {
  try {
    const res = await client().createTransaction({
      walletId: params.fromWalletId,
      destinationAddress: params.toAddress,
      amount: [params.amount],
      tokenAddress: ARC_USDC,
      blockchain: "ARC-TESTNET" as never,
      fee: { type: "level", config: { feeLevel: "MEDIUM" } },
    });
    const id = res.data?.id;
    if (!id) return err(new Error("transfer: no transaction id"));
    const done = await pollTransaction(id);
    if (done.isErr()) return err(done.error);
    if (done.value.state !== "COMPLETE" || !done.value.txHash) {
      return err(new Error(`transfer ended ${done.value.state}`));
    }
    return ok(done.value.txHash);
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

/** Deterministic v4-shaped UUID from a string, for Circle idempotency keys. */
export function uuidFrom(input: string): string {
  const h = keccak256(stringToHex(input)).slice(2, 34);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
