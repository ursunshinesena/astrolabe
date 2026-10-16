# CLAUDE.md

> **This file lives at the repo root and is read automatically in every Claude Code session.**
> The rules here are binding for all tasks. If there is a conflict, this file wins.

---

## 1. MANDATORY BOOTSTRAP — Do this before anything else

**When starting a new Claude Code session, complete these steps in order BEFORE writing any code:**

### 1.1 Check whether Circle Skills are installed

```bash
ls ~/.claude/plugins/marketplaces/circle/ 2>/dev/null || echo "MISSING"
```

If `MISSING`, ask the user to run these inside Claude Code:

```
/plugin marketplace add circlefin/skills
/plugin install circle-skills@circle
```

### 1.2 Check whether the Circle MCP server is connected

Use `/mcp` to list connected servers. If `circle` is absent, tell the user to run:

```
claude mcp add --transport http circle https://api.circle.com/v1/codegen/mcp --scope user
```

### 1.3 Read the skills before planning

**MANDATORY READING ORDER** (before starting a task):

| Task type | Read first |
|---|---|
| CCTP / bridge / cross-chain | `bridge-stablecoin` skill |
| Deploying to Arc or Arc-specific | `use-arc` skill |
| Wallet creation/management | `use-circle-wallets` + `use-developer-controlled-wallets` |
| Smart contract deploy | `use-smart-contract-platform` skill |
| Nanopayments / micropayments | `use-gateway` skill |
| Routing/swap engine | App Kit docs (`docs.arc.io/app-kit`) |

**Rule:** Do not write code in an area without reading its skill. Skills contain
architecture decisions, common mistakes, and correct patterns.

### 1.4 Use MCP for live data

The information below **may be stale** — contract addresses, SDK signatures, chain IDs,
CCTP domain IDs, fee structures. When you need them, **ask the Circle MCP server**;
do not use hardcoded values.

---

## 2. PROJECT SUMMARY

**Product:** Stablecoin FX agent with Arc as its settlement hub (ADR 0002). The user
types a conversion ("turn 5 USDC into euros"). The agent:

1. Parses the intent into a structured USDC ↔ EURC conversion via LLM
2. Quotes the FX rate on Arc and reads every funding chain in parallel (balance,
   native gas, live CCTP fee)
3. Picks where to fund it from: funds already on Arc (no bridge) or the cheapest
   chain that can cover it, bridged with CCTP V2
4. Gets user approval (dry-run preview)
5. Executes with guarded execution: [burn → attestation → mint] → swap on Arc.
   Every step is persisted; swaps retry only when a balance check proves the failed
   attempt did not execute; post-burn bridge failures resume with App Kit retryBridge
6. Rates the conversion against the agent's ERC-8004 identity on Arc

**Pitch:** "Dollars to euros, from any chain. Settled on Arc, with guarded execution."

### Why this idea fits Arc
- Arc is stablecoin-native: the FX happens where gas is USDC — no second gas token
- **CCTP V2** brings liquidity to Arc from wherever it sits; routing is about
  liquidity location, with real fees
- We build on **App Kit** (bridge, swap, estimates, retry) instead of rebuilding it
- **ERC-8004** gives the agent an on-chain identity and receipts-backed reputation

---

## 3. TECHNOLOGY STACK — IMMUTABLE

| Layer | Choice | Why |
|---|---|---|
| Monorepo | Turborepo + pnpm | Fast builds, parallel tasks |
| Backend | Hono (Node 20+, TypeScript strict) | Fast, edge-ready |
| Frontend | Next.js 15 (App Router) + Tailwind + shadcn/ui | Fast development, modern UX |
| LLM | Gemini Flash (Google AI Studio) | Tool use + structured output |
| Wallet | Circle Programmable Wallets (developer-controlled) | UX score, sponsor integration |
| Cross-chain | **CCTP V2** (Bridge Kit SDK) + Arc App Kit | Use V2 — V1 phase-out July 31, 2026 |
| FX | Arc App Kit `estimateSwap` / `swap` (USDC ↔ EURC) | Arc Testnet swaps stablecoins only |
| Agent identity | ERC-8004 registries on Arc | On-chain identity and reputation |
| Validation | zod | Runtime schema |
| Linting | biome | One tool, fast |
| Hosting | Vercel (web) + Railway (api) | Sufficient for the MVP |

### Supported chains (testnet)

**Ask Circle MCP for current domain IDs and contract addresses. The table below can
go stale; MCP has the final word.**

| Chain | Notes |
|---|---|
| **Arc Testnet** | FX hub: USDC ↔ EURC swaps, USDC-as-gas, ERC-8004 identity |
| Ethereum Sepolia | Funding source (CCTP V2) |
| Base Sepolia | Funding source (CCTP V2) |
| Arbitrum Sepolia | Funding source (CCTP V2) |

Faucet: https://faucet.circle.com
Arc explorer: https://testnet.arcscan.app

---

## 4. MONOREPO STRUCTURE

```
astrolabe/
├── apps/
│   ├── web/             # Next.js 15 frontend
│   ├── api/             # Hono backend
│   └── live-runner/     # CLI: drive the executor on testnet
├── packages/
│   ├── chains/          # Chain configs, CCTP domains, USDC addresses
│   ├── circle/          # Circle SDK wrappers (Wallets, CCTP, App Kit, ERC-8004)
│   ├── executor/        # Guarded execution state machine
│   ├── intent-parser/   # LLM intent parser (Gemini 2.5 Flash)
│   └── pricing/         # Arc FX quotes + funding planner
├── docs/
│   ├── architecture.md  # Architecture decisions
│   ├── m4-design.md     # Execution engine design (M4)
│   ├── demo-script.md   # Demo scenarios
│   ├── milestones/      # LEGACY milestone prompts (M0-M9, old plan)
│   └── decisions/       # ADRs (Architecture Decision Records)
├── .env.example
├── CLAUDE.md            # this file
├── README.md
├── turbo.json
├── package.json
└── pnpm-workspace.yaml
```

### Package dependency rules
- `apps/*` → any `packages/*`
- `packages/executor` → `chains`, `circle`, `pricing`
- `packages/pricing` → `chains`, `circle` (types)
- NO circular dependencies between `packages/*`

---

## 5. CODE STANDARDS

### TypeScript
- `strict: true`, `noUncheckedIndexedAccess: true`
- `any` is forbidden. Use `unknown` + narrowing.
- zod schemas for public APIs. Types are derived from schemas via `z.infer<>`.
- Use the `Result<T, E>` pattern (neverthrow) in async functions. Try/catch only at
  outer boundaries.

### Frontend
- Server components by default. Client components only where interactivity is required.
- Don't override shadcn/ui components — add variants.
- Colors are defined as tokens (Tailwind v4 `@theme` in `globals.css`); hardcoded hex
  in components is FORBIDDEN.

### Naming
- Files: `kebab-case.ts`
- Components: `PascalCase`
- Functions/vars: `camelCase`
- Constants: `SCREAMING_SNAKE_CASE`
- Types/Interfaces: `PascalCase`, no prefix (no `I` on interfaces)

---

## 6. SECURITY RULES — NON-NEGOTIABLE

1. **No private key, API key, or mnemonic is ever committed to the repo.** `.env.local`
   is in gitignore.
2. **Code touching user funds is not merged to main without review.** At least 1 approval.
3. **Slippage protection is mandatory.** Every execution path must carry a maxSlippage
   parameter and revert if exceeded.
4. **Idempotency:** If the same intent ID arrives twice, the second request is rejected.
5. **Idempotency + persistent state are mandatory in every flow that moves funds.**
   Every step is persisted; after an interruption, execution must be able to resume
   where it left off, and funds must never be left in an ambiguous state.
6. **Dry-run mode is the default.** No real tx is sent without explicit user approval.
7. **Testnet and mainnet configs live in separate files.** They never mix in the same
   code path.
8. **CCTP attestation polling has a timeout** (default 300s). Never wait forever.
9. **Rate limiting:** max 3 execution requests per user per 10s.

---

## 7. TASK MANAGEMENT — What Claude Code must do

### When starting a new task
1. **Use plan mode** (`/plan`). Break the task into pieces first.
2. Read the relevant skills (see §1.3).
3. List the files that will be affected.
4. State the test strategy (unit, integration, e2e).
5. Get user approval.
6. Then write code.

### While writing code
- **Small, atomic commits.** One commit, one logical change.
- **Conventional commits** format: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`.
- Every PR ≤ 400 lines of change. Split anything larger.
- **NO Claude attribution in commit messages.** "Co-Authored-By: Claude",
  "Generated with Claude", "🤖" or any similar marker never appears in any commit.
  This is Sena's project.

### Tests
- Minimum 1 happy-path test for every new function.
- Minimum 1 failure-path test for every function that moves funds.
- Network mocks via MSW (frontend) and nock (backend) for integration tests.

### Documentation
- When making an architecture decision, write an ADR in `docs/decisions/NNNN-title.md`.
- Every public API gets JSDoc/NatSpec.
- The "how to run locally" steps in the README stay current at all times.

---

## 8. ENV VARIABLES

`.env.example`:
```bash
# Gemini (Google AI Studio)
GEMINI_API_KEY=

# Circle
CIRCLE_API_KEY=
CIRCLE_ENTITY_SECRET=
CIRCLE_WALLET_SET_ID=
# Wallets per chain (written by `live-runner setup-wallets --write`)
CIRCLE_WALLET_ID_ARC_TESTNET= / CIRCLE_WALLET_ADDR_ARC_TESTNET=
CIRCLE_WALLET_ID_ETH_SEPOLIA= / CIRCLE_WALLET_ADDR_ETH_SEPOLIA=
CIRCLE_WALLET_ID_BASE_SEPOLIA= / CIRCLE_WALLET_ADDR_BASE_SEPOLIA=
CIRCLE_WALLET_ID_ARB_SEPOLIA= / CIRCLE_WALLET_ADDR_ARB_SEPOLIA=
# ERC-8004 (written by `live-runner register-agent --write`)
ERC8004_AGENT_ID=
CIRCLE_WALLET_ID_ARC_VALIDATOR= / CIRCLE_WALLET_ADDR_ARC_VALIDATOR=

# RPC (testnet)
ARC_TESTNET_RPC_URL=https://rpc.testnet.arc.network

# App
NEXT_PUBLIC_API_URL=http://localhost:3001
NODE_ENV=development
```

Rule: when adding a new env variable, update `.env.example` and validate it with zod
in `packages/config`. The app must not start with a wrong env — fail fast.

---

## 9. PREVENT COMMON MISTAKES

**CCTP:**
- ❌ Using V1 contracts. ✅ V2 canonical.
- ❌ Confusing domain IDs with chain IDs. ✅ Domain IDs are Circle-specific, not
  hardcoded — get them from MCP.
- ❌ Waiting for attestation in one shot. ✅ Polling + timeout + retry.
- ❌ Ignoring the Fast Transfer fee. ✅ Include it in total cost in the routing engine.

**Arc:**
- ❌ Trying to hold ETH for gas. ✅ Gas is paid in USDC on Arc.
- ❌ Waiting for multi-block confirmation. ✅ Sub-second deterministic finality — one
  block is enough.
- ❌ Deploying to mainnet. ✅ Arc testnet only — no mainnet yet.

**Wallet:**
- ❌ Moving the user's seed phrase to the frontend. ✅ Developer-controlled wallets
  live in the backend.
- ❌ Embedding the Entity Secret in code. ✅ Env variable, rotated from the Circle
  dashboard.

**LLM:**
- ❌ Trusting the LLM to return free text. ✅ Structured output via tool use.
- ❌ Guessing on ambiguous intents. ✅ Ask a clarifying question (e.g. "How much USDC
  would you like to convert to EURC?").

**General:**
- ❌ Assuming USDC has 18 decimals. ✅ USDC is 6 decimals — `parseUnits(amount, 6)`.
- ❌ Assuming testnet faucets are full on demo day. ✅ Check balances every morning.

---

## 10. MILESTONES

Done in order; the next one doesn't start before the previous one is complete.
Past milestones: M0–M3 are done (monorepo+CI, wallets+CCTP, pricing+routing,
intent parser+UI).

| Milestone | Scope | Exit criterion |
|---|---|---|
| M4a ✅ | Executor core: state machine + burn → attestation → mint → swap | USDC→EURC on Arc end-to-end once (see ADR 0001) |
| M4b ✅ | Failure handling | Inject faults → recovery (`failure-handling.test.ts`) |
| M5 ✅ (API live-verified; record the browser run for the demo) | Frontend + proof screen | Hero flow in the browser |
| M5b ✅ | Stablecoin FX pivot + ERC-8004 identity (ADR 0002) | Arc-funded, bridged and reverse conversions live |
| M6 🔵 | Demo + pitch | 3-min video + pitch |

M4 design decisions: `docs/m4-design.md`. The M0–M9 files under `docs/milestones/`
belong to the old plan (LEGACY) — do not use them as reference.

---

## 11. CLAUDE CODE BEHAVIOR RULES

### Don't
- **Never skip a milestone.** Don't start M5 before M4 is done. There are dependencies.
- **Never ignore the skills.** Read the relevant skill before writing code in an area.
- **Don't spend time on things not declared production-grade.** "Beautiful animations"
  are not in the MVP scope — a working tx is worth more.
- **Don't guess without asking.** If there's ambiguity, ask the user.
- **Don't refactor existing working code** unless the user asks. No "while I'm at it,
  let me also tidy this up."

### Do
- **When in doubt, ask Circle MCP.** Contract addresses, SDK signatures, fees — all
  live data.
- **Take error messages seriously.** Don't wave them off as "probably a network issue."
  Read the stack trace, find the root cause.
- **Write tests.** Code that moves funds without tests is not code.
- **Don't pull the user toward Turkish or English** — mirror whichever they write.

---

## 12. DEMO GOAL

See `docs/demo-script.md`. In short: (1) the agent funds a conversion from
the cheapest chain and bridges it to Arc with CCTP V2, (2) the same request
funded straight from Arc when the funds are there, with the agent's ERC-8004
identity, (3) the failure paths (guarded retries, resume, funds-safe records).

---

## 13. REFERENCE DOCUMENTATION

These are the sources to consult. If unsure about a topic, look here first:

- **Circle Skills repo:** https://github.com/circlefin/skills
- **Circle Developer Docs (LLM index):** https://developers.circle.com/llms.txt
- **Circle MCP Server:** https://api.circle.com/v1/codegen/mcp
- **Arc Docs (LLM index):** https://docs.arc.io/llms.txt
- **Arc Network:** https://www.arc.network/
- **Arc Litepaper:** https://www.arc.network/litepaper
- **Arc MCP Server:** https://docs.arc.io/ai/mcp
- **Arc Testnet Explorer API:** https://testnet.arcscan.app/api-docs
- **USDC Contract Addresses:** https://developers.circle.com/stablecoins/usdc-contract-addresses
- **CCTP Supported Chains:** https://developers.circle.com/cctp/concepts/supported-chains-and-domains

---

**Final word:** This document is alive. When an architecture decision changes, reflect
it here. When you add a new rule, also write the "why." A future Claude (and human)
will read this.
