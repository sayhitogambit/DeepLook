import { Button, Spinner } from "@heroui/react";
import { useState } from "react";

type NymetricPackage = {
  service: "nymetric";
  goal: string;
  tools: [];
};

export function ServiceChoice() {
  const [chosen, setChosen] = useState(false);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState("");
  const [pack, setPack] = useState<NymetricPackage | null>(null);

  async function choose() {
    if (building) return;
    setBuilding(true);
    setError("");
    try {
      const response = await fetch("/api/service", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ service: "nymetric" }),
      });
      const body = (await response.json()) as NymetricPackage & { message?: string };
      if (!response.ok) {
        setError(body.message ?? "Nymetric could not be loaded.");
        return;
      }
      setPack(body);
      setChosen(true);
    } catch {
      setError("The search server did not load Nymetric.");
    } finally {
      setBuilding(false);
    }
  }

  return (
    <section className="service" aria-label="Service">
      <div className="choice">
        <p>Service</p>
        <Button
          type="button"
          aria-pressed={chosen}
          data-selected={chosen}
          isDisabled={building}
          onPress={() => {
            void choose();
          }}
        >
          {building ? <Spinner size="sm" /> : "Nymetric"}
        </Button>
      </div>
      {!pack ? <p className="hint">Tools appear when you choose a service.</p> : null}
      {error ? <p className="error">{error}</p> : null}
      {pack ? (
        <>
          <p className="goal">{pack.goal}</p>
          <p className="hint">No tools. nymetric.com has not published an API.</p>
        </>
      ) : null}
    </section>
  );
}
