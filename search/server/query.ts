import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const BROWSER = process.env.DEEPLOOK_BROWSER_URL ?? "http://127.0.0.1:47231/v1/open";
const MIMO_URL = "https://token-plan-sgp.xiaomimimo.com/v1/chat/completions";
const PROMPT_PATH =
  process.env.DEEPLOOK_PROMPT_PATH ?? fileURLToPath(new URL("./system-prompt.md", import.meta.url));

type Send = (event: string, data: unknown) => void;

type OpenResult = {
  ok: boolean;
  url: string;
  title: string;
  text: string;
  error?: string;
};

const STATUSES = [
  "🔍 DeepLook is analyzing semantic context...",
  "🌐 Querying authoritative sources via Mimo API...",
  "📊 Synthesizing structured data...",
  "✨ Writing the answer from the pages the browser opened...",
] as const;

export async function runQuery(query: string, send: Send): Promise<void> {
  send("status", { text: STATUSES[0] });

  const searchUrl = `https://search.yahoo.com/search?p=${encodeURIComponent(query)}`;
  const search = await openPage(searchUrl);
  const pageUrls = pickResultUrls(search.text, searchUrl).slice(0, 2);
  const pages = [search, ...(await Promise.all(pageUrls.map((url) => openPage(url))))];

  send("status", { text: STATUSES[1] });
  send("sources", {
    sources: pages.map((page, index) => ({
      index: index + 1,
      url: page.url,
      title: page.title,
      ok: page.ok,
      citable: isCitable(page),
      error: page.error ?? null,
    })),
  });

  const apiKey = process.env.MIMO_API_KEY;
  if (!apiKey) {
    send("error", {
      message:
        "Set MIMO_API_KEY to your Xiaomi MiMo token. DeepLook calls https://token-plan-sgp.xiaomimimo.com/v1/chat/completions and will not invent an answer without it.",
    });
    return;
  }

  if (!pages.some(isCitable)) {
    send("error", {
      message: `The browser returned no page text. Check that POST ${BROWSER} is up.`,
    });
    return;
  }

  send("status", { text: STATUSES[2] });
  const answer = await askMimo(apiKey, query, pages);
  send("status", { text: STATUSES[3] });
  send("answer", { text: answer });
}

async function openPage(url: string): Promise<OpenResult> {
  try {
    const response = await fetch(BROWSER, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url, timeoutMs: 45000 }),
    });
    const body = (await response.json()) as {
      title?: string;
      text?: string;
      finalUrl?: string;
      message?: string;
      error?: string;
    };
    if (!response.ok || body.error) {
      return {
        ok: false,
        url,
        title: body.title ?? "",
        text: "",
        error: body.message ?? body.error ?? `Browser returned ${response.status}`,
      };
    }
    return {
      ok: true,
      url: body.finalUrl ?? url,
      title: body.title ?? url,
      text: (body.text ?? "").slice(0, 6000),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Browser request failed.";
    return { ok: false, url, title: "", text: "", error: message };
  }
}

function pickResultUrls(text: string, searchUrl: string): string[] {
  const crumbs = text.match(/https?:\/\/[^\s›]+(?:\s*›\s*[^\s›]+)+/g) ?? [];
  const plain = text.match(/https?:\/\/[^\s<>"')\]]+/g) ?? [];
  const found = [
    ...crumbs.map((crumb) => crumb.replace(/\s*›\s*/g, "/")),
    ...plain,
  ];
  const skipped = ["yahoo.com", "yahoo.net", "gstatic.com", "google.com", "bing.com", "youtube.com"];
  const urls: string[] = [];
  for (const raw of found) {
    const cleaned = raw.replace(/[.,;]+$/, "");
    let parsed: URL;
    try {
      parsed = new URL(cleaned);
    } catch {
      continue;
    }
    if (cleaned === searchUrl || skipped.some((host) => parsed.hostname.endsWith(host))) continue;
    if (parsed.pathname === "/" || parsed.pathname === "/wiki/Main_Page") continue;
    if (!urls.includes(parsed.toString())) urls.push(parsed.toString());
  }
  return urls;
}

function isCitable(page: OpenResult): boolean {
  return page.text.trim().length > 0;
}

function systemPrompt(): string {
  const file = readFileSync(PROMPT_PATH, "utf8");
  const fenced = file.match(/```\n([\s\S]*?)\n```/);
  return fenced?.[1] ?? file;
}

async function askMimo(apiKey: string, query: string, pages: OpenResult[]): Promise<string> {
  const model = process.env.MIMO_MODEL ?? "mimo-v2.6-flash";
  const sourceBlock = pages
    .map((page, index) => {
      const n = index + 1;
      const heading = `[web:${n}] ${page.title || page.url}\n${page.url}`;
      if (!isCitable(page)) {
        return `${heading}\nno page text, do not cite`;
      }
      return `${heading}\n${page.text.slice(0, 2500)}`;
    })
    .join("\n\n");
  const response = await fetch(MIMO_URL, {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      thinking: { type: "disabled" },
      messages: [
        { role: "system", content: systemPrompt() },
        {
          role: "user",
          content: `Question: ${query}\n\nOpen with the direct reply, then use markdown ## sections. Sources are numbered in the order they were opened. Cite a source inline as [web:N] using that same N. A source that says "no page text, do not cite" must not be cited. Do not add a references section.\n\n${sourceBlock}`,
        },
      ],
    }),
  });
  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
    message?: string;
  };
  if (!response.ok) {
    throw new Error(body.error?.message ?? body.message ?? `Mimo returned ${response.status}`);
  }
  const content = body.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("Mimo returned an empty answer.");
  return content;
}
