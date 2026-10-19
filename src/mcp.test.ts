import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer, type RequestListener } from "node:http";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { browserEnvironment } from "./runtimeEnvironment.js";

async function session(env: Record<string, string> = {}) {
  const client = new Client({ name: "deeplook-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath, args: [fileURLToPath(new URL("./cli.js", import.meta.url)), "mcp"],
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
