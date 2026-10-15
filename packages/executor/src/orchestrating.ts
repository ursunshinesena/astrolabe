import type { SupportedChainKey } from "@astrolabe/chains";
import {
  APPKIT_CHAIN,
  type AppKitChain,
  type BridgeResult,
  type SwapOnArcResult,
} from "@astrolabe/circle";
import type { RouteOption } from "@astrolabe/pricing";
import { type Result, ResultAsync, err, ok } from "neverthrow";
import { runBridge } from "./bridging.js";
import { ExecutorError } from "./errors.js";
import { type ExecutionRecord, applyTransition, createExecution } from "./execution.js";
import { saveExecution } from "./persistence.js";
import { runPreflight } from "./preflight.js";
import { runSwap } from "./swapping.js";

// SUPPORTED_CHAINS and APPKIT_CHAIN use different key names for the same
// chains (ETHEREUM_SEPOLIA vs ETH_SEPOLIA, ARBITRUM_SEPOLIA vs ARB_SEPOLIA),
// so an explicit table is required. Kept local deliberately; unifying chain
// naming across the two packages is tracked as separate debt.
const TO_APPKIT_CHAIN: Record<SupportedChainKey, AppKitChain> = {
  ETHEREUM_SEPOLIA: APPKIT_CHAIN.ETH_SEPOLIA,
  BASE_SEPOLIA: APPKIT_CHAIN.BASE_SEPOLIA,
  ARBITRUM_SEPOLIA: APPKIT_CHAIN.ARB_SEPOLIA,
  ARC_TESTNET: APPKIT_CHAIN.ARC_TESTNET,
};

export type RunExecutionParams = {
  route: RouteOption;
  walletId: string;
  /** Address holding USDC on route.sourceChain; runBridge bridges from here. */
  sourceAddress: string;
  /** Address on Arc that receives the bridged USDC; runSwap operates on it. */
  arcAddress: string;
  /** Passed through to saveExecution; defaults to process.cwd() there. */
  baseDir?: string;
};

export type RunExecutionDeps = {
  runPreflight: typeof runPreflight;
  runBridge: typeof runBridge;
  runSwap: typeof runSwap;
  saveExecution: typeof saveExecution;
};

export type RunExecutionResult = {
  record: ExecutionRecord;
  bridgeResult: BridgeResult;
  swapResult: SwapOnArcResult;
};

export function runExecution(
  params: RunExecutionParams,
  deps: RunExecutionDeps = { runPreflight, runBridge, runSwap, saveExecution },
): ResultAsync<RunExecutionResult, ExecutorError> {
  // executeRun never rejects: every awaited call returns a neverthrow Result,
  // so we construct ResultAsync directly from its Result-producing promise
  // rather than ResultAsync.fromPromise, which would double-wrap the Result.
  return new ResultAsync(executeRun(params, deps));
}

async function executeRun(
  params: RunExecutionParams,
  deps: RunExecutionDeps,
): Promise<Result<RunExecutionResult, ExecutorError>> {
  const { route } = params;

  if (route.strategy === "swap_only") {
    // Deliberately not rerouted through the bridge path: a swap_only route
    // has no bridge leg, and silently executing something the caller did not
    // quote would violate the dry-run contract.
    return err(
      new ExecutorError(
        "swap_only routes are not yet supported by the executor",
        "UNSUPPORTED_ROUTE",
      ),
    );
  }

  if (route.destinationChain !== "ARC_TESTNET") {
    // The swap leg is executed by swapOnArc, which only operates on Arc.
    // Bridging anywhere else would strand USDC on a chain where no swap
    // follows, so refuse before any funds move.
    return err(
      new ExecutorError(
        `Only ARC_TESTNET destinations are executable; got ${route.destinationChain}`,
        "UNSUPPORTED_ROUTE",
      ),
    );
  }

  const preflighted = applyTransition(createExecution(), "preflight");
  if (preflighted.isErr()) {
    return err(preflighted.error);
  }
  const initialSave = await deps.saveExecution(preflighted.value, params.baseDir);
  if (initialSave.isErr()) {
    // Persistence is broken before anything happened — abort rather than
    // start an execution we can't durably track.
    return err(initialSave.error);
  }
  const record = initialSave.value;

  const preflightOutcome = await deps.runPreflight({
    sourceChain: route.sourceChain,
    destinationChain: route.destinationChain,
    walletId: params.walletId,
    amountUsdc: route.swapQuote.amountIn,
  });
  if (preflightOutcome.isErr()) {
    return err(preflightOutcome.error);
  }
  const report = preflightOutcome.value;
  if (!report.passed) {
    // Nothing has been sent on-chain yet, so the record can honestly be
    // closed as failed_funds_safe before reporting the failed checks.
    const failed = applyTransition(record, "failed_funds_safe");
    if (failed.isErr()) {
      return err(failed.error);
    }
    const saved = await deps.saveExecution(failed.value, params.baseDir);
    if (saved.isErr()) {
      // Failing to durably record "funds are safe" is more urgent than the
      // triggering preflight failure — surface it so the caller knows local
      // state tracking is broken.
      return err(saved.error);
    }
    const failing = report.checks
      .filter((check) => !check.passed)
      .map((check) => `${check.name}: ${check.detail}`)
      .join("; ");
    return err(new ExecutorError(`Preflight failed: ${failing}`, "PREFLIGHT_FAILED"));
  }

  const bridged = await deps.runBridge({
    record,
    fromChain: TO_APPKIT_CHAIN[route.sourceChain],
    toChain: TO_APPKIT_CHAIN[route.destinationChain],
    fromAddress: params.sourceAddress,
    toAddress: params.arcAddress,
    amount: route.swapQuote.amountIn,
    baseDir: params.baseDir,
  });
  if (bridged.isErr()) {
    return err(bridged.error);
  }
  const { record: bridgedRecord, result: bridgeResult } = bridged.value;

  // runBridge left the record in "minting"; runSwap drives it through
  // minting -> swapping -> completed itself.
  const swapped = await deps.runSwap({
    record: bridgedRecord,
    fromAddress: params.arcAddress,
    tokenIn: route.swapQuote.tokenIn,
    tokenOut: route.swapQuote.tokenOut,
    amountIn: route.swapQuote.amountIn,
    // Preflight's config check guarantees these are set before any on-chain
    // call; the fallback only satisfies the type.
    apiKey: process.env.CIRCLE_API_KEY ?? "",
    entitySecret: process.env.CIRCLE_ENTITY_SECRET ?? "",
    slippageBps: route.expectedSlippageBps,
    baseDir: params.baseDir,
  });
  if (swapped.isErr()) {
    // The bridge already completed on-chain — its tx hashes are evidence
    // that must never be lost, so append them to whatever the swap phase
    // reported before passing the error through.
    return err(withBridgeEvidence(swapped.error, bridgeResult));
  }

  return ok({
    record: swapped.value.record,
    bridgeResult,
    swapResult: swapped.value.result,
  });
}

function withBridgeEvidence(error: ExecutorError, bridgeResult: BridgeResult): ExecutorError {
  const hashes = bridgeResult.steps
    .filter((step) => step.txHash)
    .map((step) => `${step.name} ${step.txHash}`)
    .join(", ");
  if (!hashes) {
    return error;
  }
  return new ExecutorError(
    `${error.message} (bridge completed on-chain: ${hashes})`,
    error.code,
    error.cause,
    error.failedStep,
  );
}
