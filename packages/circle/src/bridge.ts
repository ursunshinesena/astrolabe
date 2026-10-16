import { createCircleWalletsAdapter } from "@circle-fin/adapter-circle-wallets";
import { AppKit } from "@circle-fin/app-kit";
import { type Result, err, ok } from "neverthrow";

// App Kit chain name strings — NOT numeric chain IDs
// Source: bridge-stablecoin skill
export const APPKIT_CHAIN = {
  ETH_SEPOLIA: "Ethereum_Sepolia",
  BASE_SEPOLIA: "Base_Sepolia",
  ARB_SEPOLIA: "Arbitrum_Sepolia",
  ARC_TESTNET: "Arc_Testnet",
} as const;

export type AppKitChain = (typeof APPKIT_CHAIN)[keyof typeof APPKIT_CHAIN];

export type BridgeStep = {
  name: string;
  state: string;
  txHash?: string;
  error?: string;
};

export type BridgeResult = {
  state: string;
  amount: string;
  steps: BridgeStep[];
  /** App Kit's own result, JSON-safe; what App Kit retryBridge needs to resume. */
  raw?: unknown;
};

/** A bridge that App Kit reported as failed, carrying its result for retryBridge. */
export class BridgeFailure extends Error {
  constructor(
    message: string,
    public readonly raw: unknown,
  ) {
    super(message);
    this.name = "BridgeFailure";
  }
}

/** Deep copy with bigints as strings, so the result can be persisted as JSON. */
export function toJsonSafe(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? v.toString() : v)));
}

function mapResult(result: unknown, fallbackAmount: string): BridgeResult {
  const rawSteps = getField<unknown[]>(result, "steps") ?? [];
  return {
    state: getField<string>(result, "state") ?? "unknown",
    amount: getField<string>(result, "amount") ?? fallbackAmount,
    steps: rawSteps.map((s) => {
      const step = s as Record<string, unknown>;
      return {
        name: getField<string>(step, "name") ?? "unknown",
        state: getField<string>(step, "state") ?? "unknown",
        txHash: getField<string>(step, "txHash"),
      };
    }),
    raw: toJsonSafe(result),
  };
}

function failureOf(result: unknown): BridgeFailure {
  const steps = getField<unknown[]>(result, "steps") ?? [];
  const failedStep = steps.find(
    (s) => getField<string>(s as Record<string, unknown>, "state") === "error",
  ) as Record<string, unknown> | undefined;
  const stepName = failedStep ? getField<string>(failedStep, "name") : "unknown";
  const stepErr = failedStep
    ? (getField<string>(failedStep, "error") ?? getField<string>(failedStep, "errorMessage"))
    : undefined;
  return new BridgeFailure(
    `Bridge failed at step "${stepName}": ${stepErr ?? "Unknown bridge error"}`,
    toJsonSafe(result),
  );
}

export type BridgeParams = {
  fromChain: AppKitChain;
  toChain: AppKitChain;
  fromAddress: string;
  toAddress: string;
  amount: string;
  onStep?: (step: BridgeStep) => void;
};

const BRIDGE_STEP_NAMES = new Set(["approve", "burn", "fetchAttestation", "mint"]);

export async function bridgeUSDC(params: BridgeParams): Promise<Result<BridgeResult, Error>> {
  const apiKey = process.env.CIRCLE_API_KEY;
  const entitySecret = process.env.CIRCLE_ENTITY_SECRET;
  if (!apiKey || !entitySecret) {
    return err(new Error("CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET env vars must be set"));
  }

  try {
    // New instance per call to avoid event handler accumulation
    const kit = new AppKit();
    const adapter = createCircleWalletsAdapter({ apiKey, entitySecret });

    if (params.onStep) {
      kit.on("*", (payload) => {
        const name = getField(payload, "method") ?? getField(payload, "name");
        if (!name || !BRIDGE_STEP_NAMES.has(name)) return;
        const values = getField<Record<string, unknown>>(payload, "values");
        const txHash = values ? getField<string>(values, "txHash") : undefined;
        params.onStep?.({ name, state: "success", txHash: txHash ?? undefined });
      });
    }

    const result = await kit.bridge({
      from: {
        adapter,
        chain: params.fromChain,
        address: params.fromAddress,
      },
      to: {
        adapter,
        chain: params.toChain,
        address: params.toAddress,
        useForwarder: true,
      },
      amount: params.amount,
    });

    if (result.state === "error") {
      return err(failureOf(result));
    }
    return ok(mapResult(result, params.amount));
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

function getField<T = string>(obj: unknown, key: string): T | undefined {
  if (typeof obj !== "object" || obj === null) return undefined;
  const val = (obj as Record<string, unknown>)[key];
  return val as T | undefined;
}

export type BridgeFeeEstimateParams = Omit<BridgeParams, "onStep">;

/**
 * Sums the USDC fees App Kit expects to deduct from a transfer (CCTP
 * provider fee + forwarder fee) as a decimal string. Read-only: estimates,
 * never sends. Source-chain gas is paid in that chain's native token and is
 * not included.
 */
export async function estimateBridgeFee(
  params: BridgeFeeEstimateParams,
): Promise<Result<string, Error>> {
  const apiKey = process.env.CIRCLE_API_KEY;
  const entitySecret = process.env.CIRCLE_ENTITY_SECRET;
  if (!apiKey || !entitySecret) {
    return err(new Error("CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET env vars must be set"));
  }
  try {
    const kit = new AppKit();
    const adapter = createCircleWalletsAdapter({ apiKey, entitySecret });
    const estimate = await kit.estimateBridge({
      from: { adapter, chain: params.fromChain, address: params.fromAddress },
      to: { adapter, chain: params.toChain, address: params.toAddress, useForwarder: true },
      amount: params.amount,
    });
    const fees = getField<unknown[]>(estimate, "fees") ?? [];
    let micro = 0n;
    for (const fee of fees) {
      if (getField<string>(fee, "token") !== "USDC") continue;
      const amount = getField<string>(fee, "amount") ?? "0";
      const [whole = "0", fraction = ""] = amount.split(".");
      micro += BigInt(whole) * 1_000_000n + BigInt(fraction.slice(0, 6).padEnd(6, "0") || "0");
    }
    const fraction = (micro % 1_000_000n).toString().padStart(6, "0");
    return ok(`${micro / 1_000_000n}.${fraction}`);
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

/**
 * Resumes a failed bridge from the phase it stopped in (App Kit retryBridge),
 * given the raw result persisted from the failed attempt. Completed steps are
 * not repeated, so a burned transfer is minted rather than burned again.
 */
export async function retryBridge(raw: unknown): Promise<Result<BridgeResult, Error>> {
  const apiKey = process.env.CIRCLE_API_KEY;
  const entitySecret = process.env.CIRCLE_ENTITY_SECRET;
  if (!apiKey || !entitySecret) {
    return err(new Error("CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET env vars must be set"));
  }
  try {
    const kit = new AppKit();
    const adapter = createCircleWalletsAdapter({ apiKey, entitySecret });
    const result = await kit.retryBridge(raw as Parameters<typeof kit.retryBridge>[0], {
      from: adapter,
      to: adapter,
    });
    if (result.state === "error") return err(failureOf(result));
    return ok(mapResult(result, getField<string>(raw, "amount") ?? ""));
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}
