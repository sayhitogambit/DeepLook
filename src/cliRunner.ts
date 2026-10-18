import { helpText, parseCommand } from "./command.js";
import type { OpenedPage } from "./openPage.js";
import { pageProblem, type PageProblem } from "./pageResult.js";

type Writer = { write(chunk: string): unknown };
type SignalSource = {
  on(event: "SIGTERM" | "SIGINT", listener: () => void): unknown;
  off(event: "SIGTERM" | "SIGINT", listener: () => void): unknown;
};

export type CliIO = { stdout: Writer; stderr: Writer; signals: SignalSource };
export type PageOpener = (url: string, timeoutMs: number, signal: AbortSignal) => Promise<OpenedPage>;

type MachineError = {
  version: 1;
  ok: false;
  error: "challenge" | "access_wall" | "empty_content" | "upstream_http" | "timeout" | "navigation_failed";
  message: string;
  finalUrl?: string;
  title?: string;
  marker?: string;
};

export async function runCli(argv: readonly string[], open: PageOpener, io: CliIO): Promise<number> {
  const command = parseCommand(argv);
  switch (command.kind) {
    case "help":
      io.stdout.write(helpText);
      return 0;
    case "error":
      io.stderr.write(`${command.message}\n${helpText}`);
      return 1;
    case "open": {
      const controller = new AbortController();
      const abort = () => controller.abort(new Error("Browser request was canceled."));
      io.signals.on("SIGTERM", abort);
      io.signals.on("SIGINT", abort);
      try {
        const page = await open(command.url, command.timeoutMs, controller.signal);
        const problem = pageProblem(page);
        if (problem !== undefined) {
          writeFailure(io, command.format === "machine", pageFailure(page, problem));
          return 1;
        }
        switch (command.format) {
          case "text":
            io.stdout.write(page.text.length === 0 ? "" : `${page.text}\n`);
            break;
          case "json":
            io.stdout.write(`${JSON.stringify(page, null, 2)}\n`);
            break;
          case "machine":
            io.stdout.write(`${JSON.stringify({ version: 1, ok: true, page })}\n`);
            break;
          default: {
            const unexpected: never = command.format;
            return unexpected;
          }
        }
        return 0;
      } catch (cause) {
        const error: MachineError = {
          version: 1,
          ok: false,
          error: isTimeout(cause) ? "timeout" : "navigation_failed",
          message: cause instanceof Error ? cause.message : String(cause),
        };
        writeFailure(io, command.format === "machine", error);
        return 1;
      } finally {
        io.signals.off("SIGTERM", abort);
        io.signals.off("SIGINT", abort);
      }
    }
    default: {
      const unexpected: never = command;
      return unexpected;
    }
  }
}

function pageFailure(page: OpenedPage, problem: PageProblem): MachineError {
  const base = { version: 1, ok: false, finalUrl: page.finalUrl, title: page.title } as const;
  switch (problem.kind) {
    case "challenge":
      return { ...base, error: problem.kind, marker: problem.marker,
        message: "The site returned a bot check instead of the page." };
    case "access_wall":
      return { ...base, error: problem.kind, marker: problem.marker,
        message: "The site returned an access gate instead of the requested page." };
    case "empty_content":
      return { ...base, error: problem.kind, message: "The page returned no readable text." };
    case "upstream_http":
      return { ...base, error: problem.kind, message: `Upstream returned HTTP ${problem.status}.` };
  }
}

function writeFailure(io: CliIO, machine: boolean, error: MachineError): void {
  if (machine) io.stdout.write(`${JSON.stringify(error)}\n`);
  else io.stderr.write(`${error.message}\n`);
}

function isTimeout(cause: unknown): boolean {
  if (!(cause instanceof Error)) return false;
  return cause.name === "TimeoutError" || /Timeout \d+ms exceeded/i.test(cause.message);
}
