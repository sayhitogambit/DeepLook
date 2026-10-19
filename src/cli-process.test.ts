import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type RequestListener } from "node:http";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { browserEnvironment } from "./runtimeEnvironment.js";

async function cli(args: string[], env: NodeJS.ProcessEnv = {}, deadlineMs = 15_000) {
  const child = spawn(process.execPath, [fileURLToPath(new URL("./cli.js", import.meta.url)), ...args], {
    env: { ...browserEnvironment(), DEEPLOOK_CHROME: "/deeplook-test/no-chrome", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  const timer = setTimeout(() => child.kill("SIGKILL"), deadlineMs);
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    return { code, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") };
  } finally { clearTimeout(timer); }
}

async function apiFixture(handler: RequestListener) {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}

const remotePage = {
  requestedUrl: "https://example.com/article", finalUrl: "https://example.com/final",
  title: "Remote article", text: "Sourced remote page", httpStatus: 200, truncated: false,
  observed: { webdriver: false, userAgent: "Chrome", brands: ["Chromium"], languages: ["en-US"],
    timezone: "UTC", viewport: { width: 1366, height: 768 } },
};

// Catches a missing version command, a stale hard-coded version, or an
// accidental browser launch for an informational command.
test("--version reports the installed package version without needing Chrome", async () => {
  const installed = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const result = await cli(["--version"]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, `${installed.version}\n`);
  assert.equal(result.stderr, "");
});

// Catches silent success when the configured browser executable is missing.
test("doctor reports a missing local browser as a failed JSON check", async () => {
  const result = await cli(["doctor", "--json"]);
  assert.equal(result.code, 1);
  assert.equal(result.stderr, "");
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.mode, "local");
  assert.deepEqual(report.checks.map((check: { name: string; ok: boolean }) => ({ name: check.name, ok: check.ok })),
    [{ name: "browser", ok: false }]);
});

// Catches a diagnostic that only checks the file exists without probing the
// executable, passes the wrong arguments, or leaks the calling API secret.
test("doctor probes the configured browser executable without inherited secrets", { skip: process.platform === "win32" }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "deeplook doctor "));
  const executable = join(directory, "browser fixture");
  await writeFile(executable, `#!/bin/sh
if [ "$#" -ne 1 ] || [ "$1" != '--version' ]; then exit 42; fi
if [ -n "\${DEEPLOOK_ADMIN_TOKEN:-}" ]; then exit 43; fi
printf '%s\\n' 'Chromium 155.0.0.0'
`, { mode: 0o755 });
  try {
    const result = await cli(["doctor", "--json"], {
      DEEPLOOK_CHROME: executable, DEEPLOOK_ADMIN_TOKEN: "fixture-only-secret",
    });
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.equal(result.stderr, "");
    const report = JSON.parse(result.stdout);
    assert.equal(report.ok, true);
    assert.equal(report.mode, "local");
    assert.equal(report.checks[0].version, "Chromium 155.0.0.0");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("doctor rejects a configured executable that is not Chrome", async () => {
  const result = await cli(["doctor", "--json"], { DEEPLOOK_CHROME: process.execPath });
  assert.equal(result.code, 1);
  assert.equal(result.stderr, "");
  assert.equal(JSON.parse(result.stdout).checks[0].ok, false);
});

test("doctor terminates a browser version probe that stalls", { skip: process.platform === "win32" }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "deeplook-doctor-stall-"));
  const executable = join(directory, "stalled-browser");
  await writeFile(executable, "#!/bin/sh\nexec sleep 10\n", { mode: 0o755 });
  try {
    const started = Date.now();
    const result = await cli(["doctor", "--json"], { DEEPLOOK_CHROME: executable });
    assert.equal(result.code, 1);
    assert.equal(result.stderr, "");
    assert.equal(JSON.parse(result.stdout).ok, false);
    assert.ok(Date.now() - started < 8_000, "doctor must not wait for a stuck executable indefinitely");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("doctor terminates a version probe even when it ignores SIGTERM", { skip: process.platform === "win32" }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "deeplook-doctor-resistant-"));
  const executable = join(directory, "resistant-browser.mjs");
  const pidFile = join(directory, "probe.pid");
  await writeFile(executable, `#!${process.execPath}
import { writeFileSync } from "node:fs";
process.on("SIGTERM", () => {});
writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
setInterval(() => {}, 1000);
`, { mode: 0o755 });
  try {
    const result = await cli(["doctor", "--json"], { DEEPLOOK_CHROME: executable }, 6_000);
    assert.equal(result.code, 1, "doctor must return without requiring the caller to kill it");
    assert.equal(result.stderr, "");
    assert.equal(JSON.parse(result.stdout).ok, false);
  } finally {
    try { process.kill(Number(await readFile(pidFile, "utf8")), "SIGKILL"); }
    catch (error) { if (!["ENOENT", "ESRCH"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error; }
    await rm(directory, { recursive: true, force: true });
  }
});

// Catches silently falling back to local Chrome, a wrong API route, a lost
// credential, or a request body incompatible with POST /v1/open.
test("remote open sends the API contract and needs no local Chrome", async () => {
  let request: unknown;
  const server = await apiFixture(async (incoming, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
    request = { method: incoming.method, path: incoming.url, authorization: incoming.headers.authorization,
      body: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(remotePage));
  });
  try {
    const result = await cli(["open", "https://example.com/article", "--machine", "--timeout-ms", "5000"], {
      DEEPLOOK_API_URL: `${server.endpoint}/prefix`, DEEPLOOK_API_TOKEN: "fixture-api-token",
    });
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), { version: 1, ok: true, page: remotePage });
    assert.deepEqual(request, { method: "POST", path: "/prefix/v1/open", authorization: "Bearer fixture-api-token",
      body: { url: "https://example.com/article", timeoutMs: 5000 } });
  } finally { await server.close(); }
});

for (const [status, error] of [[400, "invalid_request"], [401, "unauthorized"], [422, "challenge"],
  [422, "access_wall"], [422, "empty_content"], [429, "quota_exceeded"], [503, "busy"], [504, "timeout"]] as const) {
  test(`remote open preserves ${error} without printing server-reflected credentials`, async () => {
    const secret = "fixture-reflected-token";
    const server = await apiFixture((_request, response) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify({ error, message: `Failure including ${secret}` }));
    });
    try {
      const result = await cli(["open", "https://example.com/article", "--machine"], {
        DEEPLOOK_API_URL: server.endpoint, DEEPLOOK_API_TOKEN: secret,
      });
      assert.equal(result.code, 1);
      assert.equal(JSON.parse(result.stdout).error, error);
      assert.equal(result.stderr, "");
      assert.equal((result.stdout + result.stderr).includes(secret), false);
    } finally { await server.close(); }
  });
}

for (const [error, text, httpStatus] of [["empty_content", "", 200],
  ["challenge", "Please verify you are a human", 200],
  ["access_wall", "Click the button below to continue shopping Continue shopping", 200],
  ["upstream_http", "Upstream service failed", 503]] as const) {
  test(`remote page classified as ${error} omits credential-reflecting metadata`, async () => {
    const secret = "fixture-page-reflected-token";
    const server = await apiFixture((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ...remotePage, text, httpStatus,
        title: secret, finalUrl: `https://example.com/?reflected=${secret}` }));
    });
    try {
      const result = await cli(["open", "https://example.com/article", "--machine"], {
        DEEPLOOK_API_URL: server.endpoint, DEEPLOOK_API_TOKEN: secret,
      });
      assert.equal(result.code, 1);
      assert.equal(JSON.parse(result.stdout).error, error);
      assert.equal(result.stderr, "");
      assert.equal((result.stdout + result.stderr).includes(secret), false,
        "remote page metadata must not expose the credential on a failure");
    } finally { await server.close(); }
  });
}

test("remote open applies its deadline while reading an unfinished response body", async () => {
  const server = await apiFixture((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.write('{"title":"never finishes');
  });
  try {
    const result = await cli(["open", "https://example.com/article", "--machine", "--timeout-ms", "100"], {
      DEEPLOOK_API_URL: server.endpoint,
    });
    assert.equal(result.code, 1);
    assert.equal(JSON.parse(result.stdout).error, "timeout");
  } finally { await server.close(); }
});

for (const endpoint of ["http://example.com/", "ftp://localhost/", "https://fixture-token@localhost/",
  "https://localhost/?key=fixture-token", "https://localhost/#fixture-token"]) {
  test(`remote endpoint rejects unsafe configuration ${endpoint.split(":")[0]}`, async () => {
    const result = await cli(["open", "https://example.com/article", "--machine"], {
      DEEPLOOK_API_URL: endpoint, DEEPLOOK_API_TOKEN: "fixture-token",
    });
    assert.equal(result.code, 1);
    assert.equal(JSON.parse(result.stdout).error, "invalid_request");
    assert.equal((result.stdout + result.stderr).includes("fixture-token"), false);
  });
}

test("remote HTTPS endpoint requires a token before attempting a connection", async () => {
  const result = await cli(["open", "https://example.com/article", "--machine"], {
    DEEPLOOK_API_URL: "https://api.example.invalid/",
  });
  assert.equal(result.code, 1);
  assert.equal(JSON.parse(result.stdout).error, "unauthorized");
});

for (const body of ["not JSON", "{}", JSON.stringify({ ...remotePage, text: 42 }),
  JSON.stringify({ ...remotePage, observed: { ...remotePage.observed, viewport: { width: "wide", height: 768 } } }),
  JSON.stringify({ ...remotePage, text: "x".repeat(2_100_000) })]) {
  test(`remote open rejects malformed or oversized success (${body.length} bytes)`, async () => {
    let received = 0;
    const server = await apiFixture((_request, response) => {
      received++;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(body);
    });
    try {
      const result = await cli(["open", "https://example.com/article", "--machine"], { DEEPLOOK_API_URL: server.endpoint });
      assert.equal(received, 1);
      assert.equal(result.code, 1);
      assert.equal(JSON.parse(result.stdout).error, "navigation_failed");
    } finally { await server.close(); }
  });
}

test("remote open does not follow an API redirect with its bearer credential", async () => {
  const paths: string[] = [];
  const server = await apiFixture((request, response) => {
    paths.push(request.url ?? "");
    if (request.url === "/v1/open") {
      response.writeHead(302, { location: "/redirected" });
      response.end();
    } else {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(remotePage));
    }
  });
  try {
    const result = await cli(["open", "https://example.com/article", "--machine"], {
      DEEPLOOK_API_URL: server.endpoint, DEEPLOOK_API_TOKEN: "fixture-token",
    });
    assert.deepEqual(paths, ["/v1/open"]);
    assert.equal(result.code, 1);
    assert.equal(JSON.parse(result.stdout).error, "navigation_failed");
  } finally { await server.close(); }
});

test("doctor checks the configured API health route without needing local Chrome", async () => {
  let request: unknown;
  const server = await apiFixture((incoming, response) => {
    request = { method: incoming.method, path: incoming.url, authorization: incoming.headers.authorization };
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"ok":true}');
  });
  try {
    const result = await cli(["doctor", "--json"], {
      DEEPLOOK_API_URL: `${server.endpoint}/prefix/`, DEEPLOOK_API_TOKEN: "fixture-health-token",
    });
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.equal(result.stderr, "");
    const report = JSON.parse(result.stdout);
    assert.equal(report.ok, true);
    assert.equal(report.mode, "remote");
    assert.equal(report.checks[0].name, "api");
    assert.deepEqual(request, { method: "GET", path: "/prefix/health", authorization: "Bearer fixture-health-token" });
  } finally { await server.close(); }
});

for (const body of ['{"ok":false}', '{}', 'not JSON']) {
  test(`doctor rejects an unhealthy or malformed API health reply: ${body}`, async () => {
    let received = 0;
    const server = await apiFixture((_request, response) => {
      received++;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(body);
    });
    try {
      const result = await cli(["doctor", "--json"], { DEEPLOOK_API_URL: server.endpoint });
      assert.equal(received, 1);
      assert.equal(result.code, 1);
      assert.equal(JSON.parse(result.stdout).mode, "remote");
      assert.equal(JSON.parse(result.stdout).ok, false);
    } finally { await server.close(); }
  });
}

test("doctor hides token-bearing API configuration errors in its diagnostic report", async () => {
  const result = await cli(["doctor", "--json"], {
    DEEPLOOK_API_URL: "https://fixture-secret@api.example.invalid/", DEEPLOOK_API_TOKEN: "fixture-secret",
  });
  assert.equal(result.code, 1);
  assert.equal(result.stderr, "");
  assert.equal(JSON.parse(result.stdout).mode, "remote");
  assert.equal((result.stdout + result.stderr).includes("fixture-secret"), false);
});

test("doctor rejects unknown flags before probing an executable", async () => {
  const result = await cli(["doctor", "--json", "--unknown"]);
  assert.equal(result.code, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /unknown|usage/i);
});
