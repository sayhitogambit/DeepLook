import { access } from "node:fs/promises";
import { constants } from "node:fs";

/** One coherent browser profile. Locale, language, and timezone agree. */
export const stealthProfile = {
  locale: "en-US",
  timezoneId: "America/New_York",
  acceptLanguage: "en-US,en;q=0.9",
  viewport: { width: 1366, height: 768 },
  colorScheme: "light",
} as const;

/**
 * Playwright defaults that advertise an automated browser.
 * `--enable-automation` sets `navigator.webdriver`.
 * `--enable-unsafe-swiftshader` forces a software WebGL renderer real Chrome
 * sessions do not advertise.
 */
export const ignoredAutomationArgs = [
  "--enable-automation",
  "--enable-unsafe-swiftshader",
] as const;

const chromeCandidates = [
  "/opt/google/chrome/chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
] as const;

export async function resolveChromeExecutable(): Promise<string> {
  const fromEnv = process.env.DEEPLOOK_CHROME;
  if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv;
  for (const candidate of chromeCandidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  return chromeCandidates[0];
}

/**
 * Stock Chrome's reduced user agent, with the headless token removed.
 * The major version comes from the binary that was launched, and the platform
 * token matches this machine so it does not contradict the real browser.
 */
export function chromeUserAgent(browserVersion: string): string {
  const major = /^(\d+)/.exec(browserVersion)?.[1] ?? "0";
  const platform =
    process.platform === "darwin"
      ? "Macintosh; Intel Mac OS X 10_15_7"
      : process.platform === "win32"
        ? "Windows NT 10.0; Win64; x64"
        : "X11; Linux x86_64";
  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

/** Launch flags for stock Chrome. These are not a patched browser. */
export function chromeLaunchArgs(): string[] {
  return [
    "--disable-blink-features=AutomationControlled",
    `--lang=${stealthProfile.locale}`,
    "--disable-dev-shm-usage",
  ];
}
