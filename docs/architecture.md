# Architecture

## Overview

Astrolabe is a stablecoin FX agent. A user states a conversion in plain
language; the agent plans where to fund it from and executes it on Arc.

```
"turn 5 USDC into euros"
    │
    ▼
intent-parser — Gemini → { USDC → EURC, amount } (USDC/EURC only)
    │
    ▼
pricing.quoteRoutes
    │  ├── Arc FX quote (App Kit estimateSwap)
    │  └── every funding chain in parallel: balance, native gas, live CCTP fee
    ▼
planFundingRoutes — cheapest feasible source; reasons for the rest
    │
    ▼
web / runner — dry-run preview; nothing moves until approved
    │
    ▼
executor.runExecution — guarded state machine, persisted per transition
    │  preflight (balance, gas)
    │  ├─ funds on Arc ............................ swap
    │  └─ funds elsewhere: burn → attestation → mint (CCTP V2) → swap
    │     · attestation watchdog 300s → "in flight", never "safe"
    │     · post-burn failure → App Kit result kept → resume via retryBridge
    │     · swap retry only after a balance check proves no swap executed
    ▼
receipt (tx hashes + explorer links) → ERC-8004 rating on Arc
```

## Packages

| Package | Role |
|---|---|
| `@astrolabe/chains` | Chain configs (viem), CCTP domain IDs, App Kit chain names, USDC addresses |
| `@astrolabe/circle` | Developer-controlled wallets; App Kit bridge, swap, fee estimate, `retryBridge`; ERC-8004 identity and reputation |
| `@astrolabe/pricing` | Arc FX quotes, funding planner (`planFundingRoutes`, `quoteRoutes`), bridge/funding amounts |
| `@astrolabe/executor` | State machine, persistence, preflight, bridge and swap phases, retries, resume, reputation |
| `@astrolabe/intent-parser` | Gemini 2.5 Flash, structured output, zod-validated |
| `@astrolabe/api` | Hono: intents, plans, approved executions (idempotent, rate-limited), status |
| `@astrolabe/web` | Next.js 15: plan table, approval, live tracker, receipt |
| `@astrolabe/live-runner` | CLI: setup wallets, register agent, run, status, resume |

## Key design decisions

- **Arc is the FX hub** (ADR 0002): swaps happen where gas is USDC; routing
  decides where the liquidity comes from.
- **CCTP V2 through App Kit**: one `bridge()` call for approve → burn →
  attestation → mint, forwarder on Arc; live fees from `estimateBridge`;
  failed transfers resumed with `retryBridge`.
- **Orchestrated, not atomic**: no custom contract. Every step is persisted;
  the record always says where the funds are.
- **Developer-controlled wallets**: the agent executes without per-step
  signing prompts; same EOA address across chains in the wallet set.
- **Server-held quotes**: the client approves a quote id, never a route of
  its own; one execution per quote id; max 3 execution requests / 10s.
- **Typed errors** (`neverthrow`): failures are values, try/catch only at
  boundaries.
- **ERC-8004 identity**: the agent is registered on Arc; a separate
  validator wallet rates completed conversions, so reputation is on-chain
  and points at real receipts.
