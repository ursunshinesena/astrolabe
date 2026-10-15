# Demo Script (3 minutes)

Three scenarios, all in the web app (`pnpm dev`, http://localhost:3000).
Before recording: `pnpm build && pnpm --filter @astrolabe/live-runner live check` — the
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

| Date | Path | Amount | Execution id | Duration |
|---|---|---|---|---|
| 2026-10-15 | live runner | 2.1 USDC bridged → 2 USDC swapped → 2.528494 EURC | `exec_2026-10-15T23-15-00-752Z_f2b35b` | < 60 s |
| 2026-10-15 | API (web flow) | 1.1 USDC bridged → 1 USDC swapped → ~1.21 EURC | `exec_2026-10-15T23-18-25-248Z_1da35c` | 40 s |

Run 1 transactions (all confirmed, status 1):
- approve — [0xbe4cd660…304d](https://sepolia.etherscan.io/tx/0xbe4cd6606c586ba49f3aa38881fd123540069d0d55c57130e4e9b17cd9d8304d)
- burn — [0xaf0d72e5…8fbe](https://sepolia.etherscan.io/tx/0xaf0d72e5a59bd3002bf90adc6ecf4adf4e817eeaff0a2f262ac51674808f8fbe)
- mint — [0xaab4f27a…c5af7](https://testnet.arcscan.app/tx/0xaab4f27af0dbddfa5e5a9a1cbd28b7dc5002589c5bb196f50ed7d82692cc5af7)
- swap — [0xd8456c9e…956c](https://testnet.arcscan.app/tx/0xd8456c9e5a4f8c15bffaa248f62bee531076bc03670391fe2a8fdfabe3fb956c)

Run 2 transactions:
- approve — [0xed85959a…1b82](https://sepolia.etherscan.io/tx/0xed85959a851c2d07fa6d17f03b9fef456329e0ec462b43d9d0b1c1088c561b82)
- burn — [0x89bed4bb…7630](https://sepolia.etherscan.io/tx/0x89bed4bb406af192c2dea915ed44497003f745a6f4fbfe9864f1812aad297630)
- mint — [0x3bfe3286…db5a](https://testnet.arcscan.app/tx/0x3bfe3286394a097002d577d1c600eeab549908915d6bafee3ff7c738040adb5a)
- swap — [0x19b0c177…4c58](https://testnet.arcscan.app/tx/0x19b0c1777a4700aa34ce9f76ccf9687ea6a9967333c2d501009a224d84244c58)
