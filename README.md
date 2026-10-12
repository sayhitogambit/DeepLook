# DeepLook

DeepLook is a private agent browser. This slice opens one URL in stock Chrome and returns the visible page text, either from the `deeplook open` command or from a local HTTP API. A later search API will sit on top of it. Search and ranking are not in this slice.

The browser is original code. It does not include CloakBrowser, Lightpanda, or the REA reverse-engineering toolkit.

## Run

Requires Node.js 22.14 or newer and Google Chrome.

```bash
npm install
npm run build
node dist/cli.js open https://example.com
node dist/cli.js open https://example.com --json
```

Text output is the page text. `--json` also returns the final URL, title, and the locale, timezone, viewport, languages, user agent, and `navigator.webdriver` value the page observed.

```bash
node dist/cli.js open https://example.com --timeout-ms 15000
```

If Chrome is not at `/opt/google/chrome/chrome` or `/usr/bin/google-chrome-stable`, set `DEEPLOOK_CHROME` to the real Chrome binary. Use the binary, not a wrapper script that adds `--test-type` or a forced software WebGL renderer.

```bash
npm test
```

## HTTP API

The API calls the same browser as the command. It does not keep its own launch flags.

```bash
npm install
npm run build
npm run api
```

The server listens on `127.0.0.1:47231`. Override the bind address with `DEEPLOOK_HOST` and `DEEPLOOK_PORT`. Binding to any non-loopback address requires `DEEPLOOK_API_TOKEN`; send it as `Authorization: Bearer <token>` on `/v1/open`. Keep that token in the environment and do not put the API directly on the public internet without TLS. `DEEPLOOK_CHROME` is the same Chrome binary the command uses.

`GET /health` returns `{"ok":true}`.

`POST /v1/open` takes JSON `{"url":"https://example.com"}`. `timeoutMs` is optional, an integer from 1 to 120000, and defaults to 30000. URLs must resolve only to public addresses and use the standard HTTP or HTTPS port. A successful response is the same JSON object as `deeplook open --json`: final URL, upstream HTTP status, title, visible text, and the locale, timezone, viewport, user agent, and `navigator.webdriver` value the page saw. The browser blocks redirects and page resources to private addresses. Each connection uses a checked, pinned DNS answer.

```bash
curl -s http://127.0.0.1:47231/health
curl -s -X POST http://127.0.0.1:47231/v1/open \
  -H 'content-type: application/json' \
  -d '{"url":"https://example.com"}'
```

A bad request is HTTP 400 `invalid_request`. An invalid bearer token is 401 `unauthorized`. Navigation failure, including an upstream HTTP error, is 502 `navigation_failed`. A timeout is 504 `timeout`. A bot-check or challenge page is 422 `challenge`: the response includes the final URL, title, and the marker that matched, and it does not include the challenge page text. When two browser opens are already active, further requests get 503 `busy`. Unknown paths are 404 `not_found`. The API does not solve captchas.

## What this slice changes

Launch uses stock Chrome with a single coherent profile: `en-US`, `America/New_York`, language `en-US,en`, and a 1366×768 viewport. It drops Playwright's `--enable-automation` and `--enable-unsafe-swiftshader` defaults, and it does not pass `--test-type`. `navigator.webdriver` is left unset by disabling the `AutomationControlled` blink feature. The user agent keeps the launched Chrome major version and the host platform, without the `HeadlessChrome` token.

Canvas, WebGL, audio, and fonts stay whatever that Chrome build actually exposes. Forging those values in JavaScript would disagree with the rest of the browser.

This does not solve captchas. A site can still show a challenge.
