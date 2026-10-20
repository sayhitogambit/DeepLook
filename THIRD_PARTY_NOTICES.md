# Third-party components

DeepLook's original code and documentation are provided under Apache-2.0. Dependencies retain their own licenses and notices; installation does not relicense those components.

| Component | License | Source |
| --- | --- | --- |
| Playwright Core | Apache-2.0 | https://github.com/microsoft/playwright |
| MCP TypeScript SDK (`core`, `server`, development `client`) | Apache-2.0 | https://github.com/modelcontextprotocol/typescript-sdk |
| Zod | MIT | https://github.com/colinhacks/zod |
| TypeScript (development) | Apache-2.0 | https://github.com/microsoft/TypeScript |

Other installed transitive components include cross-spawn, eventsource, eventsource-parser, jose, path-key, pkce-challenge, shebang-command and shebang-regex (MIT), and isexe and which (ISC). Their license files remain in the installed packages. See `package-lock.json` for pinned versions.

Playwright's NOTICE states:

> Playwright
> Copyright (c) Microsoft Corporation
>
> This software contains code derived from the Puppeteer project (https://github.com/puppeteer/puppeteer), available under the Apache 2.0 license (https://github.com/puppeteer/puppeteer/blob/master/LICENSE).

Google Chrome is installed separately and is not included in this repository or CLI package. Its distribution terms are separate. DeepLook does not bundle CloakBrowser, Lightpanda or REA.
