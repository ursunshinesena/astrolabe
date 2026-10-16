import { callGemini } from "./gemini-client.js";
import { type IntentResult, IntentResultSchema } from "./types.js";

/**
 * Parses a natural-language request into a validated IntentResult. The LLM
 * call is injectable so the validation path can be tested offline.
 */
export async function parseIntent(
  userText: string,
  call: (text: string) => Promise<unknown> = callGemini,
): Promise<IntentResult> {
  let raw: unknown;
  try {
    raw = await call(userText);
  } catch (err) {
    return { action: "error", reason: `Gemini call failed: ${String(err)}` };
  }

  const parsed = IntentResultSchema.safeParse(raw);
  if (parsed.success) {
    if (parsed.data.action === "swap" && parsed.data.sourceToken === parsed.data.targetToken) {
      return { action: "error", reason: "Source and target currency must differ." };
    }
    return parsed.data;
  }
  return { action: "error", reason: `Schema validation failed: ${parsed.error.message}` };
}
