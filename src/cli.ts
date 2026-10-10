#!/usr/bin/env node

import { helpText, parseCommand, type OutputFormat } from "./command.js";
import { openPage, type OpenedPage } from "./openPage.js";

const command = parseCommand(process.argv);

switch (command.kind) {
  case "help":
    process.stdout.write(helpText);
    break;
  case "error":
    process.stderr.write(`${command.message}\n${helpText}`);
    process.exitCode = 1;
    break;
  case "open":
    try {
      const page = await openPage(command.url, command.timeoutMs);
      process.stdout.write(render(page, command.format));
    } catch (cause: unknown) {
      const message = cause instanceof Error ? cause.message : String(cause);
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    }
    break;
  default: {
    const unexpected: never = command;
    throw new Error(`Unhandled command ${(unexpected as { kind: string }).kind}`);
  }
}

function render(page: OpenedPage, format: OutputFormat): string {
  switch (format) {
    case "text":
      return page.text.length === 0 ? "" : `${page.text}\n`;
    case "json":
      return `${JSON.stringify(page, null, 2)}\n`;
    default: {
      const unexpected: never = format;
      return unexpected;
    }
  }
}
