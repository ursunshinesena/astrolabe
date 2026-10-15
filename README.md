# Astrolabe

Cross-Market Execution Agent.

> "One intent. Four chains. Guarded execution with deterministic refund paths."

## Requirements

- Node.js 20+
- pnpm 10+
- Foundry (forge, cast, anvil) — install via `curl -L https://foundry.paradigm.xyz | bash && foundryup`

## Setup

```bash
# Install dependencies
pnpm install

# Copy environment variables and fill in values
cp .env.example .env.local
```

Before running, register your Circle entity secret:
https://developers.circle.com/wallets/dev-controlled/register-entity-secret

## What it does

1. You type an intent — *"turn 5 USDC into euros on the best route"*.
2. Gemini parses it into a structured swap.
3. The API quotes every relevant chain in parallel (Uniswap V3 on the
   Sepolias, App Kit on Arc) and ranks the routes.
4. You see a dry-run preview. Nothing is sent until you approve.
5. The guarded executor runs **pre-flight → CCTP V2 burn → attestation →
   mint on Arc → swap on Arc**, persisting every state and tx hash.
   Failed swaps are retried only when a balance check proves the failed
   attempt did not execute; otherwise USDC stays on Arc and the record
   says so.

On testnet the executable route ends in **EURC on Arc** (Arc Testnet has
no WETH); ETH routes are shown as quote-only. See
[ADR 0001](docs/decisions/0001-execute-on-arc-with-eurc.md).

## Running Locally

```bash
# API (port 3001) and web (port 3000) together
pnpm dev

# Or separately
pnpm --filter @astrolabe/api dev
pnpm --filter @astrolabe/web dev
```

Open http://localhost:3000. Without Circle wallet variables the API runs
in quote-only mode; with them, "Approve & execute" sends real testnet
transactions.

## Live runner (testnet, from the terminal)

```bash
# Env keys present? Wallet balances?
pnpm --filter @astrolabe/live-runner live check

# One-time: find or create the ARC-TESTNET wallet and append it to .env.local
pnpm --filter @astrolabe/live-runner live setup-arc-wallet --write

# Dry run (default) — prints the route preview only
pnpm --filter @astrolabe/live-runner live run --amount 1 --to EURC

# Real execution: Ethereum Sepolia USDC -> CCTP V2 -> Arc -> EURC
pnpm --filter @astrolabe/live-runner live run --amount 1 --to EURC --execute

# Inspect or resume a persisted execution
pnpm --filter @astrolabe/live-runner live status <executionId>
pnpm --filter @astrolabe/live-runner live resume <executionId>
```

Execution records live in `.astrolabe/executions/` (git-ignored).

## Testing

```bash
# Unit tests (no network, mocked — always runnable)
pnpm test

# Type checking
pnpm type-check

# Smart contract tests (legacy — not part of the current execution path)
cd packages/contracts && forge test

# Integration tests (hit real testnet RPC — requires env vars)
ETH_SEPOLIA_RPC_URL=https://... BASE_SEPOLIA_RPC_URL=https://... pnpm --filter @astrolabe/pricing test
```

Integration tests are skipped automatically when RPC env vars are absent, so `pnpm test` is always safe to run in CI.

## Architecture

See [docs/architecture.md](docs/architecture.md) for the system overview
and [docs/m4-design.md](docs/m4-design.md) for the execution engine design.

## Supported Chains (testnet)

| Chain | CCTP Domain | DEX | Role |
|---|---|---|---|
| Ethereum Sepolia | 0 | Uniswap V3 | Source chain (USDC lives here) + ETH quotes |
| Base Sepolia | 6 | Uniswap V3 (0.3% pool, verified) | ETH quotes |
| Arbitrum Sepolia | 3 | Uniswap V3 | ETH quotes |
| Arc Testnet | 26 | App Kit swap (USDC, EURC) | **Execution destination** — gas paid in USDC |

Faucet: https://faucet.circle.com
Arc explorer: https://testnet.arcscan.app
