import { callGemini } from "./gemini-client";
import { IntentResultSchema, type IntentResult } from "./types";

export async function parseIntent(userText: string): Promise<IntentResult> {
  let raw: unknown;
  try {
    raw = await callGemini(userText);
  } catch (err) {
    return { action: "error", reason: `Gemini call failed: ${String(err)}` };
  }

  const parsed = IntentResultSchema.safeParse(raw);
  if (parsed.success) {
    return parsed.data;
  }
  return { action: "error", reason: `Schema validation failed: ${parsed.error.message}` };
}
