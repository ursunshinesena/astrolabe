# Demo Script

Three scenarios for hackathon submission. Each must show end-to-end flow with real testnet tx hashes.

## Scenario 1 — Single-chain swap (baseline)

**Prompt:** "Base Sepolia'da 100 USDC'yi ETH'e çevir"

Expected flow:
1. Agent parses: action=swap, source=Base Sepolia, input=USDC, output=ETH, amount=100
2. 0x API quote fetched for Base Sepolia
3. Dry-run preview shown: estimated ETH out, gas cost
4. User approves
5. Circle developer-controlled wallet executes swap
6. UI shows tx hash + Base Sepolia explorer link

## Scenario 2 — Cross-chain bridge + swap (CCTP V2)

**Prompt:** "Ethereum Sepolia'da USDC'm var, en iyi ETH fiyatı için Base'e gönder ve oradan ETH al"

Expected flow:
1. Agent parses: action=bridge_and_swap, src=Eth Sepolia, dst=Base Sepolia
2. Route: bridge USDC (CCTP V2 Fast) → swap USDC→ETH on Base
3. Dry-run preview: bridge fee + swap quote + total cost, estimated 8-20s
4. User approves
5. App Kit `kit.bridge({ useForwarder: true })` — approve, burn, attestation, mint happen
6. SwapHook executes atomically on mint
7. UI shows all 4 CCTP step tx hashes + final ETH balance

## Scenario 3 — Multi-chain optimal routing (4 chains)

**Prompt:** "1000 USDC ile en iyi ETH pozisyonu"

Expected flow:
1. Agent queries all 4 chains in parallel: Eth Sepolia, Avax Fuji, Base Sepolia, Arc Testnet
2. Comparison table shown: price per ETH, total cost (gas + bridge fee), ETA per chain
3. Agent selects optimal route with justification
4. User approves
5. Execution with real-time step tracking in UI
6. Final: ETH received, total cost breakdown, tx hashes
