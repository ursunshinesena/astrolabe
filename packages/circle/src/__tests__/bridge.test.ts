import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BridgeFailure, bridgeUSDC, retryBridge } from "../bridge.js";

const MOCK_BRIDGE = vi.fn();
const MOCK_RETRY = vi.fn();

vi.mock("@circle-fin/app-kit", () => ({
  AppKit: vi.fn().mockImplementation(() => ({
    bridge: MOCK_BRIDGE,
    retryBridge: MOCK_RETRY,
    on: vi.fn(),
  })),
}));
vi.mock("@circle-fin/adapter-circle-wallets", () => ({
  createCircleWalletsAdapter: vi.fn().mockReturnValue({ type: "circle-wallets" }),
}));

const PARAMS = {
  fromChain: "Ethereum_Sepolia",
  toChain: "Arc_Testnet",
  fromAddress: "0xa",
  toAddress: "0xb",
  amount: "2",
} as const;

const FAILED_AT_MINT = {
  state: "error",
  amount: "2",
  steps: [
    { name: "approve", state: "success", txHash: "0xa1" },
    { name: "burn", state: "success", txHash: "0xb1", data: { nonce: 7n } },
    { name: "fetchAttestation", state: "success" },
    { name: "mint", state: "error", errorMessage: "gas required exceeds allowance" },
  ],
};

beforeEach(() => {
  vi.stubEnv("CIRCLE_API_KEY", "k");
  vi.stubEnv("CIRCLE_ENTITY_SECRET", "s");
  MOCK_BRIDGE.mockReset();
  MOCK_RETRY.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe("bridgeUSDC failure", () => {
  it("returns a BridgeFailure carrying the JSON-safe raw result", async () => {
    MOCK_BRIDGE.mockResolvedValue(FAILED_AT_MINT);

    const outcome = await bridgeUSDC(PARAMS);

    const error = outcome._unsafeUnwrapErr();
    expect(error).toBeInstanceOf(BridgeFailure);
    expect(error.message).toBe('Bridge failed at step "mint": gas required exceeds allowance');
    const raw = (error as BridgeFailure).raw as typeof FAILED_AT_MINT;
    // bigints become strings so the result can be persisted
    expect(raw.steps[1]).toMatchObject({ txHash: "0xb1", data: { nonce: "7" } });
  });
});

describe("retryBridge", () => {
  it("resumes through App Kit and maps the completed result", async () => {
    MOCK_RETRY.mockResolvedValue({
      ...FAILED_AT_MINT,
      state: "success",
      steps: [
        ...FAILED_AT_MINT.steps.slice(0, 3),
        { name: "mint", state: "success", txHash: "0xm1" },
      ],
    });

    const outcome = await retryBridge(FAILED_AT_MINT);

    expect(MOCK_RETRY.mock.calls[0]?.[0]).toBe(FAILED_AT_MINT);
    const result = outcome._unsafeUnwrap();
    expect(result.state).toBe("success");
    expect(result.steps.at(-1)).toMatchObject({ name: "mint", txHash: "0xm1" });
  });

  it("reports a retry that fails again", async () => {
    MOCK_RETRY.mockResolvedValue(FAILED_AT_MINT);
    expect((await retryBridge(FAILED_AT_MINT))._unsafeUnwrapErr()).toBeInstanceOf(BridgeFailure);
  });
});
