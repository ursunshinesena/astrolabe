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

## Running Locally

```bash
# All services
pnpm dev

# API only (port 3001)
pnpm --filter @astrolabe/api dev

# Web only (port 3000)
pnpm --filter @astrolabe/web dev
```

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
| Ethereum Sepolia | 0 | Uniswap V3 | Source chain |
| Base Sepolia | 6 | Uniswap V3 (0.3% pool, verified) | Primary swap destination |
| Arc Testnet | 26 | App Kit swap | Quote comparison |
| Arbitrum Sepolia | 3 | Uniswap V3 | Backup route (unverified) |

Faucet: https://faucet.circle.com
Arc explorer: https://testnet.arcscan.app
