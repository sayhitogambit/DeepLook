import assert from "node:assert/strict";
import test from "node:test";

import { readServeConfig } from "./serveConfig.js";

test("public API binding requires an explicit token", () => {
  assert.throws(() => readServeConfig({ DEEPLOOK_HOST: "0.0.0.0" }), /DEEPLOOK_API_TOKEN/);
  assert.deepEqual(readServeConfig({ DEEPLOOK_HOST: "0.0.0.0", DEEPLOOK_API_TOKEN: "fixture-secret" }), {
    host: "0.0.0.0", port: 47_231, authorizationToken: "fixture-secret",
  });
});

test("loopback API keeps local operation without a token", () => {
  assert.deepEqual(readServeConfig({}), {
    host: "127.0.0.1", port: 47_231, authorizationToken: undefined,
  });
});
