import type { ExecutionStatus } from "@/lib/api";
import {
  type StepStatus,
  chainLabel,
  evidenceStep,
  formatAmount,
  shortHash,
  stepStatuses,
  stepsFor,
} from "@/lib/format";

const DOT: Record<StepStatus, string> = {
  waiting: "border-line bg-sky",
  active: "border-brass bg-brass/30 animate-pulse",
  done: "border-ok bg-ok",
  failed: "border-bad bg-bad",
};

/** Live view of the guarded state machine, one row per execution step. */
export function ExecutionTracker({ status }: { status: ExecutionStatus }) {
  const steps = stepsFor(status.plan?.sourceChain);
  const statuses = stepStatuses(status, steps);
  return (
    <ol className="space-y-1">
      {steps.map((step, i) => {
        const s = statuses[i] ?? "waiting";
        const txs = status.evidence.filter((e) => evidenceStep(e.step) === step.key);
        return (
          <li key={step.key} className="flex gap-4 rounded-lg px-3 py-3">
            <span
              className={`mt-1 size-3.5 shrink-0 rounded-full border-2 ${DOT[s]}`}
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                <p className={`font-medium ${s === "waiting" ? "text-muted" : ""}`}>{step.title}</p>
                <p className="text-xs text-muted">{step.where}</p>
              </div>
              {txs.map((tx) => (
                <a
                  key={tx.txHash}
                  href={tx.explorerUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 block font-mono text-xs text-brass hover:underline"
                >
                  {tx.step} · {shortHash(tx.txHash)} ↗
                </a>
              ))}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Final receipt: what happened, where the funds are, and every tx hash. */
export function ProofCard({ status }: { status: ExecutionStatus }) {
  const ok = status.state === "completed";
  const plan = status.plan;
  return (
    <section
      className={`rounded-xl border p-5 ${ok ? "border-ok/40 bg-ok/5" : "border-bad/40 bg-bad/5"}`}
    >
      <p className={`text-xs uppercase tracking-wider ${ok ? "text-ok" : "text-bad"}`}>
        {ok ? "Executed on testnet" : "Stopped safely"}
      </p>
      <h3 className="mt-1 font-display text-2xl">
        {ok && plan
          ? `${formatAmount(plan.amountIn)} ${plan.tokenIn} → ${plan.tokenOut} on Arc`
          : "No further transactions were sent"}
      </h3>
      {ok && plan?.sourceChain && (
        <p className="mt-1 text-sm text-muted">
          Funded from {chainLabel(plan.sourceChain)}
          {plan.sourceChain === "ARC_TESTNET" ? " — no bridge needed" : " via CCTP V2"}
        </p>
      )}
      {status.error && <p className="mt-2 text-sm text-muted">{status.error}</p>}
      {status.evidence.length > 0 && (
        <ul className="mt-4 space-y-1 font-mono text-xs">
          {status.evidence.map((e) => (
            <li key={e.txHash} className="flex flex-wrap gap-x-3">
              <span className="w-16 text-muted">{e.step}</span>
              <a
                href={e.explorerUrl}
                target="_blank"
                rel="noreferrer"
                className="break-all text-brass hover:underline"
              >
                {e.txHash}
              </a>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-xs text-muted">Execution {status.id}</p>
    </section>
  );
}
