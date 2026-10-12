export type OutputFormat = "text" | "json" | "machine";

export type Command =
  | { kind: "help" }
  | { kind: "error"; message: string }
  | {
      kind: "open";
      url: string;
      format: OutputFormat;
      timeoutMs: number;
    };

const defaultTimeoutMs = 30_000;

export function parseCommand(argv: readonly string[]): Command {
  const args = argv.slice(2);
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    return { kind: "help" };
  }
  if (args[0] !== "open") {
    return { kind: "error", message: `Unknown command "${args[0]}".` };
  }
  const url = args[1];
  if (url === undefined || url.startsWith("--")) {
    return { kind: "error", message: "Usage: deeplook open <url> [--json]" };
  }
  let format: OutputFormat = "text";
  let timeoutMs = defaultTimeoutMs;
  for (let index = 2; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--json") {
      format = "json";
      continue;
    }
    if (flag === "--machine") {
      format = "machine";
      continue;
    }
    if (flag === "--timeout-ms") {
      const raw = args[index + 1];
      index += 1;
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed < 1) {
        return { kind: "error", message: "--timeout-ms expects a positive integer." };
      }
      timeoutMs = parsed;
      continue;
    }
    return { kind: "error", message: `Unknown option "${flag ?? ""}".` };
  }
  return { kind: "open", url, format, timeoutMs };
}

export const helpText = `DeepLook agent browser

Open one URL in stock Chrome and print the visible page text.

Usage
  deeplook open <url> [--json | --machine] [--timeout-ms <milliseconds>]

Text output is the page text. JSON output also includes the final URL,
title, and the locale, timezone, viewport, and webdriver bit the page saw.
Machine output is a versioned JSON result for the DeepLook HTTP adapter.

Environment
  DEEPLOOK_CHROME   Path to the Chrome binary. Defaults to
                    /opt/google/chrome/chrome, then google-chrome-stable.
`;
