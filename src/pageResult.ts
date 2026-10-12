import { challengeMarker } from "./challenge.js";
import type { OpenedPage } from "./openPage.js";

export type PageProblem =
  | { kind: "challenge"; marker: string }
  | { kind: "upstream_http"; status: number };

export function pageProblem(page: OpenedPage): PageProblem | undefined {
  const marker = challengeMarker(page.title, page.text);
  if (marker !== undefined) return { kind: "challenge", marker };
  if (page.httpStatus !== undefined && page.httpStatus >= 400) {
    return { kind: "upstream_http", status: page.httpStatus };
  }
  return undefined;
}
