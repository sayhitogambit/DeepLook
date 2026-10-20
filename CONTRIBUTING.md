# Contributing to DeepLook

Thanks for helping make public web pages easier for agents to read. Issues, reproducible bug reports, documentation improvements, translations, and focused pull requests are welcome.

## Development setup

Use Node.js 22.14 or newer. Install Google Chrome for browser integration work; its sandbox must be available.

```bash
git clone https://github.com/sayhitogambit/DeepLook.git
cd DeepLook
npm ci
npm run build
npm test
```

The browser engine, CLI, remote client, and stdio MCP adapter live in `src/`. The HTTP server is maintained in the separate [DeepLook-API repository](https://github.com/sayhitogambit/DeepLook-API). See [Getting started](docs/getting-started.md) and the [technical reference](docs/reference.md) for runtime behavior.

## Before opening a pull request

Keep changes focused and explain the problem, the resulting behavior, and how you verified it. Add a regression test when changing behavior, preferably with deterministic fixtures that need no external website or credentials.

```bash
npm test
npm run test:browser
npm run test:package
```

`npm test` runs deterministic regressions. `test:browser` requires Chrome and checks sandboxed rendering, rejected challenges, deadlines, and cleanup with local fixtures. `test:package` verifies packing, production installation, and the installed CLI/MCP handshake; its offline consumer installation relies on dependency archives cached by `npm ci`. Report which checks you ran and any environmental limitation.

When changing the browser result or machine error contract, consider both the remote API client and [HTTP server](https://github.com/sayhitogambit/DeepLook-API). Preserve version checking, output bounds, cancellation, and process cleanup. Do not weaken public-destination validation, DNS pinning, sandboxing, or the separation between browser processes and credentials.

## Documentation and translation

Keep [English](README.md), [Brazilian Portuguese](README.pt-BR.md), and [Simplified Chinese](README.zh-CN.md) aligned on capabilities, setup commands, and security boundaries. Detailed shared guides currently use English. Keep examples usable from a clean public checkout, with placeholder domains and privately supplied credentials.

The approved DeepLook identity and localized README banners are in `docs/assets/readme-banner-v1/`; see its [provenance record](docs/assets/readme-banner-v1/PROVENANCE.md). Preserve the canonical logo and existing brand assets. A change to the project identity needs explicit maintainer approval.

Avoid unsupported benchmark claims and promises of stealth, access-control bypass, or captcha solving. Describe measured behavior and the conditions under which a check was run.

## Reporting bugs safely

Use [GitHub issues](https://github.com/sayhitogambit/DeepLook/issues) for ordinary bugs. Include your operating system, Node and Chrome versions, DeepLook version, local or remote mode, expected behavior, and a minimal reproduction using a public page or local test fixture. Sanitize diagnostics before sharing them.

Never attach real API keys, administrator tokens, runtime account databases, sensitive URLs, private page text, or raw request headers. For a suspected vulnerability or another report that needs private handling, contact [support@getdeeplook.dev](mailto:support@getdeeplook.dev) with a description and sanitized reproduction. Do not publish a working secret in either channel.

## License

Original project code is licensed under [Apache-2.0](LICENSE). Submit only material you have the right to contribute under the project's license. Keep third-party notices and provenance intact; dependencies and Chrome have their own licenses.
