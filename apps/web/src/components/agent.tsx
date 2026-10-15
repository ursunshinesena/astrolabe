"use client";

import {
  type ApiConfig,
  type ExecutionStatus,
  type IntentResult,
  type QuoteResponse,
  api,
} from "@/lib/api";
import { chainLabel, formatAmount } from "@/lib/format";
import { type FormEvent, useEffect, useState } from "react";
import { ExecutionTracker, ProofCard } from "./execution-tracker";
import { RouteTable } from "./route-table";

const EXAMPLES = [
  "Turn 5 USDC into euros on the best route",
  "Best ETH position with 10 USDC",
  "Swap some USDC",
];

const POLL_MS = 2_000;
const TERMINAL = new Set(["completed", "failed_funds_safe"]);

type Phase = "idle" | "parsing" | "quoting" | "ready" | "executing";

export function Agent() {
  const [config, setConfig] = useState<ApiConfig | null>(null);
  const [apiDown, setApiDown] = useState(false);
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [intent, setIntent] = useState<IntentResult | null>(null);
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [executionId, setExecutionId] = useState<string | null>(null);
  const [status, setStatus] = useState<ExecutionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.config().then(setConfig, () => setApiDown(true));
  }, []);

  useEffect(() => {
    if (!executionId) return;
    let stopped = false;
    const tick = async () => {
      try {
        const next = await api.status(executionId);
        if (stopped) return;
        setStatus(next);
        if (TERMINAL.has(next.state) || next.error) {
          stopped = true;
          clearInterval(timer);
        }
      } catch {
        // The record may not be readable for a moment after it starts.
      }
    };
    const timer = setInterval(tick, POLL_MS);
    void tick();
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [executionId]);

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    const prompt = text.trim();
    if (!prompt) return;
    setError(null);
    setQuote(null);
    setIntent(null);
    setExecutionId(null);
    setStatus(null);
    setPhase("parsing");
    try {
      const parsed = await api.parse(prompt);
      setIntent(parsed);
      if (parsed.action !== "swap") {
        setPhase("idle");
        return;
      }
      if (parsed.sourceToken !== "USDC") {
        setIntent({ action: "error", reason: "Astrolabe spends USDC — start from USDC." });
        setPhase("idle");
        return;
      }
      setPhase("quoting");
      setQuote(await api.quote(parsed.amount, parsed.targetToken));
      setPhase("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("idle");
    }
  }

  async function approve() {
    if (!quote) return;
    setError(null);
    setPhase("executing");
    try {
      const { executionId: id } = await api.execute(quote.quoteId);
      setExecutionId(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("ready");
    }
  }

  const winner = quote?.winner ?? null;
  const canExecute = Boolean(winner?.executable && config?.executionEnabled && !executionId);
  const busy = phase === "parsing" || phase === "quoting";

  return (
    <div className="space-y-8">
      <StatusBar config={config} apiDown={apiDown} />

      <form
        onSubmit={submit}
        className="rounded-2xl border border-line bg-panel p-2 shadow-2xl shadow-black/30"
      >
        <label htmlFor="intent" className="sr-only">
          What do you want to do?
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="intent"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Say what you want — e.g. turn 5 USDC into euros"
            className="min-w-0 flex-1 rounded-xl bg-transparent px-4 py-3 text-lg outline-none placeholder:text-muted/70"
            disabled={busy || phase === "executing"}
          />
          <button
            type="submit"
            disabled={busy || !text.trim() || phase === "executing"}
            className="rounded-xl bg-brass px-6 py-3 font-semibold text-sky transition hover:bg-brass-deep disabled:opacity-40"
          >
            {phase === "parsing"
              ? "Reading…"
              : phase === "quoting"
                ? "Pricing 4 chains…"
                : "Plan route"}
          </button>
        </div>
      </form>
      <div className="-mt-5 flex flex-wrap gap-2">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => setText(ex)}
            className="rounded-full border border-line px-3 py-1 text-xs text-muted transition hover:border-brass hover:text-ink"
          >
            {ex}
          </button>
        ))}
      </div>

      {error && <Notice tone="bad">{error}</Notice>}
      {intent?.action === "needs_clarification" && <Notice tone="warn">{intent.question}</Notice>}
      {intent?.action === "error" && <Notice tone="bad">{intent.reason}</Notice>}

      {intent?.action === "swap" && (
        <p className="text-sm text-muted">
          Understood: spend <b className="text-ink">{intent.amount} USDC</b> for{" "}
          <b className="text-ink">{intent.targetToken}</b>. Funds start on{" "}
          {chainLabel("ETHEREUM_SEPOLIA")}.
        </p>
      )}

      {quote && (
        <section className="space-y-4">
          <h2 className="font-display text-2xl">Routes compared</h2>
          {quote.routes.length > 0 || quote.failures.length > 0 ? (
            <RouteTable quote={quote} />
          ) : (
            <Notice tone="warn">No chain can quote {quote.tokenOut} on testnet.</Notice>
          )}
          {winner && <Reasoning quote={quote} />}

          {winner?.executable && !executionId && (
            <div className="flex flex-col gap-3 rounded-xl border border-brass/40 bg-brass/5 p-5 sm:flex-row sm:items-center">
              <p className="flex-1 text-sm">
                <b>Dry run.</b> Nothing has been sent. Approving bridges{" "}
                {winner.bridgeAmount ?? quote.amount} USDC (incl. fees and Arc gas) from{" "}
                {chainLabel(winner.sourceChain)} to {chainLabel(winner.destinationChain)} with CCTP
                V2, then swaps to {winner.swapQuote.tokenOut} (max slippage{" "}
                {winner.expectedSlippageBps / 100}%).
              </p>
              <button
                type="button"
                onClick={approve}
                disabled={!canExecute || phase === "executing"}
                className="rounded-xl bg-brass px-6 py-3 font-semibold text-sky transition hover:bg-brass-deep disabled:opacity-40"
                title={
                  config?.executionEnabled ? undefined : "Wallets are not configured on the API"
                }
              >
                Approve & execute
              </button>
            </div>
          )}
        </section>
      )}

      {executionId && (
        <section className="space-y-4">
          <h2 className="font-display text-2xl">Guarded execution</h2>
          <div className="rounded-xl border border-line bg-panel p-2">
            {status ? (
              <ExecutionTracker status={status} />
            ) : (
              <p className="p-4 text-sm text-muted">Starting…</p>
            )}
          </div>
          {status && (TERMINAL.has(status.state) || status.error) && <ProofCard status={status} />}
        </section>
      )}
    </div>
  );
}

function Reasoning({ quote }: { quote: QuoteResponse }) {
  const winner = quote.winner;
  if (!winner) return null;
  const best = quote.routes[0];
  const out = `${formatAmount(winner.netAmountOut)} ${winner.swapQuote.tokenOut}`;
  if (!winner.executable) {
    return (
      <p className="text-sm text-muted">
        Best price: {chainLabel(winner.destinationChain)} at ~{out}. On testnet this is quote-only —{" "}
        {winner.reason}. Try a EURC route to see a full execution on Arc.
      </p>
    );
  }
  const better =
    best && best.destinationChain !== winner.destinationChain
      ? ` ${chainLabel(best.destinationChain)} quoted more but can't be executed here.`
      : "";
  return (
    <p className="text-sm text-muted">
      Chosen: <b className="text-ink">{chainLabel(winner.destinationChain)}</b>, ~{out} after the{" "}
      {winner.bridgeFee.amount} USDC bridge fee. Gas on Arc is paid in USDC, so the agent never
      needs a separate gas token.{better}
    </p>
  );
}

function StatusBar({ config, apiDown }: { config: ApiConfig | null; apiDown: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="rounded-full border border-line px-3 py-1 text-muted">Testnet</span>
      {apiDown ? (
        <span className="rounded-full bg-bad/15 px-3 py-1 text-bad">API unreachable</span>
      ) : config?.executionEnabled ? (
        <span className="rounded-full bg-ok/15 px-3 py-1 text-ok">Wallets ready</span>
      ) : (
        <span className="rounded-full bg-warn/15 px-3 py-1 text-warn">Quote-only mode</span>
      )}
    </div>
  );
}

function Notice({ tone, children }: { tone: "warn" | "bad"; children: React.ReactNode }) {
  const styles = tone === "bad" ? "border-bad/40 bg-bad/10" : "border-warn/40 bg-warn/10";
  return <div className={`rounded-xl border px-4 py-3 text-sm ${styles}`}>{children}</div>;
}
