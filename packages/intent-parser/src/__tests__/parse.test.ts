import { describe, expect, it } from "vitest";
import { parseIntent } from "../parse.js";

describe("parseIntent", () => {
  it("accepts a valid swap, including EURC", async () => {
    const result = await parseIntent("x", async () => ({
      action: "swap",
      sourceToken: "USDC",
      targetToken: "EURC",
      amount: "25",
    }));
    expect(result).toEqual({
      action: "swap",
      sourceToken: "USDC",
      targetToken: "EURC",
      amount: "25",
    });
  });

  it("passes clarification questions through", async () => {
    const result = await parseIntent("x", async () => ({
      action: "needs_clarification",
      question: "How much?",
      missingFields: ["amount"],
    }));
    expect(result.action).toBe("needs_clarification");
  });

  it("rejects ETH and same-token conversions even if the model returns them", async () => {
    const eth = await parseIntent("x", async () => ({
      action: "swap",
      sourceToken: "USDC",
      targetToken: "ETH",
      amount: "1",
    }));
    expect(eth.action).toBe("error");
    const same = await parseIntent("x", async () => ({
      action: "swap",
      sourceToken: "USDC",
      targetToken: "USDC",
      amount: "1",
    }));
    expect(same.action).toBe("error");
  });

  it("turns schema violations and call failures into error results", async () => {
    const bad = await parseIntent("x", async () => ({ action: "swap", sourceToken: "PEPE" }));
    expect(bad.action).toBe("error");
    const failed = await parseIntent("x", async () => {
      throw new Error("offline");
    });
    expect(failed).toMatchObject({ action: "error", reason: expect.stringContaining("offline") });
  });
});
