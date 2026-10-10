import assert from "node:assert/strict";
import type { Server } from "node:http";
import test from "node:test";

import { challengeMarker } from "./challenge.js";
import type { OpenedPage } from "./openPage.js";
import { createApiServer, type PageOpener } from "./server.js";

function samplePage(overrides: Partial<OpenedPage> = {}): OpenedPage {
  return {
    requestedUrl: "https://example.com",
    finalUrl: "https://example.com/",
    title: "Example Domain",
    text: "Example Domain\nThis domain is for use in illustrative examples.",
    truncated: false,
    observed: {
      webdriver: false,
      userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
      brands: ["Chromium", "Google Chrome"],
      languages: ["en-US"],
      timezone: "America/New_York",
      viewport: { width: 1366, height: 768 },
    },
    ...overrides,
  };
}

async function listen(open: PageOpener): Promise<{ server: Server; base: string }> {
  const server = createApiServer(open);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Test server did not bind a port.");
  }
  return { server, base: `http://127.0.0.1:${address.port}` };
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error !== undefined) reject(error);
      else resolve();
    });
  });
}

test("health reports liveness", async () => {
  const { server, base } = await listen(async () => samplePage());
  try {
    const response = await fetch(`${base}/health`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
    assert.deepEqual(await response.json(), { ok: true });
  } finally {
    await close(server);
  }
});

test("open returns the page facts from the browser", async () => {
  let seen: { url: string; timeoutMs: number } | undefined;
  const page = samplePage();
  const { server, base } = await listen(async (url, timeoutMs) => {
    seen = { url, timeoutMs };
    return page;
  });
  try {
    const response = await fetch(`${base}/v1/open`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com", timeoutMs: 15_000 }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), page);
    assert.deepEqual(seen, { url: "https://example.com", timeoutMs: 15_000 });
  } finally {
    await close(server);
  }
});

test("open defaults the timeout and rejects a bad request", async () => {
  let seenTimeout = 0;
  const { server, base } = await listen(async (_url, timeoutMs) => {
    seenTimeout = timeoutMs;
    return samplePage();
  });
  try {
    const ok = await fetch(`${base}/v1/open`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com" }),
    });
    assert.equal(ok.status, 200);
    assert.equal(seenTimeout, 30_000);

    const missing = await fetch(`${base}/v1/open`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(missing.status, 400);
    assert.equal((await missing.json()).error, "invalid_request");

    const fileUrl = await fetch(`${base}/v1/open`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "file:///etc/passwd" }),
    });
    assert.equal(fileUrl.status, 400);

    const badTimeout = await fetch(`${base}/v1/open`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com", timeoutMs: 0 }),
    });
    assert.equal(badTimeout.status, 400);

    const broken = await fetch(`${base}/v1/open`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    assert.equal(broken.status, 400);
  } finally {
    await close(server);
  }
});

test("navigation failures and timeouts stay distinct", async () => {
  const { server, base } = await listen(async (url) => {
    if (url.endsWith("/slow")) {
      const error = new Error("page.goto: Timeout 30000ms exceeded.");
      error.name = "TimeoutError";
      throw error;
    }
    throw new Error("page.goto: net::ERR_NAME_NOT_RESOLVED");
  });
  try {
    const failed = await fetch(`${base}/v1/open`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.invalid" }),
    });
    assert.equal(failed.status, 502);
    const failedBody = (await failed.json()) as { error: string; message: string };
    assert.equal(failedBody.error, "navigation_failed");
    assert.match(failedBody.message, /ERR_NAME_NOT_RESOLVED/);

    const timedOut = await fetch(`${base}/v1/open`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.invalid/slow" }),
    });
    assert.equal(timedOut.status, 504);
    assert.equal((await timedOut.json()).error, "timeout");
  } finally {
    await close(server);
  }
});

test("a challenge page is an error and its body is not returned", async () => {
  const secret = "checking-token-do-not-echo";
  const { server, base } = await listen(async () =>
    samplePage({
      title: "Just a moment...",
      text: `Checking your browser ${secret}`,
    }),
  );
  try {
    const response = await fetch(`${base}/v1/open`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com" }),
    });
    assert.equal(response.status, 422);
    const body = (await response.json()) as {
      error: string;
      message: string;
      title: string;
      marker: string;
      text?: string;
    };
    assert.equal(body.error, "challenge");
    assert.equal(body.title, "Just a moment...");
    assert.equal(body.marker, "just a moment");
    assert.equal(body.text, undefined);
    assert.equal(JSON.stringify(body).includes(secret), false);
  } finally {
    await close(server);
  }
});

test("unknown routes are not found", async () => {
  const { server, base } = await listen(async () => samplePage());
  try {
    const response = await fetch(`${base}/v1/search`, { method: "POST" });
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error, "not_found");
  } finally {
    await close(server);
  }
});

test("challenge detection ignores a long article that mentions the phrase", () => {
  const article = `${"word ".repeat(800)} just a moment in a sentence.`;
  assert.equal(challengeMarker("Web browser", article), undefined);
  assert.equal(challengeMarker("Just a moment...", "hello"), "just a moment");
  assert.equal(
    challengeMarker("Example", "Our systems have detected unusual traffic from your computer."),
    "unusual traffic",
  );
});
