# DeepLook browser

DeepLook is the private browser engine and command-line tool. It opens one public URL in stock Chrome and returns the visible page text. The HTTP adapter runs from the separate private [DeepLook-API repository](https://github.com/sayhitogambit/DeepLook-API) and calls this CLI as a child process. Search and Nymetric research live outside this repository.

The browser is original code. It does not include CloakBrowser, Lightpanda, or the REA reverse-engineering toolkit. It does not solve captchas.

## Run

Requires Node.js 22.14 or newer and Google Chrome.

```bash
npm ci
npm run build
node dist/cli.js open https://example.com
node dist/cli.js open https://example.com --json
npm test
npm run test:browser
```

Text output is the visible page text. `--json` returns the final URL, title, upstream HTTP status, and the browser details observed by the page. Set `DEEPLOOK_CHROME` to a Chrome binary if it is not at `/opt/google/chrome/chrome` or `/usr/bin/google-chrome-stable`.

The CLI accepts `--timeout-ms <milliseconds>` from 1 to 120000; the default is 30000. One operation deadline covers DNS, Chrome startup, navigation, and text extraction. Cleanup follows the deadline: Chrome gets up to two seconds to close gracefully before its owned process is killed. Browser requests reject private, local, and metadata destinations, including redirects and page resources. Each connection uses a checked, pinned DNS answer. Challenge pages, recognized access gates, empty/invisible-only text, and upstream HTTP errors exit unsuccessfully; their page text is never printed.

Chrome runs with its sandbox enabled and a minimal OS environment; API keys, administrator tokens, Node injection settings, and inherited proxy credentials are not passed to it. The service uses a temporary loopback Playwright connection to own and terminate the Chrome process. Linux must support Chromium's sandbox (including the required user namespaces/container security policy); startup fails rather than silently disabling it.

`npm test` runs deterministic regressions, including minimal excerpts from the 2026-10-18 benchmark. `npm run test:browser` additionally requires an installed Chrome and verifies sandboxed JavaScript rendering, challenge rejection, and cleanup after renderer-stalled extraction using local fixtures. No external websites or API keys are needed for those tests.

## Machine contract for the HTTP adapter

The separate API repository starts this CLI without a shell:

```bash
node /path/to/deeplook/dist/cli.js open https://example.com --machine --timeout-ms 30000
```

`--machine` writes exactly one JSON object and a newline to stdout. Success exits 0:

```json
{"version":1,"ok":true,"page":{"requestedUrl":"https://example.com","finalUrl":"https://example.com/","httpStatus":200,"title":"Example Domain","text":"Example Domain","truncated":false,"observed":{"webdriver":false,"userAgent":"...","brands":[],"languages":["en-US"],"timezone":"America/New_York","viewport":{"width":1366,"height":768}}}}
```

Failure exits 1 and uses `{"version":1,"ok":false,"error":"challenge|access_wall|empty_content|upstream_http|timeout|navigation_failed","message":"..."}`. Page failures may also include `finalUrl` and `title`; challenge and access-gate failures may include `marker`. Page text is excluded from failures. The version 1 envelope and success fields are unchanged; `access_wall` and `empty_content` extend its error vocabulary, so update the HTTP adapter before deploying this engine. The adapter should reject an unknown `version`, cap the child output, and treat malformed output as a navigation failure.

On `SIGTERM` or `SIGINT`, the CLI aborts the browser operation and waits for Chrome and the local safe proxy to close before exiting. The adapter should still enforce its own termination deadline.

## Browser profile

Launch uses stock Chrome with a coherent profile: `en-US`, `America/New_York`, language `en-US,en`, and a 1366×768 viewport. It drops Playwright's `--enable-automation` and `--enable-unsafe-swiftshader` defaults and does not pass `--test-type`. Canvas, WebGL, audio, and fonts remain what the Chrome build exposes.
