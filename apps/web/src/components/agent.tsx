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

const EXAMPLES = ["Turn 5 USDC into euros", "Convert 2 EURC back to dollars", "I want some euros"];

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
      setPhase("quoting");
      setQuote(await api.quote(parsed.amount, parsed.sourceToken, parsed.targetToken));
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
          Understood: convert{" "}
          <b className="text-ink">
            {intent.amount} {intent.sourceToken}
          </b>{" "}
          to <b className="text-ink">{intent.targetToken}</b> on Arc. Checking every chain for
          funds…
        </p>
      )}

      {quote && (
        <section className="space-y-4">
          <h2 className="font-display text-2xl">Where to fund it from</h2>
          {quote.error ? (
            <Notice tone="bad">{quote.error}</Notice>
          ) : (
            <>
              <p className="text-sm text-muted">
                On Arc: {formatAmount(quote.amount)} {quote.tokenIn} →{" "}
                <b className="text-ink">
                  ~{formatAmount(quote.amountOut ?? "0", 4)} {quote.tokenOut}
                </b>{" "}
                (1 {quote.tokenIn} = {quote.rate} {quote.tokenOut})
              </p>
              <RouteTable quote={quote} />
              <Reasoning quote={quote} />
            </>
          )}

          {winner?.executable && !executionId && (
            <div className="flex flex-col gap-3 rounded-xl border border-brass/40 bg-brass/5 p-5 sm:flex-row sm:items-center">
              <p className="flex-1 text-sm">
                <b>Dry run.</b> Nothing has been sent.{" "}
                {winner.strategy === "swap_only"
                  ? `Approving swaps ${quote.amount} ${quote.tokenIn} to ${quote.tokenOut} directly on Arc`
                  : `Approving bridges ${winner.bridgeAmount} USDC (incl. fees and Arc gas) from ${chainLabel(winner.sourceChain)} to Arc with CCTP V2, then swaps to ${quote.tokenOut}`}{" "}
                (max slippage {winner.expectedSlippageBps / 100}%).
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
  if (!winner) {
    return (
      <p className="text-sm text-muted">
        No chain holds enough {quote.tokenIn} to fund this conversion. Top up a wallet or lower the
        amount.
      </p>
    );
  }
  const where = chainLabel(winner.sourceChain);
  if (winner.strategy === "swap_only") {
    return (
      <p className="text-sm text-muted">
        Chosen: <b className="text-ink">{where}</b>. The funds are already on Arc, so there is no
        bridge and no bridge fee; the swap pays its gas in USDC.
      </p>
    );
  }
  return (
    <p className="text-sm text-muted">
      Chosen: <b className="text-ink">{where}</b>, the cheapest chain that can cover it — a{" "}
      {formatAmount(winner.costUsdc)} USDC CCTP fee (live estimate) to bring the funds to Arc, where
      the swap pays its gas in USDC.
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
      {config?.agentId && (
        <a
          href={`https://testnet.arcscan.app/token/0x8004A818BFB912233c491871b3d84c89A494BD9e/instance/${config.agentId}`}
          target="_blank"
          rel="noreferrer"
          className="rounded-full border border-brass/50 px-3 py-1 text-brass hover:bg-brass/10"
        >
          Agent #{config.agentId} · ERC-8004 identity on Arc ↗
        </a>
      )}
    </div>
  );
}

function Notice({ tone, children }: { tone: "warn" | "bad"; children: React.ReactNode }) {
  const styles = tone === "bad" ? "border-bad/40 bg-bad/10" : "border-warn/40 bg-warn/10";
  return <div className={`rounded-xl border px-4 py-3 text-sm ${styles}`}>{children}</div>;
}
