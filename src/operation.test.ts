import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import test from "node:test";

import { createPageOpener } from "./openPage.js";
import { Operation, OperationTimeoutError } from "./operation.js";
import { browserEnvironment } from "./runtimeEnvironment.js";
import { parseCommand } from "./command.js";

test("total deadline covers stalled DNS before launching a browser", async () => {
  let launched = false;
  const open = createPageOpener({
    validateUrl: () => new Promise(() => undefined),
    launch: async () => { launched = true; throw new Error("must not launch"); },
  });
  await assert.rejects(open("https://example.com/", 20), OperationTimeoutError);
  assert.equal(launched, false);
});

test("canceling proxy startup disposes a late proxy and does not launch Chrome", async () => {
  const controller = new AbortController();
  let ready!: (value: { url: string; close: () => Promise<void> }) => void;
  let started!: () => void;
  const proxyStarted = new Promise<void>((resolve) => { started = resolve; });
  let closed = false;
  const open = createPageOpener({
    validateUrl: async () => ({ url: new URL("https://example.com/"), address: "93.184.216.34", port: 443 }),
    startProxy: () => { started(); return new Promise((resolve) => { ready = resolve; }); },
  });
  const pending = open("https://example.com/", 1_000, controller.signal);
  await proxyStarted;
  const rejected = assert.rejects(pending, /canceled by test/);
  controller.abort(new Error("canceled by test"));
  await rejected;
  ready({ url: "http://127.0.0.1:1", close: async () => { closed = true; } });
  await setImmediate();
  assert.equal(closed, true);
});

test("operation cleanup is reverse acquisition order even if one resource fails", async () => {
  const operation = new Operation(1_000);
  const closed: string[] = [];
  await operation.acquire(Promise.resolve("proxy"), async (name) => { closed.push(name); });
  await operation.acquire(Promise.resolve("browser"), async (name) => { closed.push(name); throw new Error("close failed"); });
  await assert.rejects(operation.close(), /clean up/);
  assert.deepEqual(closed, ["browser", "proxy"]);
});

test("invalid timeouts are rejected consistently by CLI and motor", async () => {
  for (const timeoutMs of [0, -1, 120_001, 1.5, Infinity, NaN]) {
    assert.equal(parseCommand(["node", "deeplook", "open", "https://example.com/", "--timeout-ms", String(timeoutMs)]).kind, "error");
    await assert.rejects(createPageOpener()("https://example.com/", timeoutMs), /timeoutMs/);
  }
});

test("browser environment excludes secrets, Node injection and inherited proxy settings", () => {
  assert.deepEqual(browserEnvironment({
    PATH: "/usr/bin", HOME: "/home/browser", LANG: "en_US.UTF-8",
    MIMO_API_KEY: "test-only", DEEPLOOK_ADMIN_TOKEN: "test-only", AWS_SECRET_ACCESS_KEY: "test-only",
    NODE_OPTIONS: "--require malicious.js", HTTPS_PROXY: "http://user:password@proxy.invalid", RANDOM_SECRET: "test-only",
  }), { PATH: "/usr/bin", HOME: "/home/browser", LANG: "en_US.UTF-8" });
});
