import type { ExecutionStatus, ExecutorState } from "./api";

const CHAIN_LABELS: Record<string, string> = {
  ETHEREUM_SEPOLIA: "Ethereum Sepolia",
  BASE_SEPOLIA: "Base Sepolia",
  ARBITRUM_SEPOLIA: "Arbitrum Sepolia",
  ARC_TESTNET: "Arc Testnet",
};

export function chainLabel(key: string): string {
  return CHAIN_LABELS[key] ?? key;
}

export function shortHash(hash: string): string {
  return hash.length > 14 ? `${hash.slice(0, 8)}…${hash.slice(-6)}` : hash;
}

/** Trims a decimal string to at most `digits` fractional digits, no trailing zeros. */
export function formatAmount(value: string, digits = 6): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return n.toLocaleString("en-US", { maximumFractionDigits: digits });
}

export type StepKey = "preflight" | "burn" | "attestation" | "mint" | "swap";
export type StepStatus = "waiting" | "active" | "done" | "failed";

export const STEPS: Array<{ key: StepKey; title: string; where: string }> = [
  { key: "preflight", title: "Pre-flight checks", where: "Config, route, wallet, balance" },
  { key: "burn", title: "Burn USDC", where: "Ethereum Sepolia · CCTP V2" },
  { key: "attestation", title: "Attestation", where: "Circle attestation service" },
  { key: "mint", title: "Mint USDC", where: "Arc Testnet" },
  { key: "swap", title: "Swap", where: "Arc Testnet · gas paid in USDC" },
];

/** The step each executor state is working on. */
const ACTIVE_STEP: Record<ExecutorState, number> = {
  created: 0,
  preflight: 0,
  burning: 1,
  awaiting_attestation: 2,
  minting: 3,
  swapping: 4,
  completed: 5,
  failed_funds_safe: -1,
};

/**
 * Maps an execution's persisted state to per-step statuses. For a failed
 * execution the failing step is the state it left for failed_funds_safe.
 */
export function stepStatuses(status: Pick<ExecutionStatus, "state" | "history">): StepStatus[] {
  if (status.state === "failed_funds_safe") {
    const lastFrom = status.history.at(-1)?.from ?? "preflight";
    const failedAt = ACTIVE_STEP[lastFrom];
    return STEPS.map((_, i) => (i < failedAt ? "done" : i === failedAt ? "failed" : "waiting"));
  }
  const active = ACTIVE_STEP[status.state];
  return STEPS.map((_, i) => (i < active ? "done" : i === active ? "active" : "waiting"));
}

/** Evidence step names recorded by the executor, mapped to UI steps. */
export function evidenceStep(step: string): StepKey | null {
  if (step === "approve" || step === "burn") return "burn";
  if (step === "mint") return "mint";
  if (step === "swap") return "swap";
  return null;
}
