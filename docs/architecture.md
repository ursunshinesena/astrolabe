# Architecture

## System Overview

Astrolabe is a cross-market execution agent. A user types a natural-language intent;
the agent resolves it to an optimal on-chain execution across up to 4 EVM chains.

```
User prompt
    │
    ▼
packages/intent-parser — LLM (Gemini 2.5 Flash) parses intent → ParsedIntent
    │
    ▼
packages/agent — Routing engine queries 4 chains in parallel
    │     ├── packages/pricing — Uniswap V3 QuoterV2 + Arc App Kit (price + gas per chain)
    │     └── packages/circle  — CCTP V2 bridge fee per route
    ▼
Optimal Route selected (lowest total cost: gas + bridge fee + slippage)
    │
    ▼
apps/web — Dry-run preview shown to user (requires explicit approval)
    │
    ▼
Executor (planned: packages/executor) — guarded state machine
    │     burn → attestation (polling, 5s–30min) → mint → swap
    │     Every state transition persisted (JSON file store).
    │     Swap failure → 3 retries (5s/15s/45s) → if still failing,
    │     USDC left safe on the destination chain (failed_funds_safe).
    ▼
ExecutionResult (tx hashes, actual output, block explorer links)
```

## Packages

| Package | Role |
|---|---|
| `@astrolabe/types` | Zod schemas + inferred types shared across all packages |
| `@astrolabe/chains` | Chain configs (viem), CCTP domain IDs, Circle chain names, RPC clients |
| `@astrolabe/intent-parser` | LLM intent parser (Gemini 2.5 Flash, structured output) |
| `@astrolabe/agent` | Routing engine |
| `@astrolabe/pricing` | DEX quoter wrappers — Uniswap V3 QuoterV2 + Arc App Kit `estimateSwap` |
| `@astrolabe/circle` | Circle SDK wrappers: developer-controlled wallets + App Kit bridge |
| `@astrolabe/executor` | (planned, M4a) Guarded execution state machine |
| `@astrolabe/contracts` | LEGACY — Foundry Hook project, not part of the current execution path |
| `@astrolabe/web` | Next.js 15 chat UI + execution dashboard |
| `@astrolabe/api` | Hono API server — intent endpoint, execution endpoint, status polling |

## Key Design Decisions

See `docs/decisions/` for ADRs and `docs/m4-design.md` for the execution engine design.

- **CCTP V2 over V1:** V1 is being phased out July 2026. We use V2 exclusively.
- **App Kit over raw CCTP:** Single `kit.bridge()` call handles approve → burn →
  attestation → mint. `useForwarder: true` removes destination-side complexity.
- **Orchestrated execution over Hooks:** No custom on-chain contract. The executor
  orchestrates burn → attestation → mint → swap as discrete steps with persisted
  state. Trade-off: not atomic — mitigated by deterministic refund paths (USDC is
  always recoverable on the destination chain).
- **Developer-controlled wallets + EOA:** Agent operates autonomously; user-controlled
  wallets would require interactive signing per step.
- **neverthrow Result type:** All async functions that can fail return `Result<T, E>`.
  Try/catch only at API boundaries.
- **Dry-run default:** No real transaction is sent until the user explicitly approves
  the route preview.
- **Uniswap V3 QuoterV2 for pricing:** Real on-testnet quotes; 0x has no testnet
  support. Base Sepolia 0.3% pool verified as the primary route (see m4-design.md).
