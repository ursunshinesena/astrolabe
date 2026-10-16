# ADR 0002 — Astrolabe is a stablecoin FX agent with Arc as its hub

Date: 2026-10-16 · Status: Accepted · Supersedes the routing part of ADR 0001

## Context

The original pitch was "buy the best ETH across four chains". After ADR 0001
the only executable path already ended in EURC on Arc, while ETH was quoted
from Uniswap V3 pools on the Sepolia testnets. Those quotes were noise —
10 USDC bought 0.0119 WETH on Arbitrum Sepolia and 0.0021 on Base Sepolia
in the same minute — because testnet pools have no arbitrage. Arc itself
positions as stablecoin-native: its docs feature stablecoin FX (USDC/EURC),
payments and an agentic economy (ERC-8004/8183), and Arc Testnet swaps only
USDC, EURC and cirBTC.

## Decision

- Astrolabe converts **USDC ↔ EURC**, always settling the swap on **Arc**.
- The routing decision is **where to fund the conversion from**: funds
  already on Arc (no bridge, no fee) or the cheapest chain that holds enough
  USDC and native gas, bridged with CCTP V2 at the live App Kit fee.
- Uniswap quoting, its ABI and addresses are removed. The intent parser
  accepts USDC and EURC only and explains why other assets are refused.
- The agent has an **ERC-8004 identity** on Arc; each completed conversion is
  rated in the ReputationRegistry by a separate validator wallet, pointing
  at the swap transaction.

## Consequences

- Every number the product shows is real on testnet: balances, live CCTP
  fees, the App Kit rate on Arc.
- The multi-chain story is about liquidity location, which is what Arc's
  hub model and Circle's CCTP are for.
- EURC is only spent from Arc for now (the bridge wrapper moves USDC);
  bridging EURC with CCTP is a natural extension.
- ETH or other assets come back only if Arc lists them for swaps.
