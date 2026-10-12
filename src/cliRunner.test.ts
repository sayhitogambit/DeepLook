import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { runCli } from "./cliRunner.js";
import type { OpenedPage } from "./openPage.js";

const samplePage: OpenedPage = {
  requestedUrl: "https://example.com/",
  finalUrl: "https://example.com/article",
  httpStatus: 200,
  title: "Example article",
  text: "A useful article.",
  truncated: false,
  observed: {
    webdriver: false,
    userAgent: "Chrome",
    brands: [],
    languages: ["en-US"],
    timezone: "America/New_York",
    viewport: { width: 1366, height: 768 },
  },
};

function harness() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const signals = new EventEmitter();
  const io = {
    stdout: { write: (chunk: string) => { stdout.push(chunk); } },
    stderr: { write: (chunk: string) => { stderr.push(chunk); } },
    signals,
  };
  return { stdout, stderr, signals, io };
}

test("machine mode emits one versioned success envelope", async () => {
  const { stdout, stderr, io } = harness();
  const code = await runCli(
    ["node", "deeplook", "open", "https://example.com/", "--machine"],
    async () => samplePage,
    io,
  );
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(stdout.join("")), { version: 1, ok: true, page: samplePage });
  assert.deepEqual(stderr, []);
});

test("machine mode reports a challenge without returning its page text", async () => {
  const { stdout, stderr, io } = harness();
  const challenge = { ...samplePage, title: "Just a moment...", text: "Checking your browser. Secret challenge body." };
  const code = await runCli(
    ["node", "deeplook", "open", "https://example.com/", "--machine"],
    async () => challenge,
    io,
  );
  assert.equal(code, 1);
  assert.deepEqual(JSON.parse(stdout.join("")), {
    version: 1,
    ok: false,
    error: "challenge",
    message: "The site returned a bot check instead of the page.",
    finalUrl: challenge.finalUrl,
    title: challenge.title,
    marker: "just a moment",
  });
  assert.equal(stdout.join("").includes("Secret challenge body"), false);
  assert.deepEqual(stderr, []);
});

test("machine mode classifies upstream HTTP and timeout errors", async () => {
  const http = harness();
  const httpCode = await runCli(
    ["node", "deeplook", "open", "https://example.com/", "--machine"],
    async () => ({ ...samplePage, httpStatus: 403 }),
    http.io,
  );
  assert.equal(httpCode, 1);
  assert.deepEqual(JSON.parse(http.stdout.join("")), {
    version: 1,
    ok: false,
    error: "upstream_http",
    message: "Upstream returned HTTP 403.",
    finalUrl: samplePage.finalUrl,
    title: samplePage.title,
  });

  const timeout = harness();
  const timeoutCode = await runCli(
    ["node", "deeplook", "open", "https://example.com/", "--machine"],
    async () => { const error = new Error("Timeout 100ms exceeded"); error.name = "TimeoutError"; throw error; },
    timeout.io,
  );
  assert.equal(timeoutCode, 1);
  assert.deepEqual(JSON.parse(timeout.stdout.join("")), {
    version: 1,
    ok: false,
    error: "timeout",
    message: "Timeout 100ms exceeded",
  });
});

test("SIGTERM aborts the browser operation and waits for its cleanup", async () => {
  const { stdout, signals, io } = harness();
  let settle!: () => void;
  let observedSignal: AbortSignal | undefined;
  const pending = runCli(
    ["node", "deeplook", "open", "https://example.com/", "--machine"],
    async (_url, _timeoutMs, signal) => {
      observedSignal = signal;
      return new Promise<OpenedPage>((_resolve, reject) => {
        settle = () => reject(new Error("Browser request was canceled."));
      });
    },
    io,
  );
  await Promise.resolve();
  signals.emit("SIGTERM");
  assert.equal(observedSignal?.aborted, true);
  assert.equal(signals.listenerCount("SIGTERM"), 1);
  settle();
  assert.equal(await pending, 1);
  assert.equal(signals.listenerCount("SIGTERM"), 0);
  assert.equal(signals.listenerCount("SIGINT"), 0);
  assert.equal(JSON.parse(stdout.join("")).error, "navigation_failed");
});
