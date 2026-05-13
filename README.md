# Agora Agent

Cross-Market Execution Agent — Agora Agent Hackathon (Canteen + Circle).

> "4 chains, 1 prompt, 1 confirmation, atomic settlement."

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
pnpm --filter @agora/api dev

# Web only (port 3000)
pnpm --filter @agora/web dev
```

## Testing

```bash
# TypeScript unit tests
pnpm test

# Type checking
pnpm type-check

# Smart contract tests
cd packages/contracts && forge test
```

## Architecture

See [docs/architecture.md](docs/architecture.md).

## Supported Chains (testnet)

| Chain | CCTP Domain |
|---|---|
| Ethereum Sepolia | 0 |
| Avalanche Fuji | 1 |
| Base Sepolia | 6 |
| Arc Testnet | 26 |

Faucet: https://faucet.circle.com
