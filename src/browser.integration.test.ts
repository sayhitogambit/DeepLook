import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import type { Socket } from "node:net";
import test from "node:test";
import { chromium, type BrowserServer } from "playwright-core";

import { runCli } from "./cliRunner.js";
import { createPageOpener } from "./openPage.js";

const enabled = process.env.DEEPLOOK_TEST_BROWSER === "1";

// Only this test injects a proxy serving local fixtures under a public-shaped
// URL. Production still validates and pins every destination in the safe proxy.
async function fixture(html: string) {
  const sockets = new Set<Socket>();
  const proxy = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(html);
  });
  proxy.on("connection", (socket) => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  const address = proxy.address();
  assert.ok(address && typeof address !== "string");
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) => proxy.close((error) => error ? reject(error) : resolve()));
  };
  let server: BrowserServer | undefined;
  const open = createPageOpener({
    validateUrl: async (url) => ({ url: new URL(url), address: "93.184.216.34", port: 80 }),
    startProxy: async () => ({ url: `http://127.0.0.1:${address.port}`, close }),
    launch: async (options) => {
      assert.equal(options?.chromiumSandbox, true);
      server = await chromium.launchServer(options);
      assert.equal(server.process().spawnargs.includes("--no-sandbox"), false);
      return server;
    },
  });
  return { open, close, assertClosed: () => {
    assert.equal(closed, true);
    assert.ok(server);
    assert.ok(server.process().exitCode !== null || server.process().signalCode !== null);
  } };
}

test("real sandboxed Chrome extracts rendered text and closes its process", { skip: !enabled, timeout: 15_000 }, async () => {
  const session = await fixture('<title>Fixture</title><body><script>document.body.append("Rendered by JavaScript")</script></body>');
  try {
    const page = await session.open("http://fixture.example/", 10_000);
    assert.equal(page.title, "Fixture");
    assert.equal(page.text, "Rendered by JavaScript");
    assert.equal(page.observed.webdriver, false);
    session.assertClosed();
  } finally { await session.close(); }
});

test("real CLI workflow rejects a rendered human challenge", { skip: !enabled, timeout: 15_000 }, async () => {
  const session = await fixture('<title>Robot or human?</title><body>Activate and hold the button to confirm that you are human.</body>');
  const stdout: string[] = [];
  try {
    const code = await runCli(["node", "deeplook", "open", "http://fixture.example/", "--machine"], session.open, {
      stdout: { write: (text) => stdout.push(text) }, stderr: { write: () => undefined }, signals: new EventEmitter(),
    });
    assert.equal(code, 1);
    assert.equal(JSON.parse(stdout.join("")).error, "challenge");
    assert.equal(stdout.join("").includes("Activate and hold"), false);
    session.assertClosed();
  } finally { await session.close(); }
});

test("total deadline interrupts renderer-stalled extraction and kills Chrome", { skip: !enabled, timeout: 12_000 }, async () => {
  const session = await fixture(`<title>Stalled extraction</title><body>Visible
    <script>Object.defineProperty(document.body, 'innerText', {get() {while (true) {}}});</script></body>`);
  try {
    const started = Date.now();
    await assert.rejects(session.open("http://fixture.example/", 3_000), { name: "TimeoutError" });
    assert.ok(Date.now() - started < 8_000, "work deadline plus process cleanup must stay bounded");
    session.assertClosed();
  } finally { await session.close(); }
});
