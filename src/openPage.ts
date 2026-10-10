import { chromium } from "playwright-core";

import {
  chromeLaunchArgs,
  chromeUserAgent,
  ignoredAutomationArgs,
  launchMode,
  resolveChromeExecutable,
  stealthProfile,
} from "./profile.js";

export type OpenedPage = {
  requestedUrl: string;
  finalUrl: string;
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

export async function openPage(url: string, timeoutMs: number): Promise<OpenedPage> {
  const executablePath = await resolveChromeExecutable();
  const mode = launchMode();
  const browser = await chromium.launch({
    executablePath,
    headless: mode === "headless",
    chromiumSandbox: true,
    ignoreDefaultArgs: [...ignoredAutomationArgs],
    args: chromeLaunchArgs(mode),
  });
  try {
    const context = await browser.newContext({
      locale: stealthProfile.locale,
      timezoneId: stealthProfile.timezoneId,
      viewport: { ...stealthProfile.viewport },
      colorScheme: stealthProfile.colorScheme,
      userAgent: mode === "headless" ? chromeUserAgent(browser.version()) : undefined,
      extraHTTPHeaders: { "Accept-Language": stealthProfile.acceptLanguage },
    });
    const page = await context.newPage();
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });
    if (response === null) {
      throw new Error(`No response for ${url}`);
    }
    const snapshot = await page.evaluate(readPage);
    const truncated = snapshot.text.length > maxTextCharacters;
    return {
      requestedUrl: url,
      finalUrl: page.url(),
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
    await browser.close();
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
