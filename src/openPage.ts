import { chromium } from "playwright-core";

import {
  chromeLaunchArgs,
  chromeUserAgent,
  ignoredAutomationArgs,
  resolveChromeExecutable,
  stealthProfile,
} from "./profile.js";
import { startSafeProxy } from "./safeProxy.js";
import { validatePublicUrl } from "./security.js";

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
  webdriver: boolean;
  userAgent: string;
  brands: string[];
  languages: string[];
  timezone: string;
  viewport: { width: number; height: number };
};

export async function openPage(url: string, timeoutMs: number, signal?: AbortSignal): Promise<OpenedPage> {
  await validatePublicUrl(url);
  if (signal?.aborted) throw new Error("Browser request was canceled.");
  const proxy = await startSafeProxy();
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const abortBrowser = () => { void browser?.close(); };
  signal?.addEventListener("abort", abortBrowser, { once: true });
  try {
    const executablePath = await resolveChromeExecutable();
    browser = await chromium.launch({
      executablePath,
      headless: true,
      ignoreDefaultArgs: [...ignoredAutomationArgs],
      args: [...chromeLaunchArgs(), "--proxy-bypass-list=<-loopback>"],
    });
    if (signal?.aborted) throw new Error("Browser request was canceled.");
    const context = await browser.newContext({
      proxy: { server: proxy.url },
      serviceWorkers: "block",
      locale: stealthProfile.locale,
      timezoneId: stealthProfile.timezoneId,
      viewport: { ...stealthProfile.viewport },
      colorScheme: stealthProfile.colorScheme,
      userAgent: chromeUserAgent(browser.version()),
      extraHTTPHeaders: { "Accept-Language": stealthProfile.acceptLanguage },
    });
    await context.route("**/*", async (route) => {
      try {
        await validatePublicUrl(route.request().url());
        if (signal?.aborted) throw new Error("Browser request was canceled.");
        await route.continue();
      } catch {
        await route.abort("blockedbyclient").catch(() => undefined);
      }
    });
    const page = await context.newPage();
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });
    if (response === null) {
      throw new Error(`No response for ${url}`);
    }
    await page.waitForLoadState("load", { timeout: Math.min(timeoutMs, 3_000) }).catch(() => undefined);
    const snapshot = await page.evaluate(readPage);
    const truncated = snapshot.text.length > maxTextCharacters;
    return {
      requestedUrl: url,
      finalUrl: page.url(),
      httpStatus: response.status(),
      title: snapshot.title,
      text: truncated ? snapshot.text.slice(0, maxTextCharacters) : snapshot.text,
      truncated,
      observed: {
        webdriver: snapshot.webdriver,
        userAgent: snapshot.userAgent,
        brands: snapshot.brands,
        languages: snapshot.languages,
        timezone: snapshot.timezone,
        viewport: snapshot.viewport,
      },
    };
  } finally {
    signal?.removeEventListener("abort", abortBrowser);
    try {
      await browser?.close();
    } finally {
      await proxy.close();
    }
  }
}

function readPage(): PageSnapshot {
  const languages = Array.from(navigator.languages);
  const record = navigator as Navigator & {
    userAgentData?: { brands: Array<{ brand: string }> };
  };
  const brands = (record.userAgentData?.brands ?? []).map((brand) => brand.brand);
  return {
    title: document.title,
    text: document.body?.innerText ?? "",
    webdriver: navigator.webdriver === true,
    userAgent: navigator.userAgent,
    brands,
    languages,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    viewport: { width: window.innerWidth, height: window.innerHeight },
  };
}
