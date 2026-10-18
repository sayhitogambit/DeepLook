/**
 * Interstitial titles and block pages. A long article that happens to mention
 * one of these phrases is left alone. This does not solve the check.
 */
const titleMarkers = [
  "just a moment",
  "attention required",
  "checking your browser",
  "one more step",
  "verify you are human",
  "verify you're human",
  "pardon our interruption",
  "robot or human",
  "prove your humanity",
] as const;

const shortPageMarkers = [
  ...titleMarkers,
  "checking if the site connection is secure",
  "enable javascript and cookies",
  "unusual traffic",
  "are you a robot",
  "you have been blocked",
  "cf-browser-verification",
  "please verify you are a human",
  "please complete the security check",
  "prove your humanity",
  "complete the challenge below",
  "activate and hold the button to confirm",
] as const;

const shortPageLimit = 2_500;

export function challengeMarker(title: string, text: string): string | undefined {
  const normalizedTitle = title.toLowerCase().trim().replace(/[.!?]+$/, "");
  // Branded challenge titles occur too (for example, Reddit's interstitial).
  const fromTitle = titleMarkers.find((marker) => normalizedTitle === marker ||
    normalizedTitle.endsWith(` - ${marker}`) || normalizedTitle.endsWith(` | ${marker}`));
  if (fromTitle !== undefined) return fromTitle;
  const trimmed = text.trim();
  if (trimmed.length > shortPageLimit) {
    const beginning = trimmed.slice(0, 500).toLowerCase();
    return shortPageMarkers.find((marker) => beginning.startsWith(marker));
  }
  return firstMarker(trimmed, shortPageMarkers);
}

function firstMarker(value: string, markers: readonly string[]): string | undefined {
  const haystack = value.toLowerCase();
  return markers.find((marker) => haystack.includes(marker));
}
