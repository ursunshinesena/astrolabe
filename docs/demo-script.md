# Demo Script (3 minutes)

Three scenarios, all in the web app (`pnpm dev`, http://localhost:3000).
Before recording: `pnpm --filter @astrolabe/live-runner live check` — the
Ethereum Sepolia wallet needs USDC (faucet.circle.com) and a little
Sepolia ETH for the approve/burn gas. Arc needs nothing: gas is USDC.

## Scenario 1 — Compare four chains (0:00–0:45)

**Prompt:** "Best ETH position with 10 USDC"

1. Intent card: spend 10 USDC for ETH, funds on Ethereum Sepolia.
2. Route table: Uniswap V3 quotes from Ethereum, Base and Arbitrum
   Sepolia side by side, bridge fee included in "net out".
3. Point out the honest labels: on testnet these are quote-only (Arc has
   no WETH yet — ADR 0001). Nothing executes without a real path.

**Talking point:** the router prices every chain in parallel and never
hides a failed quote.

## Scenario 2 — Cross-chain guarded execution (0:45–2:15) — the hero

**Prompt:** "Turn 5 USDC into euros on the best route"

1. Route: Ethereum Sepolia → CCTP V2 → Arc, swap USDC → EURC.
   Reasoning line: gas on Arc is paid in USDC, no second gas token.
2. Dry-run box: "Nothing has been sent." Click **Approve & execute**.
3. Tracker walks the state machine live: pre-flight → burn (Sepolia tx
   link) → attestation → mint (Arc tx link) → swap (Arc tx link).
4. Receipt: every tx hash, each opening on its explorer. Open the swap on
   testnet.arcscan.app on camera.

**Talking point:** every state is persisted before the next step starts;
`.astrolabe/executions/<id>.json` is the receipt on disk.

## Scenario 3 — Failure is a first-class path (2:15–3:00)

Show, don't break mainnet-style:

1. In the terminal: `pnpm --filter @astrolabe/executor test -- failure-handling`
   — transient swap failures retried, an unknown outcome stopped without a
   retry, interruption at every state.
2. `live status <id>` on a record: plan, history and evidence.
3. Close on the rule: a swap is retried only when a balance check proves
   the failed attempt did not execute. Otherwise the USDC stays on Arc and
   the record says exactly where.

## Live run log

Fill in after each recorded run.

| Date | Execution id | burn | mint | swap |
|---|---|---|---|---|
| | | | | |
