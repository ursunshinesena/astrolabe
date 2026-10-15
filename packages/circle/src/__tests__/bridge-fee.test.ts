import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { estimateBridgeFee } from "../bridge.js";

const MOCK_ESTIMATE = vi.fn();

vi.mock("@circle-fin/app-kit", () => ({
  AppKit: vi.fn().mockImplementation(() => ({ estimateBridge: MOCK_ESTIMATE })),
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

beforeEach(() => {
  vi.stubEnv("CIRCLE_API_KEY", "k");
  vi.stubEnv("CIRCLE_ENTITY_SECRET", "s");
  MOCK_ESTIMATE.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe("estimateBridgeFee", () => {
  it("sums the USDC fees exactly (values from a live estimate)", async () => {
    MOCK_ESTIMATE.mockResolvedValue({
      fees: [
        { type: "provider", token: "USDC", amount: "0.00022" },
        { type: "forwarder", token: "USDC", amount: "0.021344" },
        { type: "gas", token: "ETH", amount: "0.5" },
      ],
    });
    const fee = await estimateBridgeFee(PARAMS);
    expect(fee._unsafeUnwrap()).toBe("0.021564");
    expect(MOCK_ESTIMATE.mock.calls[0]?.[0]).toMatchObject({
      to: { chain: "Arc_Testnet", useForwarder: true },
      amount: "2",
    });
  });

  it("returns an error instead of throwing when the SDK fails or creds are missing", async () => {
    MOCK_ESTIMATE.mockRejectedValue(new Error("rpc down"));
    expect((await estimateBridgeFee(PARAMS))._unsafeUnwrapErr().message).toBe("rpc down");
    vi.stubEnv("CIRCLE_API_KEY", "");
    expect((await estimateBridgeFee(PARAMS)).isErr()).toBe(true);
  });
});
