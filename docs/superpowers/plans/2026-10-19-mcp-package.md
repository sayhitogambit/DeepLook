# DeepLook MCP and Package Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a working stdio MCP interface and prove the built CLI installs independently of its checkout.

**Architecture:** Add MCP as a CLI command backed by the official SDK. Reuse `runCli` machine output as the existing engine/API result boundary rather than duplicating classification or credential handling. Package only built runtime files.

**Tech Stack:** Node.js >=22.14, TypeScript, official MCP server/client SDK 2.3.1, Zod 4.6.7, node:test.

**Spec:** `docs/superpowers/specs/2026-10-19-mcp-package-design.md`

## Global Constraints

- Preserve local sandbox and remote transport/credential policy.
- One active read per MCP process; input deadline defaults 30000 and range is 1..120000.
- No product dependencies added before the first failing behavior test.
- Keep package private; do not publish, deploy, or grant a license.
- Preserve official logo and unrelated Nymetric work.

## Review Focus

- A disconnected client must abort active reads and release resources.
- Concurrent tool calls must not launch unbounded Chrome processes.
- Credentials reflected in error fields must not enter MCP output.
- Invalid timeout/URL/unknown properties must not reach the API.
- A tarball installed without dev dependencies must retain executable entry points and package version lookup.

### Task 1: MCP discovery and page reads

**Files:** create `src/mcp.test.ts`, `src/mcp.ts`; modify `src/command.ts`, `src/cliRunner.ts`, package metadata/lock.

**Interfaces:** `runMcp(open: PageOpener): Promise<void>` serves the process; `deeplook_open({url, timeoutMs?})` returns the existing machine result as structured content and readable text content.

- [ ] Install SDK client as a test dependency. Write a real client test asserting handshake and one advertised tool; run it and observe failure because `mcp` is missing.
- [ ] Add exact server SDK/Zod dependencies; implement command, stdio entry and one tool. Verify discovery.
- [ ] Write failing HTTP fixture call tests asserting authenticated wire contract, text/structured results, typed errors, remote metadata sanitization, default deadline and invalid input rejection without API requests.
- [ ] Implement minimal shared CLI result adapter. Run full `npm test` and commit.

### Task 2: MCP lifecycle and admission

**Files:** modify `src/mcp.test.ts`, `src/mcp.ts`.

**Interfaces:** request abort signal joins process shutdown; one active operation enforced per server instance.

- [ ] Write failing tests for concurrent `busy` response, request cancellation, client EOF, and signal shutdown during an unfinished response. Verify requests close promptly and a subsequent call succeeds after cancellation.
- [ ] Implement cancellation/shutdown/admission with cleanup in `finally`. Run full `npm test` and commit.

### Task 3: Installable tarball and user documentation

**Files:** create `src/package.integration.test.ts`; modify package metadata, README and CI workflow.

**Interfaces:** `npm run test:package` creates a tarball, installs it into a temporary project with production dependencies only, and exercises installed CLI/MCP.

- [ ] Write failing integration that inspects actual tarball entries, requires exclusion of tests/source/fixtures, installs offline, invokes installed version/doctor and completes an MCP handshake.
- [ ] Add runtime allowlist and build-on-pack lifecycle. Verify package integration and full project/browser suites.
- [ ] Document MCP setup, limits, untrusted page content and tarball installation; add package check to CI.
- [ ] Obtain fresh independent whole-branch review, fix material findings using RED/GREEN, and create/attach a draft PR based on CLI PR #4.
