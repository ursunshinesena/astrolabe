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
export type Step = { key: StepKey; title: string; where: string };

/**
 * The steps a run goes through: funds already on Arc swap right after the
 * checks; funds from another chain are bridged in with CCTP V2 first.
 */
export function stepsFor(sourceChain: string | undefined): Step[] {
  const checks: Step = {
    key: "preflight",
    title: "Pre-flight checks",
    where: "Config, route, wallet, balance, gas",
  };
  const swap: Step = { key: "swap", title: "Swap on Arc", where: "Arc Testnet · gas paid in USDC" };
  if (sourceChain === "ARC_TESTNET") return [checks, swap];
  const from = chainLabel(sourceChain ?? "ETHEREUM_SEPOLIA");
  return [
    checks,
    { key: "burn", title: "Burn USDC", where: `${from} · CCTP V2` },
    { key: "attestation", title: "Attestation", where: "Circle attestation service" },
    { key: "mint", title: "Mint USDC", where: "Arc Testnet" },
    swap,
  ];
}

/** The step each executor state is working on. */
const STATE_STEP: Record<ExecutorState, StepKey | "done"> = {
  created: "preflight",
  preflight: "preflight",
  burning: "burn",
  awaiting_attestation: "attestation",
  minting: "mint",
  swapping: "swap",
  completed: "done",
  failed_funds_safe: "preflight",
};

/**
 * Maps an execution's persisted state to per-step statuses. For a failed
 * execution the failing step is the state it left for failed_funds_safe.
 */
export function stepStatuses(
  status: Pick<ExecutionStatus, "state" | "history">,
  steps: Step[],
): StepStatus[] {
  const indexOf = (state: ExecutorState) => {
    const key = STATE_STEP[state];
    return key === "done"
      ? steps.length
      : Math.max(
          0,
          steps.findIndex((s) => s.key === key),
        );
  };
  if (status.state === "failed_funds_safe") {
    const failedAt = indexOf(status.history.at(-1)?.from ?? "preflight");
    return steps.map((_, i) => (i < failedAt ? "done" : i === failedAt ? "failed" : "waiting"));
  }
  const active = indexOf(status.state);
  return steps.map((_, i) => (i < active ? "done" : i === active ? "active" : "waiting"));
}

/** Evidence step names recorded by the executor, mapped to UI steps. */
export function evidenceStep(step: string): StepKey | null {
  if (step === "approve" || step === "burn") return "burn";
  if (step === "mint") return "mint";
  if (step === "swap") return "swap";
  return null;
}
