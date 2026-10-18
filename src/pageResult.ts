import { challengeMarker } from "./challenge.js";
import type { OpenedPage } from "./openPage.js";

export type PageProblem =
  | { kind: "challenge"; marker: string }
  | { kind: "access_wall"; marker: string }
  | { kind: "empty_content" }
  | { kind: "upstream_http"; status: number };

export function pageProblem(page: OpenedPage): PageProblem | undefined {
  const marker = challengeMarker(page.title, page.text);
  if (marker !== undefined) return { kind: "challenge", marker };
  if (page.httpStatus !== undefined && page.httpStatus >= 400) {
    return { kind: "upstream_http", status: page.httpStatus };
  }
  const visible = page.text.replace(/[\p{White_Space}\p{Default_Ignorable_Code_Point}]/gu, "");
  if (visible.length === 0) return { kind: "empty_content" };
  // An isolated continue gate is not the requested page. A normal shopping
  // page containing the same button must still be readable.
  if (page.text.trim().length < 500 &&
    /^click the button below to continue shopping\s+continue shopping(?:\s|$)/i.test(page.text.trim())) {
    return { kind: "access_wall", marker: "continue shopping gate" };
  }
  return undefined;
}
