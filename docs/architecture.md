# Architecture

## System Overview

Agora Agent is a cross-market execution agent. A user types a natural-language intent; the agent resolves it to an optimal on-chain execution across up to 4 EVM chains.

```
User prompt
    │
    ▼
packages/agent — LLM (claude-sonnet-4-6) parses intent → ParsedIntent
    │
    ▼
packages/agent — Routing engine queries 4 chains in parallel
    │   └── packages/pricing — 0x Swap API (price + gas per chain)
    │   └── packages/circle  — CCTP V2 bridge fee per route
    │
    ▼
Optimal Route selected (lowest total cost: gas + bridge fee + slippage)
    │
    ▼
apps/web — Dry-run preview shown to user (requires explicit approval)
    │
    ▼
apps/api — Execution
    │   └── packages/circle — @circle-fin/app-kit bridge() call
    │   └── packages/contracts — CCTP V2 Hook: mint + swap atomically
    │
    ▼
ExecutionResult (tx hashes, actual output, block explorer links)
```

## Packages

| Package | Role |
|---|---|
| `@agora/types` | Zod schemas + inferred types shared across all packages |
| `@agora/chains` | Chain configs (viem), CCTP domain IDs, Circle chain names, RPC clients |
| `@agora/agent` | LLM intent parser + routing engine |
| `@agora/pricing` | 0x Swap API wrapper — price quotes per chain |
| `@agora/circle` | Circle SDK wrappers: developer-controlled wallets + App Kit bridge |
| `@agora/contracts` | Foundry project: IHook interface + SwapHook implementation |
| `@agora/web` | Next.js 15 chat UI + execution dashboard |
| `@agora/api` | Hono API server — intent endpoint, execution endpoint, status polling |

## Key Design Decisions

See `docs/decisions/` for ADRs.

- **CCTP V2 over V1:** V1 is being phased out July 2026. We use V2 exclusively.
- **App Kit over raw CCTP:** Single `kit.bridge()` call handles approve → burn → attestation → mint. `useForwarder: true` removes destination-side complexity.
- **Developer-controlled wallets + EOA:** Agent operates autonomously; user-controlled wallets would require interactive signing per step.
- **neverthrow Result type:** All async functions that can fail return `Result<T, E>`. Try/catch only at API boundaries.
- **Dry-run default:** No real transaction is sent until the user explicitly approves the route preview.
