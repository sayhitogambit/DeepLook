import type { PageOpener } from "./cliRunner.js";
import type { OpenedPage } from "./openPage.js";

const messages = {
  invalid_request: "Invalid request or API configuration. Use an HTTP(S) base URL without credentials, query, or fragment; HTTPS is required outside loopback.",
  unauthorized: "The API requires a valid bearer token in DEEPLOOK_API_TOKEN.",
  challenge: "The site returned a bot check instead of the page.",
  access_wall: "The site returned an access gate instead of the requested page.",
  empty_content: "The page returned no readable text.",
  quota_exceeded: "The account browser request quota has been reached.",
  busy: "The browser API is at capacity. Try again later.",
  timeout: "The browser API request timed out.",
  navigation_failed: "The browser API did not return a valid page.",
} as const;

export type RemoteApiErrorCode = keyof typeof messages;
export type RemoteConfiguration = { base: URL; token?: string };

export class RemoteApiError extends Error {
  constructor(readonly code: RemoteApiErrorCode) {
    // Server error messages can reflect request headers or URLs. Never print
    // them verbatim into a coding tool's context or terminal.
    super(messages[code]);
    this.name = "RemoteApiError";
  }
}

export function remoteConfiguration(env: NodeJS.ProcessEnv = process.env): RemoteConfiguration | undefined {
  const raw = env.DEEPLOOK_API_URL?.trim();
  if (!raw) return undefined;
  let base: URL;
  try { base = new URL(raw); } catch { throw new RemoteApiError("invalid_request"); }
  const hostname = base.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  const loopback = hostname === "localhost" || hostname === "::1" || /^127\.\d+\.\d+\.\d+$/.test(hostname);
  if ((base.protocol !== "http:" && base.protocol !== "https:") ||
    (base.protocol === "http:" && !loopback) || base.username || base.password || base.search || base.hash) {
    throw new RemoteApiError("invalid_request");
  }
  const token = env.DEEPLOOK_API_TOKEN?.trim() || undefined;
  if (token && /\s/.test(token)) throw new RemoteApiError("invalid_request");
  if (!loopback && !token) throw new RemoteApiError("unauthorized");
  if (!base.pathname.endsWith("/")) base.pathname += "/";
  return { base, token };
}

export function createRemoteOpener(configuration: RemoteConfiguration): PageOpener {
  return async (url, timeoutMs, signal) => {
    const combined = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
    try {
      const response = await fetch(new URL("v1/open", configuration.base), {
        method: "POST", redirect: "error", signal: combined,
        headers: {
          "content-type": "application/json", accept: "application/json",
          ...(configuration.token ? { authorization: `Bearer ${configuration.token}` } : {}),
        },
        body: JSON.stringify({ url, timeoutMs }),
      });
      const body: unknown = await readJson(response);
      if (!response.ok) {
        if (isRecord(body) && typeof body.error === "string" && Object.hasOwn(messages, body.error)) {
          throw new RemoteApiError(body.error as RemoteApiErrorCode);
        }
        throw new RemoteApiError("navigation_failed");
      }
      if (!isOpenedPage(body)) throw new RemoteApiError("navigation_failed");
      return body;
    } catch (cause) {
      if (cause instanceof RemoteApiError) throw cause;
      if (combined.aborted && combined.reason instanceof Error && combined.reason.name === "TimeoutError") {
        throw new RemoteApiError("timeout");
      }
      throw new RemoteApiError("navigation_failed");
    }
  };
}

export async function probeRemoteHealth(configuration: RemoteConfiguration): Promise<void> {
  const response = await fetch(new URL("health", configuration.base), {
    method: "GET", redirect: "error", signal: AbortSignal.timeout(3_000),
    headers: { accept: "application/json", ...(configuration.token ? { authorization: `Bearer ${configuration.token}` } : {}) },
  });
  if (!response.ok) throw new RemoteApiError("navigation_failed");
  const body = await readJson(response);
  if (!isRecord(body) || body.ok !== true) throw new RemoteApiError("navigation_failed");
}

async function readJson(response: Response): Promise<unknown> {
  if (!response.body) throw new RemoteApiError("navigation_failed");
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2_000_000) {
        await reader.cancel();
        throw new RemoteApiError("navigation_failed");
      }
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally { reader.releaseLock(); }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isOpenedPage(value: unknown): value is OpenedPage {
  if (!isRecord(value) || !isRecord(value.observed) || !isRecord(value.observed.viewport)) return false;
  const observed = value.observed;
  const viewport = observed.viewport as Record<string, unknown>;
  return typeof value.requestedUrl === "string" && typeof value.finalUrl === "string" &&
    typeof value.title === "string" && typeof value.text === "string" && typeof value.truncated === "boolean" &&
    (value.httpStatus === undefined || (Number.isInteger(value.httpStatus) && Number(value.httpStatus) >= 100 && Number(value.httpStatus) <= 599)) &&
    typeof observed.webdriver === "boolean" && typeof observed.userAgent === "string" &&
    Array.isArray(observed.brands) && observed.brands.every((item) => typeof item === "string") &&
    Array.isArray(observed.languages) && observed.languages.every((item) => typeof item === "string") &&
    typeof observed.timezone === "string" &&
    Number.isInteger(viewport.width) && Number(viewport.width) > 0 &&
    Number.isInteger(viewport.height) && Number(viewport.height) > 0;
}
