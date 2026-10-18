import { chromium, type Browser, type BrowserServer } from "playwright-core";

import {
  chromeLaunchArgs,
  chromeUserAgent,
  ignoredAutomationArgs,
  resolveChromeExecutable,
  stealthProfile,
} from "./profile.js";
import { startSafeProxy } from "./safeProxy.js";
import { validatePublicUrl } from "./security.js";
import { Operation } from "./operation.js";
import { browserEnvironment } from "./runtimeEnvironment.js";

export type OpenedPage = {
  requestedUrl: string;
  finalUrl: string;
  httpStatus?: number;
  title: string;
  text: string;
  truncated: boolean;
  observed: {
    webdriver: boolean;
    userAgent: string;
    brands: string[];
    languages: string[];
    timezone: string;
    viewport: { width: number; height: number };
  };
};

const maxTextCharacters = 200_000;

type PageSnapshot = {
  title: string;
  text: string;
  truncated: boolean;
  webdriver: boolean;
  userAgent: string;
  brands: string[];
  languages: string[];
  timezone: string;
  viewport: { width: number; height: number };
};

type Dependencies = {
  validateUrl: typeof validatePublicUrl;
  startProxy: typeof startSafeProxy;
  launch: typeof chromium.launchServer;
  connect: (endpoint: string, options: { timeout: number }) => Promise<Browser>;
  resolveExecutable: typeof resolveChromeExecutable;
};

export function createPageOpener(overrides: Partial<Dependencies> = {}) {
  const dependencies: Dependencies = {
    validateUrl: validatePublicUrl, startProxy: startSafeProxy,
    launch: (options) => chromium.launchServer(options),
    connect: (endpoint, options) => chromium.connect(endpoint, options),
    resolveExecutable: resolveChromeExecutable, ...overrides,
  };
  return (url: string, timeoutMs: number, signal?: AbortSignal) =>
    openWithDependencies(url, timeoutMs, signal, dependencies);
}

export const openPage = createPageOpener();

async function openWithDependencies(
  url: string, timeoutMs: number, signal: AbortSignal | undefined, dependencies: Dependencies,
): Promise<OpenedPage> {
  const operation = new Operation(timeoutMs, signal);
  let failed = false;
  try {
    operation.signal.throwIfAborted();
    await operation.wait(dependencies.validateUrl(url));
    const proxy = await operation.acquire(dependencies.startProxy(), (resource) => resource.close());
    const executablePath = await operation.wait(dependencies.resolveExecutable());
    const server = await operation.acquire(dependencies.launch({
      executablePath,
      headless: true,
      host: "127.0.0.1",
      chromiumSandbox: true,
      env: browserEnvironment(),
      timeout: operation.remainingMs(),
      ignoreDefaultArgs: [...ignoredAutomationArgs],
      args: [...chromeLaunchArgs(), "--proxy-bypass-list=<-loopback>"],
    }), closeBrowserServer);
    const browser = await operation.wait(dependencies.connect(server.wsEndpoint(), { timeout: operation.remainingMs() }));
    const context = await operation.wait(browser.newContext({
      proxy: { server: proxy.url },
      serviceWorkers: "block",
      locale: stealthProfile.locale,
      timezoneId: stealthProfile.timezoneId,
      viewport: { ...stealthProfile.viewport },
      colorScheme: stealthProfile.colorScheme,
      userAgent: chromeUserAgent(browser.version()),
      extraHTTPHeaders: { "Accept-Language": stealthProfile.acceptLanguage },
    }));
    await operation.wait(context.route("**/*", async (route) => {
      try {
        await operation.wait(dependencies.validateUrl(route.request().url()));
        operation.signal.throwIfAborted();
        await route.continue();
      } catch {
        await route.abort("blockedbyclient").catch(() => undefined);
      }
    }));
    const page = await operation.wait(context.newPage());
    const response = await operation.wait(page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: operation.remainingMs(),
    }));
    if (response === null) {
      throw new Error(`No response for ${url}`);
    }
    await operation.wait(page.waitForLoadState("load", {
      timeout: Math.min(operation.remainingMs(), 3_000),
    }).catch(() => undefined));
    const snapshot = await operation.wait(page.evaluate(readPage, maxTextCharacters));
    return {
      requestedUrl: url,
      finalUrl: page.url(),
      httpStatus: response.status(),
      title: snapshot.title,
      text: snapshot.text,
      truncated: snapshot.truncated,
      observed: {
        webdriver: snapshot.webdriver,
        userAgent: snapshot.userAgent,
        brands: snapshot.brands,
        languages: snapshot.languages,
        timezone: snapshot.timezone,
        viewport: snapshot.viewport,
      },
    };
  } catch (cause) {
    failed = true;
    if (operation.signal.aborted) throw operation.signal.reason;
    throw cause;
  } finally {
    try {
      await operation.close();
    } catch (cause) {
      // Cleanup failure must not replace a useful timeout/cancellation reason.
      if (!failed) throw cause;
    }
  }
}

async function closeBrowserServer(server: BrowserServer): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const closed = await Promise.race([
      server.close().then(() => true, () => false),
      new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), 2_000); }),
    ]);
    if (!closed) await server.kill();
  } finally {
    clearTimeout(timer);
  }
}

function readPage(maxCharacters: number): PageSnapshot {
  const languages = Array.from(navigator.languages);
  const record = navigator as Navigator & {
    userAgentData?: { brands: Array<{ brand: string }> };
  };
  const brands = (record.userAgentData?.brands ?? []).map((brand) => brand.brand);
  const text = document.body?.innerText ?? "";
  return {
    title: document.title,
    text: text.slice(0, maxCharacters),
    truncated: text.length > maxCharacters,
    webdriver: navigator.webdriver === true,
    userAgent: navigator.userAgent,
    brands,
    languages,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    viewport: { width: window.innerWidth, height: window.innerHeight },
  };
}
