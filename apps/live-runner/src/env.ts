import { readFileSync } from "node:fs";

/**
 * Parses dotenv-style text into key/value pairs. Blank lines and `#` comments
 * are skipped; surrounding single or double quotes are stripped. Only the
 * first `=` separates key from value, so values may contain `=`.
 */
export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 && /^(['"]).*\1$/.test(value)) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/**
 * Loads `.env.local` into process.env without overriding variables that are
 * already set. Secrets are only ever read here, never written to logs.
 */
export function loadEnvFile(path: string): boolean {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return false;
  }
  for (const [key, value] of Object.entries(parseEnv(text))) {
    if (process.env[key] === undefined || process.env[key] === "") {
      process.env[key] = value;
    }
  }
  return true;
}

/** Returns the names of the given keys that are unset or empty. */
export function missingKeys(
  env: Record<string, string | undefined>,
  keys: readonly string[],
): string[] {
  return keys.filter((k) => !env[k]);
}
