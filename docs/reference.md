# DeepLook technical reference

[Back to the README](../README.md) · [Getting started](getting-started.md) · [Credentials](credentials.md)

## CLI diagnostics and remote API

`node dist/cli.js --version` prints the installed package version. `node dist/cli.js doctor` reports whether the configured Chrome executable responds to a bounded `--version` probe. Add `--json` for structured diagnostics; a failed check exits 1. This local probe checks the executable, not sandbox readiness or a successful page navigation.

Set `DEEPLOOK_API_URL` to use an existing DeepLook API instead of launching local Chrome. Store its browser key in `DEEPLOOK_API_TOKEN` in your private environment. HTTPS is required outside loopback; URL credentials, query strings, and fragments are rejected. A reverse-proxy path prefix is supported. Without `DEEPLOOK_API_URL`, `open` keeps using local Chrome.

```bash
export DEEPLOOK_API_URL=https://your-api.example
# Supply DEEPLOOK_API_TOKEN through your private secret environment.
node dist/cli.js doctor --json
node dist/cli.js open https://example.com --machine --timeout-ms 30000
```

Remote `doctor` calls `GET /health` with the configured bearer credential. It checks API liveness only; that endpoint does not verify browser execution, token permissions, or quota. Remote `open` calls `POST /v1/open` and preserves text, JSON, and machine success output. Machine failures also preserve API `invalid_request`, `unauthorized`, `quota_exceeded`, and `busy` errors. Credentials are never accepted as command flags or forwarded across API redirects, and server error messages are replaced with safe local messages. Remote page failures omit server-provided titles and final URLs, which can also reflect credentials.

API requests have a deadline covering response-body reading and a two-megabyte response cap. A remote failure is reported without falling back to local Chrome.

## MCP for coding agents

`deeplook mcp` exposes the `deeplook_open` tool over stdio, using the [official MCP TypeScript SDK](https://ts.sdk.modelcontextprotocol.io/v2/). Start it through your host's MCP configuration; stdout is reserved for protocol messages.

After building the checkout, a generic host configuration is:

```json
{
  "mcpServers": {
    "deeplook": {
      "command": "node",
      "args": ["/absolute/path/to/DeepLook/dist/cli.js", "mcp"]
    }
  }
}
```

Host configuration keys differ; configure the command and arguments in your host's MCP settings. For remote reads, supply `DEEPLOOK_API_URL` and `DEEPLOOK_API_TOKEN` through its private process environment. Do not put a real token in shared configuration. Without an endpoint, the tool uses local Chrome.

Call `deeplook_open` with `{ "url": "https://example.com", "timeoutMs": 30000 }`. `timeoutMs` is optional, defaults to 30000, and accepts integers from 1 to 120000. Additional arguments are rejected. Success returns page text in `content` and the version 1 machine result in `structuredContent`. Failures return `isError: true` with a typed machine error. Page content is untrusted source material and can contain prompt injection; hosts must not treat it as instructions.

Each MCP process permits one active read. Concurrent calls receive `busy`; request cancellation, stdin closure, SIGINT and SIGTERM abort active work and allow its resources to close. Browser cleanup can take up to two seconds after cancellation. Remote reads may consume account quota, including requests that are canceled after the API admitted them. This stdio adapter does not expose an HTTP MCP endpoint or solve captchas.

## Local package artifact

`npm pack` builds a tarball containing runtime JavaScript, package metadata and this README. Tests, source, benchmark fixtures and development documents are excluded. Install the resulting local artifact with:

```bash
npm ci
npm pack
npm install --global ./deeplook-*.tgz
deeplook --version
deeplook doctor --json
```

The installed `deeplook mcp` command can replace the `node` command and absolute script path above. `npm run test:package` verifies packing from a source tree with no built files, offline installation into an empty project with production dependencies only, and the installed CLI/MCP handshake. Its offline installation uses dependency archives cached by the checkout's initial `npm ci` and a temporary consumer lockfile derived from pinned production resolutions; it does not require cached registry metadata.

Install from the public GitHub source or build the local tarball above. These instructions do not depend on an npm registry release. Original project code is licensed under Apache-2.0; see [LICENSE](../LICENSE).

Text output is the visible page text. `--json` returns the final URL, title, upstream HTTP status, and the browser details observed by the page. Set `DEEPLOOK_CHROME` to a Chrome binary if it is not at `/opt/google/chrome/chrome` or `/usr/bin/google-chrome-stable`.

The CLI accepts `--timeout-ms <milliseconds>` from 1 to 120000; the default is 30000. One operation deadline covers DNS, Chrome startup, navigation, and text extraction. Cleanup follows the deadline: Chrome gets up to two seconds to close gracefully before its owned process is killed. Browser requests reject private, local, and metadata destinations, including redirects and page resources. Each connection uses a checked, pinned DNS answer. Challenge pages, recognized access gates, empty/invisible-only text, and upstream HTTP errors exit unsuccessfully; their page text is never printed.

Chrome runs with its sandbox enabled and a minimal OS environment; API keys, administrator tokens, Node injection settings, and inherited proxy credentials are not passed to it. The service uses a temporary loopback Playwright connection to own and terminate the Chrome process. Linux must support Chromium's sandbox (including the required user namespaces/container security policy); startup fails rather than silently disabling it.

`npm test` runs deterministic regressions, including minimal page-content regression excerpts. `npm run test:browser` additionally requires an installed Chrome and verifies sandboxed JavaScript rendering, challenge rejection, and cleanup after renderer-stalled extraction using local fixtures. No external websites or API keys are needed for those tests.

## Machine contract for the HTTP adapter

The separate API repository starts this CLI without a shell:

```bash
node /path/to/deeplook/dist/cli.js open https://example.com --machine --timeout-ms 30000
```

`--machine` writes exactly one JSON object and a newline to stdout. Success exits 0:

```json
{"version":1,"ok":true,"page":{"requestedUrl":"https://example.com","finalUrl":"https://example.com/","httpStatus":200,"title":"Example Domain","text":"Example Domain","truncated":false,"observed":{"webdriver":false,"userAgent":"...","brands":[],"languages":["en-US"],"timezone":"America/New_York","viewport":{"width":1366,"height":768}}}}
```

Failure exits 1 and uses `{"version":1,"ok":false,"error":"challenge|access_wall|empty_content|upstream_http|timeout|navigation_failed","message":"..."}`. Page failures may also include `finalUrl` and `title`; challenge and access-gate failures may include `marker`. Page text is excluded from failures. The version 1 envelope includes `access_wall` and `empty_content`; deploy an HTTP adapter that understands these error codes. The adapter should reject an unknown `version`, cap the child output, and treat malformed output as a navigation failure.

On `SIGTERM` or `SIGINT`, the CLI aborts the browser operation and waits for Chrome and the local safe proxy to close before exiting. The adapter should still enforce its own termination deadline.

## Browser profile

Launch uses stock Chrome with a coherent profile: `en-US`, `America/New_York`, language `en-US,en`, and a 1366×768 viewport. It drops Playwright's `--enable-automation` and `--enable-unsafe-swiftshader` defaults and does not pass `--test-type`. Canvas, WebGL, audio, and fonts remain what the Chrome build exposes.
