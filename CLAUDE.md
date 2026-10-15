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
| Routing/swap engine | App Kit docs (`docs.arc.network/app-kit`) |

**Rule:** Do not write code in an area without reading its skill. Skills contain
architecture decisions, common mistakes, and correct patterns.

### 1.4 Use MCP for live data

The information below **may be stale** — contract addresses, SDK signatures, chain IDs,
CCTP domain IDs, fee structures. When you need them, **ask the Circle MCP server**;
do not use hardcoded values.

---

## 2. PROJECT SUMMARY

**Product:** Cross-Market Execution Agent. The user types a natural-language intent
("buy the best ETH with 100 USDC"). The agent:

1. Parses the intent into a structured action via LLM
2. Queries price, gas, and CCTP fees across multiple chains in parallel
3. Selects the optimal route (swap on source chain vs. bridge+swap on another chain)
4. Gets user approval (dry-run preview)
5. Executes with guarded execution: burn → attestation → mint → swap. Every step is
   persisted in a state machine; if the swap fails it retries (3 attempts), and if it
   still fails, USDC is left safe on the destination chain.

**Category:** Cross-Market Execution Systems.
**Pitch:** "One intent. Four chains. Guarded execution with deterministic refund paths."

### Why this idea wins
- **CCTP V2** is at the core of the product — the sponsor's flagship feature
- We don't merely "support" **Arc**; we exploit its USDC-as-gas advantage for the agent
  (no separate gas-token balance to manage)
- We put an intelligent routing layer on top of **App Kit** — we don't rebuild bridging
  from scratch, we use existing infrastructure cleverly
- Optional: **ERC-8004** agent identity gives the agent on-chain reputation

---

## 3. TECHNOLOGY STACK — IMMUTABLE

| Layer | Choice | Why |
|---|---|---|
| Monorepo | Turborepo + pnpm | Fast builds, parallel tasks |
| Smart contracts | Foundry (Solidity 0.8.24+) | Testing and fork support |
| Backend | Hono (Node 20+, TypeScript strict) | Fast, edge-ready |
| Frontend | Next.js 15 (App Router) + Tailwind + shadcn/ui | Fast development, modern UX |
| LLM | Gemini Flash (Google AI Studio) | Tool use + structured output |
| Wallet | Circle Programmable Wallets (developer-controlled) | UX score, sponsor integration |
| Cross-chain | **CCTP V2** (Bridge Kit SDK) + Arc App Kit | Use V2 — V1 phase-out July 31, 2026 |
| DEX aggregation | Uniswap V3 QuoterV2 + Arc App Kit `estimateSwap` | Real quotes on testnet, no 0x |
| Validation | zod | Runtime schema |
| Linting | biome | One tool, fast |
| Hosting | Vercel (web) + Railway (api) | Sufficient for the MVP |

### Supported chains (testnet)

**Ask Circle MCP for current domain IDs and contract addresses. The table below can
go stale; MCP has the final word.**

| Chain | Notes |
|---|---|
| Ethereum Sepolia | Primary reference chain |
| Base Sepolia | L2, demos CCTP Fast |
| Arbitrum Sepolia | CCTP V2 + Uniswap V3 deploy, replaced Fuji |
| **Arc Testnet** | USDC-as-gas, sub-second finality, agentic economy primitives |

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
│   ├── agent/           # Routing engine
│   ├── chains/          # Chain configs, RPC clients, types
│   ├── circle/          # Circle SDK wrappers (Wallets, CCTP, App Kit)
│   ├── executor/        # Guarded execution state machine
│   ├── contracts/       # LEGACY — Foundry Hook project, not part of the current execution path
│   ├── intent-parser/   # LLM intent parser (Gemini 2.5 Flash)
│   ├── pricing/         # DEX quoter wrappers (Uniswap V3 QuoterV2 + Arc App Kit)
│   └── types/           # Shared TS types (Intent, Route, ExecutionResult)
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
- `apps/web` → `packages/agent`, `packages/types`, `packages/chains`, `packages/circle`
- `apps/api` → `packages/agent`, `packages/types`, `packages/chains`, `packages/circle`, `packages/pricing`
- `packages/agent` → `packages/types`, `packages/chains`, `packages/pricing`
- NO circular dependencies between `packages/*`

---

## 5. CODE STANDARDS

### TypeScript
- `strict: true`, `noUncheckedIndexedAccess: true`
- `any` is forbidden. Use `unknown` + narrowing.
- zod schemas for public APIs. Types are derived from schemas via `z.infer<>`.
- Use the `Result<T, E>` pattern (neverthrow) in async functions. Try/catch only at
  outer boundaries.

### Solidity
- Foundry. `forge fmt` and `forge test` are mandatory in CI.
- NatSpec comments on every external/public function.
- Slither static analysis in CI.
- Reentrancy guard on every external state-changing function.
- Custom errors (no revert strings).

### Frontend
- Server components by default. Client components only where interactivity is required.
- Don't override shadcn/ui components — add variants.
- Colors are defined as tokens in `tailwind.config`; hardcoded hex is FORBIDDEN.

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
- Fuzz tests for smart contracts (Foundry `invariant` or `fuzz`).
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

# RPC (testnet)
ETH_SEPOLIA_RPC_URL=
BASE_SEPOLIA_RPC_URL=
ARB_SEPOLIA_RPC_URL=
ARC_TESTNET_RPC_URL=https://rpc.testnet.arc.network

# Deployment
PRIVATE_KEY_DEPLOYER=   # testnet ONLY
ETHERSCAN_API_KEY=

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
- ❌ Guessing on ambiguous intents. ✅ Ask a clarifying question (e.g. "By ETH do you
  mean mainnet ETH, or WETH on Base?").

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
| M4a ✅ code / ⏳ live run | Executor core: state machine + burn → attestation → mint → swap | USDC→EURC on Arc end-to-end once (see ADR 0001) |
| M4b ✅ | Failure handling | Inject faults → recovery (`failure-handling.test.ts`) |
| M5 ✅ code / ⏳ live run | Frontend + proof screen | Hero flow in the browser |
| M6 | Demo + pitch | 3-min video + pitch |

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

See `docs/demo-script.md`. In short: (1) compare ETH quotes across four
chains, (2) the hero flow — USDC on Ethereum Sepolia → CCTP V2 → Arc →
EURC, tracked step by step in the UI with every tx hash on an explorer,
(3) the failure paths (guarded retries, resume, funds-safe records).

---

## 13. REFERENCE DOCUMENTATION

These are the sources to consult. If unsure about a topic, look here first:

- **Circle Skills repo:** https://github.com/circlefin/skills
- **Circle Developer Docs (LLM index):** https://developers.circle.com/llms.txt
- **Circle MCP Server:** https://api.circle.com/v1/codegen/mcp
- **Arc Docs (LLM index):** https://docs.arc.network/llms.txt
- **Arc Network:** https://www.arc.network/
- **Arc Litepaper:** https://www.arc.network/litepaper
- **Arc MCP Server:** https://docs.arc.network/ai/mcp
- **Arc Testnet Explorer API:** https://testnet.arcscan.app/api-docs
- **USDC Contract Addresses:** https://developers.circle.com/stablecoins/usdc-contract-addresses
- **CCTP Supported Chains:** https://developers.circle.com/cctp/concepts/supported-chains-and-domains

---

**Final word:** This document is alive. When an architecture decision changes, reflect
it here. When you add a new rule, also write the "why." A future Claude (and human)
will read this.
