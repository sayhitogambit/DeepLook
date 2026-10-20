import { Combobox, ComboboxInput, ComboboxOption, ComboboxOptions, Disclosure, DisclosureButton, DisclosurePanel } from "@headlessui/react";
import { Button, Card, Input, Spinner } from "@heroui/react";
import { useState } from "react";
import { ServiceChoice } from "./ServiceChoice";

const EXAMPLES = [
  "How tall is Mount Everest?",
  "What is the Fetch API?",
  "Who is the president of the United States?",
];

const STATUS_ORDER = [
  "🔍 DeepLook is analyzing semantic context...",
  "🌐 Querying authoritative sources via Mimo API...",
  "📊 Synthesizing structured data...",
  "✨ Writing the answer from the pages the browser opened...",
];

type Source = {
  index: number;
  url: string;
  title: string;
  ok: boolean;
  error: string | null;
};

export function App() {
  const [query, setQuery] = useState("");
  const [running, setRunning] = useState(false);
  const [seen, setSeen] = useState<string[]>([]);
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [sources, setSources] = useState<Source[]>([]);

  async function ask(nextQuery: string) {
    const trimmed = nextQuery.trim();
    if (!trimmed || running) return;
    setQuery(trimmed);
    setRunning(true);
    setSeen([]);
    setAnswer("");
    setError("");
    setSources([]);
    const response = await fetch("/api/query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: trimmed }),
    });
    if (!response.body) {
      setError("The search server did not stream a response.");
      setRunning(false);
      return;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) applyEvent(part);
    }
    setRunning(false);
  }

  function applyEvent(part: string) {
    const eventLine = part.split("\n").find((line) => line.startsWith("event:"));
    const dataLine = part.split("\n").find((line) => line.startsWith("data:"));
    if (!eventLine || !dataLine) return;
    const event = eventLine.slice(6).trim();
    const data = JSON.parse(dataLine.slice(5)) as {
      text?: string;
      message?: string;
      sources?: Source[];
    };
    if (event === "status" && data.text) {
      setSeen((current) => (current.includes(data.text!) ? current : [...current, data.text!]));
    } else if (event === "sources" && data.sources) {
      setSources(data.sources);
    } else if (event === "answer" && data.text) {
      setAnswer(data.text);
    } else if (event === "error" && data.message) {
      setError(data.message);
    }
  }

  return (
    <main className="shell">
      <header className="mark">
        <h1>DeepLook</h1>
        <p>Search</p>
      </header>
      <ServiceChoice />
      <Combobox value={query} onChange={(value) => setQuery(value ?? "")} immediate>
        <form
          className="query"
          onSubmit={(event) => {
            event.preventDefault();
            void ask(query);
          }}
        >
          <ComboboxInput
            as={Input}
            aria-label="Question"
            placeholder="Ask for a sourced answer"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <Button type="submit" isDisabled={running}>
            {running ? <Spinner size="sm" /> : "Look"}
          </Button>
        </form>
        <ComboboxOptions className="status-list" modal={false}>
          {EXAMPLES.filter((item) => item.toLowerCase().includes(query.toLowerCase())).map((item) => (
            <ComboboxOption key={item} value={item} className="status-list">
              {item}
            </ComboboxOption>
          ))}
        </ComboboxOptions>
      </Combobox>
      <ul className="status-list">
        {STATUS_ORDER.map((status) => (
          <li key={status} data-on={seen.includes(status)}>
            {status}
          </li>
        ))}
      </ul>
      {error ? <p className="error">{error}</p> : null}
      {answer ? (
        <Card className="answer">
          <Card.Content>
            <Answer text={answer} />
          </Card.Content>
        </Card>
      ) : null}
      {sources.length > 0 ? (
        <Disclosure as="div" className="answer">
          <DisclosureButton>Pages opened</DisclosureButton>
          <DisclosurePanel>
            <ul>
              {sources.map((source) => (
                <li key={source.url}>
                  [{source.ok ? "web" : "miss"}:{source.index}] {source.title || source.url}
                  {source.error ? ` — ${source.error}` : ""}
                </li>
              ))}
            </ul>
          </DisclosurePanel>
        </Disclosure>
      ) : null}
    </main>
  );
}

function Answer({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <>
      {blocks.map((block, index) => {
        const heading = block.match(/^(#{2,3})\s+(.*)$/);
        const cited = cite(heading ? heading[2] : block);
        if (heading?.[1] === "##") return <h2 key={index}>{cited}</h2>;
        if (heading?.[1] === "###") return <h3 key={index}>{cited}</h3>;
        return <p key={index}>{cited}</p>;
      })}
    </>
  );
}

function cite(text: string) {
  const parts = text.split(/(\[web:\d+\])/g);
  return parts.map((part, index) =>
    /^\[web:\d+\]$/.test(part) ? (
      <span key={index} className="cite">
        {part}
      </span>
    ) : (
      <span key={index}>{part}</span>
    ),
  );
}
