import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { browserEnvironment } from "./runtimeEnvironment.js";

// The SDK disposes a discovery instance when pinning a legacy session on the
// same pipe. That disposal must not cancel the process or remove its handlers.
test("discovery-to-legacy fallback preserves reads and process shutdown cleanup", { skip: process.platform === "win32" }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "deeplook-mcp-fallback-"));
  const host = join(directory, "host.mjs");
  const pidFile = join(directory, "child.pid");
  await writeFile(host, `import { runMcp } from ${JSON.stringify(new URL("./mcp.js", import.meta.url).href)};
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
await runMcp(async (url, _timeout, signal) => {
  await delay(25);
  signal.throwIfAborted();
  if (url.endsWith("/article")) return { requestedUrl: url, finalUrl: url, title: "Article", text: "Readable page", truncated: false,
    observed: { webdriver: false, userAgent: "Chrome", brands: [], languages: ["en-US"], timezone: "UTC", viewport: { width: 1366, height: 768 } } };
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));
  return new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => child.kill("SIGKILL"), { once: true });
    child.once("close", () => reject(new Error("Canceled")));
  });
});
`);
  const transport = new StdioClientTransport({ command: process.execPath, args: [host],
    env: browserEnvironment(), stderr: "pipe" });
  const replies = new Map<number, (reply: Record<string, unknown>) => void>();
  transport.onmessage = (message) => {
    if ("id" in message && typeof message.id === "number") replies.get(message.id)?.(message);
  };
  const request = async (id: number, method: string, params: Record<string, unknown>) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await new Promise<Record<string, unknown>>((resolve, reject) => {
        replies.set(id, resolve);
        timer = setTimeout(() => reject(new Error(`No response to ${method}`)), 3_000);
        void transport.send({ jsonrpc: "2.0", id, method, params }).catch(reject);
      });
    } finally { clearTimeout(timer); replies.delete(id); }
  };
  let pid: number | undefined;
  try {
    await transport.start();
    const discovery = await request(1, "server/discover", { _meta: {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientInfo": { name: "fallback-test", version: "1" },
      "io.modelcontextprotocol/clientCapabilities": {},
    } });
    assert.equal(discovery.error, undefined);
    const initialized = await request(2, "initialize", { protocolVersion: "2025-11-25", capabilities: {},
      clientInfo: { name: "fallback-test", version: "1" } });
    assert.equal(initialized.error, undefined);
    await transport.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    const read = await request(3, "tools/call", { name: "deeplook_open", arguments: { url: "https://example.com/article" } });
    const result = read.result as { structuredContent: { ok: boolean }; content: unknown };
    assert.equal(result.structuredContent.ok, true, "discarding a discovery instance must not cancel the active session");
    assert.deepEqual(result.content, [{ type: "text", text: "Readable page" }]);
    await transport.send({ jsonrpc: "2.0", id: 4, method: "tools/call",
      params: { name: "deeplook_open", arguments: { url: "https://example.com/wait" } } });
    for (let attempt = 0; attempt < 100; attempt++) {
      try { pid = Number(await readFile(pidFile, "utf8")); break; } catch { await delay(10); }
    }
    assert.ok(pid, "the replacement session must start its owned subprocess");
    process.kill(transport.pid!, "SIGTERM");
    let gone = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { process.kill(pid, 0); } catch { gone = true; break; }
      await delay(10);
    }
    assert.equal(gone, true, "signal cleanup must remain registered after protocol fallback");
  } finally {
    if (pid) { try { process.kill(pid, "SIGKILL"); } catch {} }
    await transport.close();
    await rm(directory, { recursive: true, force: true });
  }
});
