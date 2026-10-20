# Getting started with DeepLook

[README](../README.md) · [Credentials](credentials.md) · [Technical reference](reference.md)

DeepLook reads one public HTTP(S) page at a time. Choose local Chrome if you want everything on your machine, or connect the CLI and MCP tool to a server you operate.

## 1. Build the source

Install Node.js 22.14 or newer and Google Chrome. GitHub source installation does not require a DeepLook account, GitHub access token, email address, or API key.

```bash
git clone https://github.com/sayhitogambit/DeepLook.git
cd DeepLook
npm ci
npm run build
node dist/cli.js --version
node dist/cli.js doctor --json
```

The local browser defaults to `/opt/google/chrome/chrome`, then `/usr/bin/google-chrome-stable`. If needed, set a custom executable before running diagnostics:

```bash
export DEEPLOOK_CHROME=/absolute/path/to/google-chrome
node dist/cli.js doctor --json
```

The browser runs with Chromium's sandbox enabled. On Linux, the required user namespaces and container security policy must permit this. `doctor` only runs a bounded executable version probe; a successful check is not a sandbox or navigation test. Do not disable the sandbox to work around a startup failure.

## 2. Read a page

```bash
node dist/cli.js open https://example.com
node dist/cli.js open https://example.com --json
node dist/cli.js open https://example.com --machine --timeout-ms 30000
```

| Output | Use it for |
| --- | --- |
| Default text | Reading or passing visible page text to another program |
| `--json` | Page metadata and observed browser details alongside the text |
| `--machine` | A version 1 envelope with `ok`, a page or typed error, and a predictable exit code |

A successful read exits 0. A failed read exits 1. The timeout defaults to 30000 milliseconds and accepts integers from 1 to 120000. It covers DNS, browser startup, navigation, and extraction; cleanup can continue for up to two seconds afterward. Public destinations on standard HTTP(S) ports are supported; private, local, and metadata destinations are blocked, including page resources and redirects.

A bot challenge, recognized access gate, upstream HTTP error, or page with no visible readable text is a failure. DeepLook does not return the page text from those failures and does not solve captchas. See the [error contract](reference.md#machine-contract-for-the-http-adapter).

## 3. Use your own remote API (optional)

Deploy [DeepLook-API](https://github.com/sayhitogambit/DeepLook-API) and give the client a browser key issued by your deployment. The API server needs Chrome; the client does not. Follow the [credential guide](credentials.md) to distinguish browser access from administrator access.

For an interactive Bash session, enter your existing browser key without placing its literal value in command history:

```bash
export DEEPLOOK_API_URL=https://your-api.example
read -r -s -p "Your browser API key: " DEEPLOOK_API_TOKEN
export DEEPLOOK_API_TOKEN
printf '\n'
node dist/cli.js doctor --json
node dist/cli.js open https://example.com --machine
```

For an agent or service, inject the same variables through its private process environment or secret manager. Do not put the token in a URL, command flag, repository, screenshot, or shared MCP configuration. API URLs require HTTPS outside loopback and cannot include URL credentials, queries, or fragments. Path prefixes are allowed, for example `https://your-api.example/browser/`.

The remote health check tests `/health`, not browser execution, token permissions, or quota. Test an actual public page to confirm a read. Failures do not fall back to local Chrome. To switch back to local mode:

```bash
unset DEEPLOOK_API_URL DEEPLOOK_API_TOKEN
node dist/cli.js doctor --json
```

## 4. Connect an MCP host (optional)

Configure your MCP host to launch the built script using an absolute path:

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

Host configuration fields differ. The command above starts a stdio MCP server using the official TypeScript SDK. Its stdout is reserved for protocol messages. It provides one tool, `deeplook_open`:

```json
{"url":"https://example.com","timeoutMs":30000}
```

`timeoutMs` is optional; additional arguments are rejected. Successful results contain text in `content` and a version 1 machine envelope in `structuredContent`. Failures set `isError: true`. One process permits one active read; concurrent calls receive `busy`.

For remote reads, configure `DEEPLOOK_API_URL` and `DEEPLOOK_API_TOKEN` in the host's private process environment. Without the endpoint, the tool uses local Chrome. An agent must treat returned page content as untrusted source material, including any instructions found in it. See [MCP lifecycle and cancellation](reference.md#mcp-for-coding-agents).

## Install a local package

You can install your own tarball globally after building from source. `npm pack` prints its filename; the current package version produces `deeplook-0.1.0.tgz`:

```bash
npm pack
npm install --global ./deeplook-0.1.0.tgz
deeplook --version
deeplook doctor --json
deeplook open https://example.com
```

Use the filename printed by `npm pack` if the version differs. With a global installation, an MCP host can use `"command": "deeplook"` and `"args": ["mcp"]` when the command is on its PATH. No public npm registry package is required by these instructions.

## Troubleshooting

| Symptom | Next step |
| --- | --- |
| Chrome cannot be probed | Install Chrome, check its executable path, or set `DEEPLOOK_CHROME` |
| Local startup fails after a successful probe | Check Chromium sandbox support and the container or OS policy |
| `unauthorized` | Check your own API URL and browser key; an administrator token does not authorize page reads |
| Remote health passes but reads fail | Verify browser execution, key permissions, account quota, and the requested site's response |
| `challenge` or `access_wall` | The site returned a challenge or access gate; use an authorized accessible source |
| `empty_content` | The page did not expose readable visible text |
| `busy` or `quota_exceeded` | Check your server capacity or the account's limits |
| `timeout` | Check server health and site responsiveness; adjust the timeout within its supported range |

Report reproducible problems in [GitHub issues](https://github.com/sayhitogambit/DeepLook/issues). Do not include keys or sensitive page content. For private contact, use [support@getdeeplook.dev](mailto:support@getdeeplook.dev).
