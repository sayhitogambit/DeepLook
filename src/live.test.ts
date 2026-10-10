import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import type { Server } from "node:http";
import test from "node:test";

import type { OpenedPage } from "./openPage.js";
import { openPage } from "./openPage.js";
import { resolveChromeExecutable } from "./profile.js";
import { createApiServer } from "./server.js";

async function chromeIsAvailable(): Promise<boolean> {
  try {
    await access(await resolveChromeExecutable(), constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error !== undefined) reject(error);
      else resolve();
    });
  });
}

test("live open of example.com through POST /v1/open", async (t) => {
  if (!(await chromeIsAvailable())) {
    t.skip("Chrome is not installed");
    return;
  }
  const server = createApiServer(openPage);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Live server did not bind a port.");
  }
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/v1/open`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com", timeoutMs: 30_000 }),
    });
    assert.equal(response.status, 200);
    const page = (await response.json()) as OpenedPage;
    assert.equal(page.finalUrl, "https://example.com/");
    assert.equal(page.title, "Example Domain");
    assert.match(page.text, /documentation examples/);
    assert.equal(page.observed.webdriver, false);
    assert.match(page.observed.userAgent, /Chrome\/\d+/);
    assert.equal(page.observed.userAgent.includes("HeadlessChrome"), false);
    assert.equal(page.observed.timezone, "America/New_York");
    assert.deepEqual(page.observed.viewport, { width: 1366, height: 768 });
    assert.ok(page.observed.languages.includes("en-US"));
  } finally {
    await close(server);
  }
});
