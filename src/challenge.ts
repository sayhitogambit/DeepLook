/**
 * Interstitial titles and short block pages. A long article that happens to
 * mention one of these phrases is left alone. This does not solve the check.
 */
const titleMarkers = [
  "just a moment",
  "attention required",
  "checking your browser",
  "one more step",
  "verify you are human",
  "verify you're human",
  "pardon our interruption",
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
] as const;

const shortPageLimit = 2_500;

export function challengeMarker(title: string, text: string): string | undefined {
  const fromTitle = firstMarker(title, titleMarkers);
  if (fromTitle !== undefined) return fromTitle;
  const trimmed = text.trim();
  if (trimmed.length > shortPageLimit) return undefined;
  return firstMarker(trimmed, shortPageMarkers);
}

function firstMarker(value: string, markers: readonly string[]): string | undefined {
  const haystack = value.toLowerCase();
  return markers.find((marker) => haystack.includes(marker));
}
