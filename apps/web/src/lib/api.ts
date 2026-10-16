/** Typed client for the Astrolabe API (apps/api). */

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export type IntentResult =
  | { action: "swap"; sourceToken: string; targetToken: string; amount: string }
  | { action: "needs_clarification"; question: string; missingFields: string[] }
  | { action: "error"; reason: string };

export type RouteView = {
  strategy: "swap_only" | "bridge_then_swap";
  sourceChain: string;
  destinationChain: string;
  swapQuote: { tokenIn: string; tokenOut: string; amountIn: string; amountOut: string };
  bridgeFee: { amount: string; source: string };
  netAmountOut: string;
  expectedSlippageBps: number;
  requiredAmount: string;
  balance: string | null;
  costUsdc: string;
  executable: boolean;
  reason?: string;
  bridgeAmount?: string;
};

export type QuoteResponse = {
  quoteId: string;
  amount: string;
  tokenIn: string;
  tokenOut: string;
  rate: string | null;
  amountOut: string | null;
  routes: RouteView[];
  winner: RouteView | null;
  error?: string;
};

export type ExecutorState =
  | "created"
  | "preflight"
  | "burning"
  | "awaiting_attestation"
  | "minting"
  | "swapping"
  | "completed"
  | "failed_funds_safe";

export type ExecutionStatus = {
  id: string;
  state: ExecutorState;
  history: Array<{ from: ExecutorState; to: ExecutorState; at: string }>;
  plan: {
    sourceChain?: string;
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
    arcAddress: string;
  } | null;
  evidence: Array<{ step: string; txHash: string; chain: string | null; explorerUrl?: string }>;
  error: string | null;
  updatedAt: string | null;
};

export type ApiConfig = {
  network: string;
  fxHub: string;
  executionEnabled: boolean;
  wallets: Record<string, string | null>;
};

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
}

export const api = {
  config: () => call<ApiConfig>("/api/config"),
  parse: (text: string) =>
    call<IntentResult>("/api/intents", { method: "POST", body: JSON.stringify({ text }) }),
  quote: (amount: string, tokenIn: string, tokenOut: string) =>
    call<QuoteResponse>("/api/quotes", {
      method: "POST",
      body: JSON.stringify({ amount, tokenIn, tokenOut }),
    }),
  execute: (quoteId: string) =>
    call<{ executionId: string }>("/api/executions", {
      method: "POST",
      body: JSON.stringify({ quoteId, approved: true }),
    }),
  status: (id: string) => call<ExecutionStatus>(`/api/executions/${encodeURIComponent(id)}`),
};
