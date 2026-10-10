# DeepLook

DeepLook is a private agent browser. This slice opens one URL in stock Chrome and returns the visible page text. A later search API will sit on top of it. That API is not in this slice.

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

## What this slice changes

Launch uses stock Chrome with a single coherent profile: `en-US`, `America/New_York`, language `en-US,en`, and a 1366×768 viewport. It drops Playwright's `--enable-automation` and `--enable-unsafe-swiftshader` defaults, and it does not pass `--test-type`. `navigator.webdriver` is left unset by disabling the `AutomationControlled` blink feature. The user agent keeps the launched Chrome major version and the host platform, without the `HeadlessChrome` token.

Canvas, WebGL, audio, and fonts stay whatever that Chrome build actually exposes. Forging those values in JavaScript would disagree with the rest of the browser.

This does not solve captchas. A site can still show a challenge.
