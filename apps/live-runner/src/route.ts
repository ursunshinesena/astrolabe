import type { BridgeResult, SwapOnArcResult } from "@astrolabe/circle";
import type { QuoteOutcome } from "@astrolabe/pricing";

const LABELS: Record<string, string> = {
  ARC_TESTNET: "Arc Testnet",
  ETHEREUM_SEPOLIA: "Ethereum Sepolia",
  BASE_SEPOLIA: "Base Sepolia",
  ARBITRUM_SEPOLIA: "Arbitrum Sepolia",
};

/** Human-readable dry-run preview of the funding plan and the chosen route. */
export function formatPlan(plan: QuoteOutcome): string {
  if (plan.error) return `No plan: ${plan.error}`;
  const lines = [
    "Funding plan (dry run — nothing has been sent)",
    `  convert:  ${plan.amount} ${plan.tokenIn} -> ~${plan.amountOut} ${plan.tokenOut} on Arc (rate ${plan.rate})`,
    "",
  ];
  for (const r of plan.routes) {
    const mark = plan.winner && r.sourceChain === plan.winner.sourceChain ? "★" : " ";
    const how =
      r.strategy === "swap_only"
        ? "swap on Arc"
        : r.feasible || r.swapQuote.tokenIn === "USDC"
          ? `bridge ${r.bridgeAmount} USDC`
          : "—";
    const status = r.feasible ? `fee ${r.costUsdc} USDC` : r.reason;
    const label = (LABELS[r.sourceChain] ?? r.sourceChain).padEnd(18);
    lines.push(`  ${mark} ${label} ${how.padEnd(22)} ${status}`);
  }
  lines.push("");
  lines.push(
    plan.winner
      ? `  chosen:   ${LABELS[plan.winner.sourceChain]} (${plan.winner.strategy}), gas on Arc paid in USDC`
      : "  chosen:   none — no funding source can cover this conversion",
  );
  return lines.join("\n");
}

/** One line per on-chain transaction, with an explorer link where known. */
export function formatEvidence(bridge: BridgeResult | null, swap: SwapOnArcResult | null): string {
  const lines: string[] = [];
  for (const step of bridge?.steps ?? []) {
    if (step.txHash) lines.push(`  ${step.name.padEnd(17)} ${step.txHash}`);
  }
  if (swap) {
    lines.push(
      `  ${"swap".padEnd(17)} ${swap.txHash}${swap.explorerUrl ? `  ${swap.explorerUrl}` : ""}`,
    );
  }
  return lines.length > 0 ? lines.join("\n") : "  (no transactions)";
}
