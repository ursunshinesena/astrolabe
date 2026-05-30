import type { ExecutionResult, Intent, ParsedIntent, Route } from "@agora/types";
import Anthropic from "@anthropic-ai/sdk";
import { type Result, err, ok } from "neverthrow";

// Stub — implemented in M3
export async function parseIntent(_raw: string): Promise<Result<ParsedIntent, Error>> {
  return err(new Error("Intent parser not implemented — coming in M3"));
}

// Stub — implemented in M2
export async function selectOptimalRoute(_intent: ParsedIntent): Promise<Result<Route, Error>> {
  return err(new Error("Routing engine not implemented — coming in M2"));
}

// Stub — implemented in M5
export async function executeRoute(
  _route: Route,
  _approved: true,
): Promise<Result<ExecutionResult, Error>> {
  return err(new Error("Execution engine not implemented — coming in M5"));
}

export type { Intent, ParsedIntent, Route, ExecutionResult };
