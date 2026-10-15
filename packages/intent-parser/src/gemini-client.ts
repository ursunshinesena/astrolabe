import { GoogleGenAI } from "@google/genai";
import { SYSTEM_PROMPT } from "./system-prompt.js";

const MODEL_NAME = "gemini-2.5-flash";

let cachedClient: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (cachedClient) {
    return cachedClient;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set. Add it to .env.local at the repo root.");
  }

  cachedClient = new GoogleGenAI({ apiKey });
  return cachedClient;
}

export async function callGemini(userText: string): Promise<unknown> {
  const client = getClient();

  let responseText: string | undefined;
  try {
    const response = await client.models.generateContent({
      model: MODEL_NAME,
      contents: userText,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: "application/json",
      },
    });
    responseText = response.text;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Gemini network error: ${message}`);
  }

  if (!responseText) {
    throw new Error("Gemini empty response");
  }

  try {
    return JSON.parse(responseText);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Gemini returned invalid JSON: ${message}`);
  }
}
