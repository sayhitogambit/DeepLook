import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";

import type { OpenedPage } from "./openPage.js";
import { pageProblem } from "./pageResult.js";
import {
  defaultAddressResolver,
  UnsafeUrlError,
  validatePublicUrl,
  type AddressResolver,
} from "./security.js";

export type PageOpener = (url: string, timeoutMs: number, signal: AbortSignal) => Promise<OpenedPage>;
export type ApiServerOptions = {
  authorizationToken?: string;
  addressResolver?: AddressResolver;
  maxConcurrent?: number;
  launchSlackMs?: number;
};

const defaultTimeoutMs = 30_000;
const maxTimeoutMs = 120_000;
const maxBodyBytes = 65_536;
const defaultLaunchSlackMs = 20_000;

export type ApiErrorCode =
  | "invalid_request"
  | "navigation_failed"
  | "timeout"
  | "challenge"
  | "unauthorized"
  | "busy"
  | "not_found";

type ApiErrorBody = {
  error: ApiErrorCode;
  message: string;
  finalUrl?: string;
  title?: string;
  marker?: string;
};

type OpenInput =
  | { ok: true; url: string; timeoutMs: number }
  | { ok: false; message: string };

class BodyTooLargeError extends Error {
  constructor() {
    super("Request body is too large.");
    this.name = "BodyTooLargeError";
  }
}

class DeadlineError extends Error {
  constructor(timeoutMs: number) {
    super(`Timed out after ${timeoutMs}ms.`);
    this.name = "DeadlineError";
  }
}

export function createApiServer(open: PageOpener, options: ApiServerOptions = {}): Server {
  const maxConcurrent = options.maxConcurrent ?? 2;
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
    throw new Error("maxConcurrent must be a positive integer.");
  }
  let active = 0;
  return createServer((request, response) => {
    void route(request, response, open, options, {
      acquire: () => {
        if (active >= maxConcurrent) return false;
        active += 1;
        return true;
      },
      release: () => { active -= 1; },
    });
  });
}

async function route(
  request: IncomingMessage,
  response: ServerResponse,
  open: PageOpener,
  options: ApiServerOptions,
  slots: { acquire: () => boolean; release: () => void },
): Promise<void> {
  const path = (request.url ?? "/").split("?")[0];
  if (request.method === "GET" && path === "/health") {
    sendJson(response, 200, { ok: true });
    return;
  }
  if (request.method === "POST" && path === "/v1/open") {
    if (options.authorizationToken !== undefined &&
      !hasBearerToken(request.headers.authorization, options.authorizationToken)) {
      sendError(response, "unauthorized", "A valid bearer token is required.");
      return;
    }
    await openRoute(request, response, open, options, slots);
    return;
  }
  sendError(response, "not_found", "Not found.");
}

async function openRoute(
  request: IncomingMessage,
  response: ServerResponse,
  open: PageOpener,
  options: ApiServerOptions,
  slots: { acquire: () => boolean; release: () => void },
): Promise<void> {
  let raw: string;
  try {
    raw = await readBody(request);
  } catch (cause) {
    if (cause instanceof BodyTooLargeError) {
      sendError(response, "invalid_request", cause.message);
      return;
    }
    sendError(response, "invalid_request", "Could not read the request body.");
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    sendError(response, "invalid_request", "Request body must be JSON.");
    return;
  }

  const input = readOpenInput(parsed);
  if (input.ok === false) {
    sendError(response, "invalid_request", input.message);
    return;
  }

  try {
    await validatePublicUrl(input.url, options.addressResolver ?? defaultAddressResolver);
  } catch (cause) {
    const message = cause instanceof UnsafeUrlError ? cause.message : "Could not validate URL.";
    sendError(response, "invalid_request", message);
    return;
  }
  if (!slots.acquire()) {
    sendError(response, "busy", "Too many browser requests are active.");
    return;
  }

  try {
    const page = await openWithin(open, input.url, input.timeoutMs, request, response,
      options.launchSlackMs ?? defaultLaunchSlackMs, slots.release);
    await validatePublicUrl(page.finalUrl, options.addressResolver ?? defaultAddressResolver);
    const problem = pageProblem(page);
    if (problem?.kind === "challenge") {
      sendError(response, "challenge", "The site returned a bot check instead of the page.", {
        finalUrl: page.finalUrl,
        title: page.title,
        marker: problem.marker,
      });
      return;
    }
    if (problem?.kind === "upstream_http") {
      sendError(response, "navigation_failed", `Upstream returned HTTP ${problem.status}.`, {
        finalUrl: page.finalUrl,
        title: page.title,
      });
      return;
    }
    sendJson(response, 200, page);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Navigation failed.";
    if (isTimeout(cause)) {
      sendError(response, "timeout", message);
      return;
    }
    sendError(response, "navigation_failed", message);
  }
}

function readOpenInput(value: unknown): OpenInput {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, message: "Request body must be a JSON object." };
  }
  const body = value as { url?: unknown; timeoutMs?: unknown };
  if (typeof body.url !== "string" || body.url.trim() !== body.url) {
    return { ok: false, message: 'Expected a string "url".' };
  }
  let parsed: URL;
  try {
    parsed = new URL(body.url);
  } catch {
    return { ok: false, message: "url must be an absolute http(s) URL." };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, message: "url must be an absolute http(s) URL." };
  }
  if (body.timeoutMs === undefined) {
    return { ok: true, url: body.url, timeoutMs: defaultTimeoutMs };
  }
  if (
    typeof body.timeoutMs !== "number" ||
    !Number.isInteger(body.timeoutMs) ||
    body.timeoutMs < 1 ||
    body.timeoutMs > maxTimeoutMs
  ) {
    return {
      ok: false,
      message: `timeoutMs must be an integer from 1 to ${maxTimeoutMs}.`,
    };
  }
  return { ok: true, url: body.url, timeoutMs: body.timeoutMs };
}

function openWithin(
  open: PageOpener,
  url: string,
  timeoutMs: number,
  request: IncomingMessage,
  response: ServerResponse,
  slackMs: number,
  onOperationSettled: () => void,
): Promise<OpenedPage> {
  const deadlineMs = timeoutMs + slackMs;
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const onDisconnect = () => {
      controller.abort();
      cleanup();
      reject(new Error("Client disconnected."));
    };
    response.once("close", onDisconnect);
    const cleanup = () => {
      clearTimeout(timer);
      response.off("close", onDisconnect);
    };
    const timer = setTimeout(() => {
      controller.abort();
      cleanup();
      reject(new DeadlineError(deadlineMs));
    }, deadlineMs);
    if (request.destroyed && !request.complete) controller.abort();
    Promise.resolve().then(() => open(url, timeoutMs, controller.signal)).then(
      (page) => {
        cleanup();
        onOperationSettled();
        resolve(page);
      },
      (cause: unknown) => {
        cleanup();
        onOperationSettled();
        reject(cause);
      },
    );
  });
}

function hasBearerToken(raw: string | undefined, expected: string): boolean {
  const match = /^Bearer (\S+)$/.exec(raw ?? "");
  if (match === null) return false;
  const provided = Buffer.from(match[1]);
  const secret = Buffer.from(expected);
  return provided.length === secret.length && timingSafeEqual(provided, secret);
}

function isTimeout(cause: unknown): boolean {
  if (!(cause instanceof Error)) return false;
  if (cause.name === "TimeoutError" || cause.name === "DeadlineError") return true;
  return /Timeout \d+ms exceeded/i.test(cause.message);
}

function readBody(request: IncomingMessage): Promise<string> {
  const declared = request.headers["content-length"];
  if (declared !== undefined && Number(declared) > maxBodyBytes) {
    request.resume();
    return Promise.reject(new BodyTooLargeError());
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBodyBytes) {
        reject(new BodyTooLargeError());
        request.removeAllListeners("data");
        request.resume();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    request.on("error", () => {
      reject(new Error("Could not read the request body."));
    });
  });
}

function sendError(
  response: ServerResponse,
  code: ApiErrorCode,
  message: string,
  extra?: Pick<ApiErrorBody, "finalUrl" | "title" | "marker">,
): void {
  const body: ApiErrorBody = { error: code, message, ...extra };
  sendJson(response, statusFor(code), body);
}

function statusFor(code: ApiErrorCode): number {
  switch (code) {
    case "invalid_request":
      return 400;
    case "navigation_failed":
      return 502;
    case "timeout":
      return 504;
    case "challenge":
      return 422;
    case "unauthorized":
      return 401;
    case "busy":
      return 503;
    case "not_found":
      return 404;
    default: {
      const unexpected: never = code;
      return unexpected;
    }
  }
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  if (response.destroyed || response.writableEnded) return;
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  response.end(payload);
}
