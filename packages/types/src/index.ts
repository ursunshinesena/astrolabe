import { z } from "zod";

export const IntentSchema = z.object({
  id: z.string().uuid(),
  raw: z.string().min(1),
  createdAt: z.string().datetime(),
  userId: z.string().optional(),
});

export type Intent = z.infer<typeof IntentSchema>;

export const ParsedIntentSchema = z.object({
  intentId: z.string().uuid(),
  action: z.enum(["swap", "bridge", "bridge_and_swap"]),
  inputToken: z.string(),
  outputToken: z.string(),
  inputAmount: z.string(),
  sourceChain: z.string(),
  destinationChain: z.string().optional(),
  maxSlippageBps: z.number().int().min(0).max(10000).default(50),
});

export type ParsedIntent = z.infer<typeof ParsedIntentSchema>;

export const RouteSchema = z.object({
  intentId: z.string().uuid(),
  sourceChain: z.string(),
  destinationChain: z.string(),
  inputToken: z.string(),
  outputToken: z.string(),
  inputAmount: z.string(),
  estimatedOutputAmount: z.string(),
  estimatedGasCostUsd: z.string(),
  estimatedBridgeFeeUsd: z.string(),
  totalCostUsd: z.string(),
  strategy: z.enum(["swap_only", "bridge_then_swap", "swap_then_bridge"]),
  estimatedDurationSeconds: z.number(),
});

export type Route = z.infer<typeof RouteSchema>;

export const ExecutionStatusSchema = z.enum([
  "pending",
  "awaiting_approval",
  "executing",
  "completed",
  "failed",
  "rejected",
]);

export type ExecutionStatus = z.infer<typeof ExecutionStatusSchema>;

export const ExecutionResultSchema = z.object({
  intentId: z.string().uuid(),
  route: RouteSchema,
  status: ExecutionStatusSchema,
  txHashes: z.array(z.string()),
  actualOutputAmount: z.string().optional(),
  error: z.string().optional(),
  completedAt: z.string().datetime().optional(),
});

export type ExecutionResult = z.infer<typeof ExecutionResultSchema>;
