#!/usr/bin/env node

import { runCli } from "./cliRunner.js";
import { openPage } from "./openPage.js";

process.exitCode = await runCli(process.argv, openPage, {
  stdout: process.stdout,
  stderr: process.stderr,
  signals: process,
});
