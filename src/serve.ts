#!/usr/bin/env node

import { openPage } from "./openPage.js";
import { createApiServer } from "./server.js";

const host = process.env.DEEPLOOK_HOST ?? "127.0.0.1";
const port = readPort(process.env.DEEPLOOK_PORT);
const server = createApiServer(openPage);

server.listen(port, host, () => {
  process.stdout.write(`DeepLook API listening on http://${host}:${port}\n`);
});

function readPort(raw: string | undefined): number {
  if (raw === undefined || raw.length === 0) return 47_231;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    process.stderr.write("DEEPLOOK_PORT must be an integer from 1 to 65535.\n");
    process.exit(1);
  }
  return parsed;
}
