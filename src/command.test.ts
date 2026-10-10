import assert from "node:assert/strict";
import test from "node:test";

import { parseCommand } from "./command.js";
import {
  chromeLaunchArgs,
  chromeUserAgent,
  ignoredAutomationArgs,
  stealthProfile,
} from "./profile.js";

test("open parses a url and json output", () => {
  const command = parseCommand(["node", "deeplook", "open", "https://example.com", "--json"]);
  assert.deepEqual(command, {
    kind: "open",
    url: "https://example.com",
    format: "json",
    timeoutMs: 30_000,
  });
});

test("open rejects a missing url", () => {
  const command = parseCommand(["node", "deeplook", "open"]);
  assert.equal(command.kind, "error");
});

test("profile locale, language, and timezone agree", () => {
  assert.equal(stealthProfile.locale, "en-US");
  assert.ok(stealthProfile.acceptLanguage.startsWith("en-US"));
  assert.equal(stealthProfile.timezoneId, "America/New_York");
  assert.ok(stealthProfile.viewport.width > 0);
  assert.ok(stealthProfile.viewport.height > 0);
});

test("user agent keeps the launched major version and drops the headless token", () => {
  const agent = chromeUserAgent("148.0.7778.96");
  assert.match(agent, /Chrome\/148\.0\.0\.0/);
  assert.equal(agent.includes("HeadlessChrome"), false);
});

test("launch defaults drop automation switches and do not forge a fingerprint", () => {
  assert.ok(ignoredAutomationArgs.includes("--enable-automation"));
  assert.ok(ignoredAutomationArgs.includes("--enable-unsafe-swiftshader"));
  const args = chromeLaunchArgs().join(" ");
  assert.match(args, /AutomationControlled/);
  assert.equal(args.includes("--fingerprint"), false);
  assert.equal(args.includes("--test-type"), false);
  assert.equal(args.includes("swiftshader"), false);
  assert.equal(args.includes("--headless"), false);
});

test("display mode stays on X11 and does not opt into SwiftShader", () => {
  const args = chromeLaunchArgs("display").join(" ");
  assert.match(args, /--ozone-platform=x11/);
  assert.match(args, /--window-size=1366,768/);
  assert.equal(args.includes("swiftshader"), false);
  assert.equal(args.includes("--headless"), false);
});
