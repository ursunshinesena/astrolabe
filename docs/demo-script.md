# Demo Script (3 minutes)

Everything runs in the web app (`pnpm build && pnpm dev`, http://localhost:3000).
Before recording: `pnpm --filter @astrolabe/live-runner live check`. The
Ethereum Sepolia wallet needs USDC and a little Sepolia ETH; keep a small
USDC balance (≈1 USDC) on Arc so scenario 2 shows the agent choosing Arc.

## Scenario 1 — The agent decides where to fund it (0:00–1:15)

**Prompt:** "Turn 2 USDC into euros"

1. Intent line: convert 2 USDC → EURC on Arc. Rate line from Arc App Kit.
2. "Where to fund it from" table: Arc (needs 2.05, has ~1), **Ethereum
   Sepolia ★** with its live CCTP fee, Base Sepolia (not enough / no gas),
   Arbitrum Sepolia (empty). Every row says why.
3. Dry-run box → **Approve & execute**.
4. Tracker: pre-flight → burn on Sepolia → attestation → mint on Arc →
   swap on Arc. Each tx links to its explorer. ≈45 s end to end.
5. Receipt: all hashes; open the swap on testnet.arcscan.app.

**Talking point:** the decision is about where the liquidity is; Arc is
where the FX happens and gas is USDC.

## Scenario 2 — Same request, different answer (1:15–2:00)

**Prompt:** "Turn 1 USDC into euros"

1. Now Arc has enough: **Arc Testnet ★, fee none**, Ethereum Sepolia
   second with its CCTP fee.
2. Approve: tracker shows only pre-flight → swap. Done in seconds.
3. Receipt line: "Funded from Arc Testnet — no bridge needed".
4. Point at the header badge: **Agent #897344 · ERC-8004 identity on Arc**
   — each completed conversion is rated on-chain, pointing at its swap.

## Scenario 3 — Failure is a first-class path (2:00–3:00)

1. "Buy ETH with 10 USDC" → a clear refusal: Astrolabe converts USDC ↔ EURC
   on Arc. No fake routes.
2. Terminal: `pnpm --filter @astrolabe/executor test -- failure-handling`
   — transient swap failures retried, unknown outcomes stopped, interrupted
   runs resumed, a post-burn bridge failure finished with `retryBridge`.
3. Close: a swap is retried only when a balance check proves the last
   attempt didn't happen; otherwise the record says exactly where the money is.

## Live run log

All transactions confirmed (receipt status 1).

### Stablecoin FX routing (2026-10-16)

| Run | Funded from | Conversion | Execution id |
|---|---|---|---|
| A | Arc (no bridge) | 1 EURC → 1.214694 USDC | `exec_2026-10-16T00-21-28-363Z_f2c774` |
| B | Arc, chosen over Ethereum Sepolia | 1 USDC → 1.292256 EURC | `exec_2026-10-16T00-21-45-481Z_fdd4dc` |
| C | Ethereum Sepolia via API, CCTP V2 | 2 USDC → EURC (2.071872 bridged), ≈45 s | API run |
| D | Arc, rated on ERC-8004 | 0.5 EURC → 0.60735 USDC | `exec_2026-10-16T00-30-23-366Z_80846c` |

- A swap — [0x3608a739…413f](https://testnet.arcscan.app/tx/0x3608a739cc3e36fdd0a888515111e55577e67f13d06992ed9d92c0775f7b413f)
- B swap — [0x54cdf7e6…5577](https://testnet.arcscan.app/tx/0x54cdf7e66493365990a9fa8c4332d772e4939b45eda6b51331c2d2fa34b95577)
- C approve — [0xdb8c069e…5ac8](https://sepolia.etherscan.io/tx/0xdb8c069e11771ee4f846b5330cf9b87ad0c67678e6f42093be1fda270fc65ac8)
- C burn — [0x9abf10ca…7c03](https://sepolia.etherscan.io/tx/0x9abf10cab54989dbb8a3b2c15d3840c51ce8e815b750101bfdb59bc1652b7c03)
- C mint — [0x7bde0ea6…d253](https://testnet.arcscan.app/tx/0x7bde0ea6c9b65fa2d03af23a2645a0c0e024b4f44557d77bf834f5adbadbd253)
- C swap — [0xbd04b6b0…007d](https://testnet.arcscan.app/tx/0xbd04b6b07c92f016f0b7a739fddb653850c82dcb582f866a017307af201a007d)
- D swap — [0x2d244272…20f5](https://testnet.arcscan.app/tx/0x2d244272dabd209108e2261c41922fb44bc7dbee08727b53f5f0a2b08c4720f5)
- D reputation — [0x0e97c0c8…e425](https://testnet.arcscan.app/tx/0x0e97c0c812047900793584f2ebed722da33196175affbf0a6beb66d1f626e425)
- Agent #897344 registered — [0x18d4d619…7019](https://testnet.arcscan.app/tx/0x18d4d6194364d85c6a6fb08be3e8ca839f97ee7110acc1e19722fce71ed67019)

### First executor runs (2026-10-15, Ethereum Sepolia → Arc)

| Run | Conversion | Execution id |
|---|---|---|
| 1 | 2 USDC → 2.528494 EURC (2.1 bridged) | `exec_2026-10-15T23-15-00-752Z_f2b35b` |
| 2 | 1 USDC → ~1.21 EURC via API (1.1 bridged) | `exec_2026-10-15T23-18-25-248Z_1da35c` |
| 3 | 1 USDC → 1.27596 EURC, live fee 0.019546 | `exec_2026-10-15T23-47-29-056Z_4fdbbe` |

- Run 1 burn — [0xaf0d72e5…8fbe](https://sepolia.etherscan.io/tx/0xaf0d72e5a59bd3002bf90adc6ecf4adf4e817eeaff0a2f262ac51674808f8fbe), mint — [0xaab4f27a…5af7](https://testnet.arcscan.app/tx/0xaab4f27af0dbddfa5e5a9a1cbd28b7dc5002589c5bb196f50ed7d82692cc5af7), swap — [0xd8456c9e…956c](https://testnet.arcscan.app/tx/0xd8456c9e5a4f8c15bffaa248f62bee531076bc03670391fe2a8fdfabe3fb956c)
- Run 2 swap — [0x19b0c177…4c58](https://testnet.arcscan.app/tx/0x19b0c1777a4700aa34ce9f76ccf9687ea6a9967333c2d501009a224d84244c58)
- Run 3 swap — [0x597015ae…9736](https://testnet.arcscan.app/tx/0x597015ae335abb21c56265306f1077c7b4d0eec9569db5fa77719bd771a59736)
