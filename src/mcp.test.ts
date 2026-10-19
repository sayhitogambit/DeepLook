import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer, type RequestListener } from "node:http";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { browserEnvironment } from "./runtimeEnvironment.js";

async function session(env: Record<string, string> = {}, args = [fileURLToPath(new URL("./cli.js", import.meta.url)), "mcp"]) {
  const client = new Client({ name: "deeplook-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath, args,
    env: { ...browserEnvironment(), DEEPLOOK_CHROME: "/deeplook-test/no-chrome", ...env }, stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
  try {
    await assert.doesNotReject(() => client.connect(transport, { timeout: 3_000 }),
      "deeplook mcp must complete an MCP handshake");
    return { client, transport, stderr: () => stderr, close: () => client.close() };
  } catch (error) { await client.close(); throw error; }
}

function event() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function promptly(promise: Promise<unknown>, ms = 1_000): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise.then(() => true),
    new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), ms); })]); }
  finally { clearTimeout(timer); }
}

test("mcp admits one read and releases admission after a timed-out read", async () => {
  const started = event();
  let requests = 0;
  const connection = await fixture((_request, response) => {
    requests++;
    if (requests === 1) { response.writeHead(200); response.write('{"text":'); started.resolve(); }
    else response.end(JSON.stringify(page));
  });
  const first = connection.client.callTool({ name: "deeplook_open",
    arguments: { url: page.requestedUrl, timeoutMs: 1_500 } });
  try {
    assert.equal(await promptly(started.promise), true);
    const busy = await connection.client.callTool({ name: "deeplook_open", arguments: { url: page.requestedUrl } });
    assert.equal(busy.isError, true);
    assert.equal((busy.structuredContent as Record<string, unknown>)?.error, "busy");
    assert.equal(requests, 1, "a rejected concurrent call must not consume an API request");
    assert.equal(((await first).structuredContent as Record<string, unknown>)?.error, "timeout");
    const next = await connection.client.callTool({ name: "deeplook_open", arguments: { url: page.requestedUrl } });
    assert.notEqual(next.isError, true);
  } finally { await first.catch(() => {}); await connection.close(); }
});

test("mcp cancellation closes the upstream read and allows the next read", async () => {
  const started = event();
  const closed = event();
  let requests = 0;
  const connection = await fixture((_request, response) => {
    if (++requests === 1) {
      response.once("close", closed.resolve);
      response.writeHead(200); response.write('{"text":'); started.resolve();
    } else response.end(JSON.stringify(page));
  });
  const controller = new AbortController();
  const canceled = connection.client.callTool({ name: "deeplook_open",
    arguments: { url: page.requestedUrl, timeoutMs: 10_000 } }, { signal: controller.signal }).then(() => false, () => true);
  try {
    assert.equal(await promptly(started.promise), true);
    controller.abort();
    assert.equal(await canceled, true);
    assert.equal(await promptly(closed.promise), true, "cancel must close the upstream before its 10-second deadline");
    const next = await connection.client.callTool({ name: "deeplook_open", arguments: { url: page.requestedUrl } });
    assert.notEqual(next.isError, true);
  } finally { controller.abort(); await connection.close(); }
});

test("mcp client EOF aborts the upstream without requiring forced process termination", async () => {
  const started = event();
  const closed = event();
  const connection = await fixture((_request, response) => {
    response.once("close", closed.resolve);
    response.writeHead(200); response.write('{"text":'); started.resolve();
  });
  const pending = connection.client.callTool({ name: "deeplook_open",
    arguments: { url: page.requestedUrl, timeoutMs: 10_000 } }).catch(() => {});
  try {
    assert.equal(await promptly(started.promise), true);
    const closing = connection.client.close();
    assert.equal(await promptly(closed.promise), true, "EOF must abort before the SDK's forced-kill fallback");
    await closing;
  } finally { await connection.close(); await pending; }
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  test(`mcp ${signal} propagates cancellation and lets an owned subprocess exit`, { skip: process.platform === "win32" }, async () => {
    const directory = await mkdtemp(join(tmpdir(), "deeplook-mcp-shutdown-"));
    const host = join(directory, "host.mjs");
    const pidFile = join(directory, "child.pid");
    await writeFile(host, `import { runMcp } from ${JSON.stringify(new URL("./mcp.js", import.meta.url).href)};
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
await runMcp(async (_url, _timeout, signal) => {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));
  return new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => child.kill("SIGKILL"), { once: true });
    child.once("close", () => reject(new Error("Canceled")));
  });
});
`);
    let pid: number | undefined;
    const connection = await session({}, [host]);
    const pending = connection.client.callTool({ name: "deeplook_open", arguments: { url: page.requestedUrl } }).catch(() => {});
    try {
      for (let attempt = 0; attempt < 100; attempt++) {
        try { pid = Number(await readFile(pidFile, "utf8")); break; } catch { await delay(10); }
      }
      assert.ok(pid, "the page opener must have started its owned subprocess");
      process.kill(connection.transport.pid!, signal);
      let gone = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        try { process.kill(pid, 0); } catch { gone = true; break; }
        await delay(10);
      }
      assert.equal(gone, true, "shutdown must abort the opener so it can reap its owned subprocess");
    } finally {
      if (pid) { try { process.kill(pid, "SIGKILL"); } catch {} }
      await connection.close(); await pending;
      await rm(directory, { recursive: true, force: true });
    }
  });
}

async function fixture(handler: RequestListener) {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const connection = await session({ DEEPLOOK_API_URL: `http://127.0.0.1:${address.port}/prefix`,
    DEEPLOOK_API_TOKEN: "mcp-fixture-token" });
  return { ...connection, close: async () => {
    await connection.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  } };
}

const page = {
  requestedUrl: "https://example.com/article", finalUrl: "https://example.com/final",
  title: "Article", text: "A sourced article.", httpStatus: 200, truncated: false,
  observed: { webdriver: false, userAgent: "Chrome", brands: ["Chromium"], languages: ["en-US"],
    timezone: "UTC", viewport: { width: 1366, height: 768 } },
};

test("mcp remote read returns text and structured page through the authenticated API contract", async () => {
  const requests: unknown[] = [];
  const connection = await fixture(async (incoming, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
    requests.push({ method: incoming.method, path: incoming.url, auth: incoming.headers.authorization,
      body: JSON.parse(Buffer.concat(chunks).toString()) });
    response.end(JSON.stringify(page));
  });
  try {
    const result = await connection.client.callTool({ name: "deeplook_open", arguments: { url: page.requestedUrl } });
    assert.notEqual(result.isError, true);
    assert.deepEqual(result.content, [{ type: "text", text: page.text }]);
    assert.deepEqual(result.structuredContent, { version: 1, ok: true, page });
    assert.deepEqual(requests, [{ method: "POST", path: "/prefix/v1/open", auth: "Bearer mcp-fixture-token",
      body: { url: page.requestedUrl, timeoutMs: 30_000 } }]);
    assert.equal(connection.stderr(), "");
  } finally { await connection.close(); }
});

for (const [status, error] of [[401, "unauthorized"], [429, "quota_exceeded"], [503, "busy"],
  [422, "challenge"]] as const) {
  test(`mcp preserves API ${error} without reflected credentials`, async () => {
    const connection = await fixture((_request, response) => {
      response.writeHead(status).end(JSON.stringify({ error, message: "reflected mcp-fixture-token" }));
    });
    try {
      const result = await connection.client.callTool({ name: "deeplook_open", arguments: { url: page.requestedUrl } });
      assert.equal(result.isError, true);
      assert.equal((result.structuredContent as Record<string, unknown> | undefined)?.error, error);
      assert.equal(JSON.stringify(result).includes("mcp-fixture-token"), false);
    } finally { await connection.close(); }
  });
}

test("mcp suppresses credential-reflecting metadata on a locally rejected remote page", async () => {
  const connection = await fixture((_request, response) => response.end(JSON.stringify({ ...page,
    title: "mcp-fixture-token", finalUrl: "https://example.com/mcp-fixture-token", text: "" })));
  try {
    const result = await connection.client.callTool({ name: "deeplook_open", arguments: { url: page.requestedUrl } });
    assert.equal(result.isError, true);
    assert.equal((result.structuredContent as Record<string, unknown> | undefined)?.error, "empty_content");
    assert.equal(JSON.stringify(result).includes("mcp-fixture-token"), false);
  } finally { await connection.close(); }
});

test("mcp enforces the caller's deadline while reading an unfinished API body", async () => {
  const connection = await fixture((_request, response) => { response.writeHead(200); response.write('{"text":'); });
  try {
    const result = await connection.client.callTool({ name: "deeplook_open",
      arguments: { url: page.requestedUrl, timeoutMs: 100 } }, { timeout: 3_000 });
    assert.equal(result.isError, true);
    assert.equal((result.structuredContent as Record<string, unknown> | undefined)?.error, "timeout");
  } finally { await connection.close(); }
});

test("mcp retains the engine's local private destination protection", async () => {
  const connection = await session();
  try {
    const result = await connection.client.callTool({ name: "deeplook_open", arguments: { url: "http://127.0.0.1/" } });
    assert.equal(result.isError, true);
    assert.equal((result.structuredContent as Record<string, unknown> | undefined)?.error, "navigation_failed");
    assert.match(JSON.stringify(result.content), /public|private/i);
  } finally { await connection.close(); }
});

test("mcp rejects malformed inputs before contacting the API", async () => {
  let requests = 0;
  const connection = await fixture((_request, response) => { requests++; response.end(JSON.stringify(page)); });
  try {
    for (const args of [{}, { url: "not a URL" }, { url: "file:///etc/passwd" },
      { url: page.requestedUrl, timeoutMs: 0 }, { url: page.requestedUrl, timeoutMs: 120_001 },
      { url: page.requestedUrl, timeoutMs: 1.5 }, { url: page.requestedUrl, apiToken: "untrusted" }]) {
      const result = await connection.client.callTool({ name: "deeplook_open", arguments: args });
      assert.equal(result.isError, true, JSON.stringify(args));
    }
    assert.equal(requests, 0);
  } finally { await connection.close(); }
});

// Catches missing CLI routing, banners corrupting stdout, stale identity, or a
// server that negotiates successfully but advertises no callable page reader.
test("mcp negotiates stdio and advertises the page reader without Chrome", async () => {
  const connection = await session();
  try {
    const installed = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    assert.deepEqual(connection.client.getServerVersion(), { name: "deeplook", version: installed.version });
    const { tools } = await connection.client.listTools();
    assert.deepEqual(tools.map((tool) => tool.name), ["deeplook_open"]);
    assert.equal(tools[0].inputSchema.type, "object");
    assert.deepEqual(tools[0].inputSchema.required, ["url"]);
    assert.equal(connection.stderr(), "");
  } finally { await connection.close(); }
});
