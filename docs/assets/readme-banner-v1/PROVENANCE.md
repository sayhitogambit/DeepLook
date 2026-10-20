# DeepLook README banners, v1

Created on 2026-10-20 for the planned open-source launch. These assets do not publish the repositories or select their software licenses.

## Final exports

- `deeplook-readme-en-v1.png`: English, 2400 × 800.
- `deeplook-readme-pt-BR-v1.png`: Brazilian Portuguese, 2400 × 800.
- `deeplook-readme-zh-CN-v1.png`: Simplified Chinese, 2400 × 800.

The three exports use the same generated illustration and layout. The wording is composed deterministically in `banner.html`, including Portuguese accents and Chinese characters. Rebuild with `node docs/assets/readme-banner-v1/render.mjs` from the repository root after installing its dependencies and Chrome. The renderer uses Arial/Helvetica when present and Liberation Mono for the small labels, with Noto Sans CJK SC for Chinese. Chinese typography has locale-specific sizing and spacing; font availability can change metrics on another machine. The Chinese version reuses the existing illustration without another image-generation call.

## Sources and identity

- `illustration.png` was generated with the built-in ImageGen tool, using the exact prompt in `prompt.txt`. The tool did not expose an independently verifiable model-version identifier in its response.
- `deeplook-logo-thin-v1.png` is an unchanged copy of the canonical master approved on 2026-10-18, preserved in this directory for reproducible composition.
- The canonical and copied logo SHA-256 is `8725fd06a720928191243da341998e42b504e187dafd0d1496049cd5c8702eb5`.
- The logo is displayed as its original PNG with uniform scaling. It was not sent to the image generator or reconstructed as text. The illustration contains no logo or readable text.

## Copy

English: “A browser for AI agents”; “The web, ready for your agents.”; “Real Chrome. Readable text. Structured JSON.”; “CLI / HTTP API / MCP”; “Open source”.

Portuguese: “Um navegador para agentes de IA”; “A web, pronta para seus agentes.”; “Chrome real. Texto legível. JSON estruturado.”; “CLI / API HTTP / MCP”; “Código aberto”.

Simplified Chinese: “面向 AI 智能体的浏览器”; “让网页内容为智能体所用。”; “真实 Chrome · 可读文本 · 结构化 JSON”; “CLI / HTTP API / MCP”; “开源”.

All exports show `getdeeplook.dev`. Original project code is released under Apache-2.0; building these assets does not publish a package to the npm registry.
