# M4 Design — Guarded Executor

Status: Approved design, pre-implementation
Scope: Cross-chain execution of a parsed intent (USDC -> ETH hero flow)

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

## Open questions for M4a

- Which source and destination chains for the hero flow?
- Where is execution state persisted (in-memory, file, or database)?

## Out of scope for M4

- Frontend / proof screen (M5)
- Webhook-based attestation
- Custom on-chain contracts (possible future work)
