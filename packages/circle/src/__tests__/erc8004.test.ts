import { keccak256, pad, stringToHex } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

const CREATE_EXEC = vi.fn();
const GET_TX = vi.fn();

vi.mock("@circle-fin/developer-controlled-wallets", () => ({
  initiateDeveloperControlledWalletsClient: () => ({
    createContractExecutionTransaction: CREATE_EXEC,
    getTransaction: GET_TX,
  }),
}));

const { ERC8004_ARC_TESTNET, agentIdFromLogs, agentMetadataURI, giveAgentFeedback, uuidFrom } =
  await import("../erc8004.js");

const OWNER = "0x1415ca294cdaef9857e21be223c00741be37657f";
const TRANSFER = keccak256(stringToHex("Transfer(address,address,uint256)"));

beforeEach(() => {
  vi.stubEnv("CIRCLE_API_KEY", "k");
  vi.stubEnv("CIRCLE_ENTITY_SECRET", "s");
  CREATE_EXEC.mockReset().mockResolvedValue({ data: { id: "tx-1" } });
  GET_TX.mockReset().mockResolvedValue({
    data: { transaction: { state: "COMPLETE", txHash: "0xfeed" } },
  });
});

describe("agentIdFromLogs", () => {
  it("reads the minted id from the registry's Transfer to the owner", () => {
    const logs = [
      { address: "0xother", topics: [TRANSFER, pad("0x0"), pad(OWNER), pad("0x99")] },
      {
        address: ERC8004_ARC_TESTNET.identityRegistry,
        topics: [TRANSFER, pad("0x0"), pad(OWNER), pad("0x2a")],
      },
    ] as const;
    expect(agentIdFromLogs(logs, OWNER)).toBe("42");
    expect(agentIdFromLogs(logs, "0x0000000000000000000000000000000000000001")).toBeNull();
  });
});

describe("helpers", () => {
  it("encodes the agent card as a JSON data URI", () => {
    const uri = agentMetadataURI({ name: "Astrolabe" });
    expect(uri.startsWith("data:application/json;base64,")).toBe(true);
    expect(JSON.parse(Buffer.from(uri.split(",")[1] ?? "", "base64").toString())).toEqual({
      name: "Astrolabe",
    });
  });

  it("derives a stable UUID-shaped idempotency key", () => {
    expect(uuidFrom("exec_1")).toBe(uuidFrom("exec_1"));
    expect(uuidFrom("exec_1")).not.toBe(uuidFrom("exec_2"));
    expect(uuidFrom("exec_1")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

describe("giveAgentFeedback", () => {
  it("rates from the validator wallet, points at the receipt and is keyed by execution", async () => {
    const out = await giveAgentFeedback({
      validatorWalletId: "validator",
      agentId: "42",
      executionId: "exec_1",
      feedbackURI: "https://testnet.arcscan.app/tx/0xswap",
    });

    expect(out._unsafeUnwrap()).toBe("0xfeed");
    const call = CREATE_EXEC.mock.calls[0]?.[0];
    expect(call).toMatchObject({
      walletId: "validator",
      contractAddress: ERC8004_ARC_TESTNET.reputationRegistry,
      abiFunctionSignature:
        "giveFeedback(uint256,int128,uint8,string,string,string,string,bytes32)",
      idempotencyKey: uuidFrom("exec_1"),
    });
    expect(call.abiParameters.slice(0, 5)).toEqual(["42", "100", "0", "fx_execution", "completed"]);
    expect(call.abiParameters[6]).toBe("https://testnet.arcscan.app/tx/0xswap");
  });

  it("reports a failed transaction instead of a hash", async () => {
    GET_TX.mockResolvedValue({ data: { transaction: { state: "FAILED" } } });
    const out = await giveAgentFeedback({
      validatorWalletId: "v",
      agentId: "1",
      executionId: "e",
      feedbackURI: "u",
    });
    expect(out._unsafeUnwrapErr().message).toContain("FAILED");
  });
});
