import { createCircleWalletsAdapter } from "@circle-fin/adapter-circle-wallets";
import { AppKit } from "@circle-fin/app-kit";
import { err, ok, type Result } from "neverthrow";

// App Kit chain name strings — NOT numeric chain IDs
// Source: bridge-stablecoin skill
export const APPKIT_CHAIN = {
  ETH_SEPOLIA: "Ethereum_Sepolia",
  BASE_SEPOLIA: "Base_Sepolia",
  AVAX_FUJI: "Avalanche_Fuji",
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
};

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
  const apiKey = process.env["CIRCLE_API_KEY"];
  const entitySecret = process.env["CIRCLE_ENTITY_SECRET"];
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
      const steps = getField<unknown[]>(result, "steps") ?? [];
      const failedStep = steps.find(
        (s) => getField<string>(s as Record<string, unknown>, "state") === "error",
      );
      const stepName = failedStep
        ? getField<string>(failedStep as Record<string, unknown>, "name")
        : "unknown";
      const stepErr = failedStep
        ? getField<string>(failedStep as Record<string, unknown>, "error")
        : "Unknown bridge error";
      return err(new Error(`Bridge failed at step "${stepName}": ${stepErr}`));
    }

    const rawSteps = getField<unknown[]>(result, "steps") ?? [];
    return ok({
      state: getField<string>(result, "state") ?? "unknown",
      amount: getField<string>(result, "amount") ?? params.amount,
      steps: rawSteps.map((s) => {
        const step = s as Record<string, unknown>;
        return {
          name: getField<string>(step, "name") ?? "unknown",
          state: getField<string>(step, "state") ?? "unknown",
          txHash: getField<string>(step, "txHash"),
        };
      }),
    });
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

function getField<T = string>(obj: unknown, key: string): T | undefined {
  if (typeof obj !== "object" || obj === null) return undefined;
  const val = (obj as Record<string, unknown>)[key];
  return val as T | undefined;
}
