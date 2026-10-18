import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { runCli } from "./cliRunner.js";
import { EventEmitter } from "node:events";
import { pageProblem } from "./pageResult.js";
import type { OpenedPage } from "./openPage.js";

const page: OpenedPage = {
  requestedUrl: "https://example.com/", finalUrl: "https://example.com/",
  title: "Example", text: "A readable page.", httpStatus: 200, truncated: false,
  observed: { webdriver: false, userAgent: "Chrome", brands: [], languages: ["en-US"],
    timezone: "UTC", viewport: { width: 1366, height: 768 } },
};

// Minimal title/text excerpts from the 2026-10-18 benchmark. No query tokens,
// browser profiles, or live requests are needed to reproduce these failures.
const regressions = JSON.parse(await readFile(
  new URL("../src/fixtures/content-regressions.json", import.meta.url), "utf8",
)) as Array<{ name: string; title: string; text: string; expected: string }>;

for (const fixture of regressions) {
  test(`${fixture.name} benchmark gate is an error in every CLI output mode`, async () => {
    const blocked = { ...page, title: fixture.title, text: fixture.text };
    assert.equal(pageProblem(blocked)?.kind, fixture.expected);
    for (const flag of ["--machine", "--json", ""]) {
      const stdout: string[] = [];
      const stderr: string[] = [];
      const result = await runCli(["node", "deeplook", "open", page.requestedUrl, ...(flag ? [flag] : [])],
        async () => blocked, {
          stdout: { write: (value) => stdout.push(value) },
          stderr: { write: (value) => stderr.push(value) }, signals: new EventEmitter(),
        });
      assert.equal(result, 1);
      if (flag === "--machine") {
        const envelope = JSON.parse(stdout.join(""));
        assert.equal(envelope.error, fixture.expected);
        assert.equal(envelope.page, undefined);
        assert.equal(envelope.text, undefined);
        assert.equal(stderr.length, 0);
      } else {
        assert.equal(stdout.length, 0);
        assert.ok(stderr.length > 0);
      }
    }
  });
}

test("ordinary pages, short answers, and articles discussing bot checks stay readable", () => {
  for (const text of ["42", "Olá", "你好", "👋", "Continue shopping", "Product details. Continue shopping. Price: $42.",
    "An article about browser checks. ".repeat(100) + "Complete the challenge below is a common message."]) {
    assert.equal(pageProblem({ ...page, title: "How to prove your humanity online", text }), undefined);
  }
});

test("empty content includes whitespace and invisible formatting but not upstream errors", () => {
  for (const text of ["", "\n \t", "\u200b".repeat(300), "\u200e\u200f\ufeff\u2060"]) {
    assert.equal(pageProblem({ ...page, text })?.kind, "empty_content");
  }
  assert.deepEqual(pageProblem({ ...page, httpStatus: 503, text: "" }), { kind: "upstream_http", status: 503 });
});
