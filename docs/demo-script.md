# Demo Script

Three scenarios for the demo video. Each must show an end-to-end flow with real
testnet tx hashes.

## Scenario 1 — Single-chain swap (baseline)

**Prompt:** "Convert 100 USDC to ETH on Base Sepolia"

Expected flow:
1. Agent parses: action=swap, source=Base Sepolia, input=USDC, output=ETH, amount=100
2. Uniswap V3 QuoterV2 quote fetched for Base Sepolia (0.3% pool)
3. Dry-run preview shown: estimated ETH out, gas cost
4. User approves
5. Circle developer-controlled wallet executes swap
6. UI shows tx hash + Base Sepolia explorer link

## Scenario 2 — Cross-chain bridge + swap (CCTP V2)

**Prompt:** "I have USDC on Ethereum Sepolia; send it to Base for the best ETH price
and buy ETH there"

Expected flow:
1. Agent parses: action=bridge_and_swap, src=Eth Sepolia, dst=Base Sepolia
2. Route: bridge USDC (CCTP V2 Fast) → swap USDC→ETH on Base
3. Dry-run preview: bridge fee + swap quote + total cost, estimated 8–20s
4. User approves
5. Executor runs the guarded state machine: burn → attestation (polling) → mint,
   every state transition persisted
6. Swap executes as a separate step; on failure it retries (3 attempts), and if it
   still fails, USDC stays safe on Base (failed_funds_safe)
7. UI shows tx hashes for every step + final ETH balance

## Scenario 3 — Multi-chain optimal routing (4 chains)

**Prompt:** "Best ETH position with 1000 USDC"

Expected flow:
1. Agent queries all 4 chains in parallel: Eth Sepolia, Base Sepolia, Arbitrum
   Sepolia, Arc Testnet
2. Comparison table shown: price per ETH, total cost (gas + bridge fee), ETA per chain
3. Agent selects optimal route with justification
4. User approves
5. Execution with real-time step tracking in UI
6. Final: ETH received, total cost breakdown, tx hashes
