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
```

Text output is the visible page text. `--json` returns the final URL, title, upstream HTTP status, and the browser details observed by the page. Set `DEEPLOOK_CHROME` to a Chrome binary if it is not at `/opt/google/chrome/chrome` or `/usr/bin/google-chrome-stable`.

The CLI accepts `--timeout-ms <milliseconds>`; the default is 30000. Browser requests reject private, local, and metadata destinations, including redirects and page resources. Each connection uses a checked, pinned DNS answer. Challenge pages and upstream HTTP errors exit unsuccessfully; challenge page text is never printed.

## Machine contract for the HTTP adapter

The separate API repository starts this CLI without a shell:

```bash
node /path/to/deeplook/dist/cli.js open https://example.com --machine --timeout-ms 30000
```

`--machine` writes exactly one JSON object and a newline to stdout. Success exits 0:

```json
{"version":1,"ok":true,"page":{"requestedUrl":"https://example.com","finalUrl":"https://example.com/","httpStatus":200,"title":"Example Domain","text":"Example Domain","truncated":false,"observed":{"webdriver":false,"userAgent":"...","brands":[],"languages":["en-US"],"timezone":"America/New_York","viewport":{"width":1366,"height":768}}}}
```

Failure exits 1 and uses `{"version":1,"ok":false,"error":"challenge|upstream_http|timeout|navigation_failed","message":"..."}`. Challenge and upstream HTTP failures may also include `finalUrl` and `title`; challenge failures may include `marker`. Challenge text is excluded. The adapter should reject an unknown `version`, cap the child output, and treat malformed output as a navigation failure.

On `SIGTERM` or `SIGINT`, the CLI aborts the browser operation and waits for Chrome and the local safe proxy to close before exiting. The adapter should still enforce its own termination deadline.

## Browser profile

Launch uses stock Chrome with a coherent profile: `en-US`, `America/New_York`, language `en-US,en`, and a 1366×768 viewport. It drops Playwright's `--enable-automation` and `--enable-unsafe-swiftshader` defaults and does not pass `--test-type`. Canvas, WebGL, audio, and fonts remain what the Chrome build exposes.
