import { z } from "zod";

/**
 * Token allowlist: Circle's dollar and euro stablecoins, the pair Astrolabe
 * converts on Arc. Anything else is rejected during parsing.
 */
export const TokenSchema = z.enum(["USDC", "EURC"]);
export type Token = z.infer<typeof TokenSchema>;

/**
 * Amount — positive decimal string, human-readable unit.
 * Examples: "500" = 500 USDC, "0.5" = 0.5 EURC.
 * Not raw on-chain units (e.g. "500000000") — that conversion lives in M2/execution.
 * Stored as string (not number) to avoid floating-point errors.
 */
export const AmountSchema = z
  .string()
  .regex(/^\d+(\.\d+)?$/, "amount must be a positive decimal string (e.g. '500' or '0.5')");
export type Amount = z.infer<typeof AmountSchema>;

/**
 * Successful parse — a swap intent.
 */
export const SwapIntentSchema = z.object({
  action: z.literal("swap"),
  sourceToken: TokenSchema,
  targetToken: TokenSchema,
  amount: AmountSchema,
});
export type SwapIntent = z.infer<typeof SwapIntentSchema>;

/**
 * Missing information — user needs to be asked for more.
 */
export const ClarificationSchema = z.object({
  action: z.literal("needs_clarification"),
  question: z.string().min(1),
  missingFields: z.array(z.string()).min(1),
});
export type Clarification = z.infer<typeof ClarificationSchema>;

/**
 * Unparseable input — could not extract a valid intent.
 */
export const ParseErrorSchema = z.object({
  action: z.literal("error"),
  reason: z.string().min(1),
});
export type ParseError = z.infer<typeof ParseErrorSchema>;

/**
 * IntentResult — discriminated union on the `action` field.
 * TypeScript narrows based on the action value, so consumers can write
 * `if (result.action === "swap") { ... }` and get full type safety.
 */
export const IntentResultSchema = z.discriminatedUnion("action", [
  SwapIntentSchema,
  ClarificationSchema,
  ParseErrorSchema,
]);
export type IntentResult = z.infer<typeof IntentResultSchema>;
