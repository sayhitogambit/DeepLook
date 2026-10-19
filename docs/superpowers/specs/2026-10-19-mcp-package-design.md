# DeepLook MCP and installable package

The next production milestone connects coding-agent hosts to the existing page reader and verifies installation from an npm tarball. This continues the approved engine/API/CLI roadmap. No repository visibility change, registry publication, deployment, billing, or license grant is part of this milestone.

## Interface

- `deeplook mcp` serves MCP over stdin/stdout using the official TypeScript SDK. Stdout contains protocol messages only. The installed package version identifies the server.
- One tool, `deeplook_open`, accepts an HTTP(S) `url` and optional integer `timeoutMs` from 1 through 120000, default 30000. Unknown input properties are rejected. It reads pages; it does not solve captchas, accept browser scripts, or expose credential arguments.
- Without `DEEPLOOK_API_URL`, use the existing local opener. With it, use the existing authenticated remote opener. No fallback from remote to local. Existing URL/network policy remains enforced by the engine or hosted API.
- Success returns page text in MCP text content and the version 1 machine envelope in structured content. Failure returns `isError: true` and the existing typed machine error. Reuse CLI result handling so remote error metadata remains sanitized.
- Propagate MCP cancellation and process shutdown into the active browser/API operation. Permit one active browser operation per MCP process; concurrent calls receive a typed `busy` failure. Release admission on every outcome.
- Page text is untrusted source material, not instructions. Advertise tool annotations as read-only, non-destructive, open-world, and non-idempotent (remote reads can consume quota).

## Packaging

`npm pack` builds the package and includes executable runtime JavaScript and README, excluding tests, source, fixtures, scratch work and credentials. Installation must work without TypeScript or other development dependencies. Keep the package private while the open-source license and publication remain pending.

## Verification

Real SDK client/server stdio exchanges cover discovery, calls, invalid inputs, errors, deadlines, cancellation and concurrency with local HTTP fixtures. Existing local-browser integration verifies the engine. A separate package integration packs, installs offline into an empty project, and exercises the installed executable and MCP connection. Full deterministic suite and browser integration remain required. Independent review precedes a draft PR stacked on CLI PR #4.
