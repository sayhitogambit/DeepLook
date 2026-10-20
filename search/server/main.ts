import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createNymetricPackage } from "./nymetric";
import { runQuery } from "./query";

// Production entry. `vite.config.ts` wires the same routes into the dev server;
// this serves the built `dist/` and the two API routes without Vite.

const DIST = fileURLToPath(new URL("../dist", import.meta.url));
const HOST = process.env.HOST ?? "127.0.0.1";
const PORT = Number(process.env.PORT ?? 47241);

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".json": "application/json; charset=utf-8",
};

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, data: unknown) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(data));
}

async function handleQuery(req: IncomingMessage, res: ServerResponse) {
  res.setHeader("content-type", "text/event-stream");
  res.setHeader("cache-control", "no-cache");
  res.setHeader("connection", "keep-alive");
  res.setHeader("x-accel-buffering", "no");
  res.flushHeaders();
  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  try {
    const raw = await readBody(req);
    const body = JSON.parse(raw) as { query?: string };
    const query = body.query?.trim() ?? "";
    if (!query) {
      send("error", { message: "Enter a question first." });
      res.end();
      return;
    }
    await runQuery(query, send);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Query failed.";
    send("error", { message });
  }
  res.end();
}

async function handleService(url: string, req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "POST") {
    sendJson(res, 405, { message: "Use POST." });
    return;
  }
  try {
    const raw = await readBody(req);
    const body = JSON.parse(raw) as { service?: string };
    if (url === "/api/service/run") {
      sendJson(res, 404, { message: "Nymetric has no public API, so it has no tools." });
      return;
    }
    const service = body.service?.trim().toLowerCase() ?? "";
    if (!service) {
      sendJson(res, 400, { message: "Name a service." });
      return;
    }
    if (service !== "nymetric") {
      sendJson(res, 404, { message: "Nymetric is the only service that can be built from here." });
      return;
    }
    sendJson(res, 200, createNymetricPackage());
  } catch (error) {
    const message = error instanceof Error ? error.message : "The service request failed.";
    sendJson(res, 400, { message });
  }
}

function serveStatic(url: string, res: ServerResponse) {
  const relative = normalize(decodeURIComponent(url)).replace(/^(\.\.[/\\])+/, "");
  let file = join(DIST, relative);
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) {
    file = join(DIST, "index.html");
  }
  res.statusCode = 200;
  res.setHeader("content-type", MIME[extname(file)] ?? "application/octet-stream");
  if (file.includes("/assets/")) res.setHeader("cache-control", "public, max-age=31536000, immutable");
  createReadStream(file).pipe(res);
}

const server = createServer((req, res) => {
  const url = (req.url ?? "/").split("?")[0];
  if (url === "/api/query") {
    if (req.method !== "POST") {
      sendJson(res, 405, { message: "Use POST." });
      return;
    }
    void handleQuery(req, res);
    return;
  }
  if (url === "/api/service" || url === "/api/service/run") {
    void handleService(url, req, res);
    return;
  }
  if (url === "/health") {
    sendJson(res, 200, { ok: true });
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendJson(res, 405, { message: "Use GET." });
    return;
  }
  serveStatic(url, res);
});

server.listen(PORT, HOST, () => {
  process.stdout.write(`DeepLook search listening on http://${HOST}:${PORT}\n`);
});
