# M4 Design — Guarded Executor

Status: Approved design, pre-implementation
Scope: Cross-chain execution of a parsed intent
(USDC -> ETH hero flow, Ethereum Sepolia -> Base Sepolia)

## Decisions

### 1. Execution model: Orchestrated (no custom smart contract)
The backend executor manages each step sequentially:
burn -> wait for attestation -> mint -> swap.
No custom on-chain contract is written or deployed.
Rationale: no contract = no audit surface, less risk, faster to ship.
`IHook.sol` remains in the repo as a reference interface for a possible
future on-chain path (mainnet), but is unused in M4.

### 2. Wallet: Circle developer-controlled wallets
Already set up in M1. Frictionless for demo purposes — no user
signature prompts during execution.

### 3. Attestation: polling with a timeout
Poll Circle's attestation service every 5 seconds until ready.
If the attestation is not available after 30 minutes, stop polling
and leave the execution in the `pending` state (see failure handling).
Webhooks were rejected for MVP: they require a publicly reachable
backend URL and add failure points. Polling is simple, predictable,
and officially supported.

### 4. Hero flow route: Ethereum Sepolia -> Base Sepolia
Source: Ethereum Sepolia (mature testnet, abundant faucets, proven
CCTP path from M1). Destination: Base Sepolia (best testnet DEX
availability for the USDC -> ETH swap).
The first technical step of M4a is verifying a working USDC -> ETH
swap path on Base Sepolia. Fallback destination: Arbitrum Sepolia.
The other chains remain in scope for price quoting (M2); execution
is a single hardened route.

### 5. State persistence: JSON file
Each execution is persisted to a JSON file on disk, updated on every
state transition. Survives backend restarts, requires zero setup,
and is human-readable for debugging. A production system would need
a database; a file is sufficient for M4 scope.

## Execution state machine

Every execution is tracked through explicit states. Funds are never
"invisible": each execution has a known state at all times.

Happy path states:

created -> preflight_ok -> burned -> attested -> minted -> completed

Additional states:

- `pending` — attestation not yet available after polling timeout;
  execution is persisted and can be resumed later.
- `swap_retrying` — mint succeeded, swap failed, retries in progress.
- `failed_funds_safe` — retries exhausted; USDC left safely on the
  destination chain, user notified.
- `failed_preflight` — pre-flight checks failed; no funds moved.

## Happy path

1. **Pre-flight** — check balances, validate slippage limits.
   Fail fast before any funds move. On failure: `failed_preflight`.
2. **Burn** — burn USDC on the source chain via CCTP V2.
3. **Attestation** — poll every 5s, 30-minute timeout.
4. **Mint** — mint USDC on the destination chain.
5. **Swap** — swap USDC to ETH on the destination chain.

## Failure handling

### Attestation delay
On polling timeout the execution is persisted as `pending` and the
backend does not block. It can be resumed when the attestation
becomes available.

### Mint succeeded, swap failed
Retry the swap up to 3 times with increasing waits (5s, 15s, 45s) —
most swap failures are transient. If retries are exhausted, move to
`failed_funds_safe`: leave the USDC on the destination chain and
notify the user. A cross-chain refund was rejected: it would create
a new cross-chain transaction and therefore new risk.
"Deterministic refund path" means the user always knows where the
funds are and can access them — not that funds are always sent back.

## Definition of done (M4)

One USDC -> ETH execution completed end-to-end on testnet,
passing through every happy-path state.

## Out of scope for M4

- Frontend / proof screen (M5)
- Webhook-based attestation
- Custom on-chain contracts (possible future work)

## Route verification (2026-07-05)

Verified on Base Sepolia via read-only `cast` calls (factory `getPool`, pool `liquidity()`, QuoterV2 `quoteExactInputSingle`):

- USDC/WETH pools exist at all three fee tiers (500 / 3000 / 10000).
- **Selected tier: 3000 (0.3%)** — pool `0x46880b404CD35c165EDdefF7421019F8dD25F4Ad`, deepest active liquidity (~1.1e14) and stable quotes.
- Quote proof: 1 USDC → ~0.00184 WETH (non-zero, no revert, ~90k gas estimate).
- Testnet prices deviate from market (expected; no arbitrage incentive). The 500 tier shows heavy price skew consistent with shallow liquidity — avoid.
- Conclusion: **Ethereum Sepolia → Base Sepolia route confirmed.** Fallback (Arbitrum Sepolia) not needed. Executor will use QuoterV2 for pre-swap price checks.

## M4b — failure handling as implemented (2026-10)

### Swap retries are balance-guarded
A thrown `kit.swap` error cannot tell "never sent" from "sent, response
lost", so a blind retry could swap twice. Before each retry the executor
re-reads the Arc wallet's input-token balance and compares it with a
snapshot taken just before the first attempt. Only if less than half of
`amountIn` has left the wallet (a real swap spends all of it; a reverted
one only USDC gas) is the swap retried, after 5s / 15s / 45s.

- Retries exhausted → `failed_funds_safe`, `error` names the attempts and
  the Arc address holding the USDC.
- Balance cannot be read, or has dropped → `SWAP_UNCERTAIN`: the record
  stays in `swapping` with the reason written down. It is never marked
  funds-safe on a claim we cannot back.

### Evidence and plan are persisted
`ExecutionRecord` now carries `plan` (Arc address and wallet id, tokens,
amount, slippage) from the start, and `evidence` (every tx hash with its
step) as soon as the bridge finishes and when the swap completes.

### Resume (`resumeExecution`, `live-runner resume <id>`)
| Persisted state | Action |
|---|---|
| `completed`, `failed_funds_safe` | nothing |
| `created`, `preflight` | no funds moved → closed as `failed_funds_safe` |
| `burning`, `awaiting_attestation` | `RESUME_UNSUPPORTED` — App Kit cannot pick up a CCTP transfer halfway; the recorded burn tx is the starting point |
| `minting` | if `amountIn` is visible on Arc, run the guarded swap; otherwise `RESUME_UNSUPPORTED` |
| `swapping` | `RESUME_UNSUPPORTED` — an earlier attempt may have executed |

### Destination guard
Routes whose destination is not `ARC_TESTNET` are rejected with
`UNSUPPORTED_ROUTE` before anything is persisted, because the swap leg
always runs on Arc.

### Testnet token reality
Circle Swap Kit only lists USDC, EURC and cirBTC on Arc Testnet (no
WETH/ETH), so the executable hero flow is **USDC (Ethereum Sepolia) →
CCTP V2 → Arc → swap to EURC**. ETH prices on the Uniswap chains remain
quote-only for comparison.

## Live verification (2026-10-15)

M4a's exit criterion is met. Two runs on testnet, both passing through
every happy-path state (`preflight → burning → awaiting_attestation →
minting → swapping → completed`) in under a minute; hashes are in
`docs/demo-script.md`.

Found and fixed on the way:
- App Kit 1.5 required a legacy *kit key* for swaps, which Circle no longer
  issues. Upgraded to App Kit 1.17, which accepts the Circle API key.
- Bridging exactly the swap amount leaves too little on Arc (bridge and
  forwarder fees ≈ 0.022 USDC come out of the transfer; swap gas is USDC).
  The executor now bridges `amountIn + bridge fee + 0.05 USDC` gas reserve.

## Attestation timeout and live fees (2026-10-16)

- `runBridge` stops waiting 300s after the burn (`ATTESTATION_TIMEOUT`,
  CLAUDE.md §6.8). The record stays in `awaiting_attestation` with the reason
  written down — the USDC is in flight, so it is never marked funds-safe. A
  late attestation is still persisted, with a note.
- Quotes and the live runner use Circle's live bridge fee estimate
  (`estimateBridgeFee`: CCTP provider + forwarder fee, ≈0.022 USDC to Arc)
  instead of the fixed 0.05 placeholder, falling back to it if the estimate
  fails.
