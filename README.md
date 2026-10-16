# Astrolabe

**A stablecoin FX agent with Arc as its settlement hub.**

> Dollars to euros, from any chain. Settled on Arc, with guarded execution.

You say *"turn 5 USDC into euros"*. Astrolabe finds where your USDC is,
picks the cheapest way to bring it to Arc, waits for your approval, then
swaps USDC ↔ EURC on Arc — where gas is paid in USDC — and hands you a
receipt with every transaction on the explorer. Each completed conversion
is also rated against the agent's ERC-8004 identity on Arc.

## How it decides

For every conversion the agent reads all funding chains in parallel:

| Funding source | When it wins | Cost |
|---|---|---|
| **Arc** (funds already there) | enough balance for the amount + gas reserve | none — swap only |
| **Ethereum / Base / Arbitrum Sepolia** | cheapest chain with enough USDC and native gas | live CCTP V2 fee (≈0.02–0.10 USDC) |

Each source is shown with its balance and, if it can't be used, why
(*no wallet*, *needs X, has Y*, *no native gas*). The FX rate comes from
Circle App Kit on Arc. Nothing moves until you approve the dry-run preview.

## Guarded execution

`preflight → [burn → attestation → mint] → swap → completed`, every state
persisted to disk with its tx hashes:

- **Pre-flight** checks config, wallet, input-token balance and source-chain gas.
- **Bridge** with CCTP V2 (App Kit, forwarder on Arc). No attestation in
  300s → the record says the USDC is in flight. A bridge that fails after
  the burn keeps App Kit's result and is finished later with `retryBridge` —
  never burned twice.
- **Swap** on Arc. A failed swap is retried (5s/15s/45s) only when a
  balance check proves the failed attempt didn't execute; otherwise it stops
  and says so. Exhausted retries leave the USDC on Arc (`failed_funds_safe`).
- **Reputation**: a validator wallet rates the agent in Arc's ERC-8004
  ReputationRegistry, pointing at the swap.

See [docs/m4-design.md](docs/m4-design.md) and
[ADR 0002](docs/decisions/0002-stablecoin-fx-on-arc.md).

## Requirements

- Node.js 20+, pnpm 10+
- A Circle developer account (API key + registered entity secret):
  https://developers.circle.com/wallets/dev-controlled/register-entity-secret
- A Gemini API key for intent parsing

## Setup

```bash
pnpm install
cp .env.example .env.local     # fill CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET, CIRCLE_WALLET_SET_ID, GEMINI_API_KEY
pnpm build

# Find or create a wallet on Arc and every funding chain
pnpm --filter @astrolabe/live-runner live setup-wallets --write

# Give the agent its ERC-8004 identity on Arc (one time)
pnpm --filter @astrolabe/live-runner live register-agent --write

# Balances on every chain
pnpm --filter @astrolabe/live-runner live check
```

Fund the Ethereum Sepolia wallet with testnet USDC (https://faucet.circle.com)
and a little Sepolia ETH for approve/burn gas. Arc needs no gas token.

## Run

```bash
pnpm dev        # API on :3001, web app on :3000
```

Or from the terminal:

```bash
# Dry run (default): the funding plan, nothing sent
pnpm --filter @astrolabe/live-runner live run --amount 5 --from USDC --to EURC

# Execute
pnpm --filter @astrolabe/live-runner live run --amount 5 --from USDC --to EURC --execute

# Inspect or resume a persisted execution
pnpm --filter @astrolabe/live-runner live status <executionId>
pnpm --filter @astrolabe/live-runner live resume <executionId>
```

Execution records live in `.astrolabe/executions/` (git-ignored).

## Test

```bash
pnpm test         # unit + fault-injection tests, no network
pnpm type-check
pnpm lint
```

## Packages

| Package | Role |
|---|---|
| `@astrolabe/chains` | Chain configs, CCTP domains, USDC addresses |
| `@astrolabe/circle` | Circle wallets, App Kit bridge/swap/fees/retry, ERC-8004 registries |
| `@astrolabe/pricing` | Arc FX quotes and the funding planner |
| `@astrolabe/executor` | Guarded state machine, retries, resume, reputation |
| `@astrolabe/intent-parser` | Gemini → validated USDC/EURC intent |
| `@astrolabe/api` | Hono API: intents, plans, approved executions, status |
| `@astrolabe/web` | Next.js app: plan, approve, live tracker, receipt |
| `@astrolabe/live-runner` | CLI for the same flow on testnet |

## Supported chains (testnet)

| Chain | CCTP domain | Role |
|---|---|---|
| Arc Testnet | 26 | FX hub: USDC ↔ EURC swaps, gas in USDC, ERC-8004 identity |
| Ethereum Sepolia | 0 | Funding source |
| Base Sepolia | 6 | Funding source |
| Arbitrum Sepolia | 3 | Funding source |

Arc explorer: https://testnet.arcscan.app
