# ADR 0001 — Execute the swap leg on Arc; EURC is the testnet target

Date: 2026-10-16 · Status: Accepted; routing superseded by ADR 0002

## Context

The M4 design picked Base Sepolia as the destination and USDC → ETH as the
hero swap. The executor that was built (M4a) swaps through Circle App Kit
on Arc instead, because Arc pays gas in USDC: the agent never has to hold
or top up ETH on the destination chain.

Checking Circle Swap Kit 1.2 showed that on Arc Testnet only USDC, EURC
and cirBTC are swappable — there is no WETH/ETH. A Base Sepolia swap
through Uniswap would need ETH for gas in the Circle wallet and a second
execution path (contract calls through the wallets API).

## Decision

- The executable route is **USDC on Ethereum Sepolia → CCTP V2 → Arc →
  swap on Arc**. On testnet the swap target is **EURC**.
- ETH/WETH remain fully quoted on Ethereum, Base and Arbitrum Sepolia so
  the agent still compares four chains; those routes are labelled
  "quote only" in the API and UI.
- The executor rejects any route whose destination is not Arc
  (`UNSUPPORTED_ROUTE`) before funds move.

## Consequences

- One hardened execution path, no separate gas token anywhere.
- The demo's "buy ETH" scenarios become "compare ETH prices across
  chains" plus a real EURC execution on Arc. When Arc lists WETH (or on
  mainnet), only the token allowlists change.
- Adding a Uniswap execution path later is additive: a new swap step for
  non-Arc destinations behind the same state machine.
