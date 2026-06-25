import test from "node:test";
import assert from "node:assert/strict";
import { fetchScryfall } from "../lib/scryfall.mjs";

test("retries unresolved split cards with normalized named lookups", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("/cards/collection")) {
      return {
        ok: true,
        json: async () => ({
          data: [],
          not_found: [{ name: "Spiked Corridor // Torture Pit" }],
        }),
      };
    }
    if (String(url).includes("/cards/named") && String(url).includes("exact=Spiked+Corridor")) {
      return {
        ok: true,
        json: async () => ({
          name: "Spiked Corridor // Torture Pit",
          cmc: 5,
          mana_cost: "{3}{B}",
          oracle_text: "Test card.",
          type_line: "Sorcery",
        }),
      };
    }
    return { ok: false, json: async () => ({}) };
  };

  try {
    const progress = [];
    const result = await fetchScryfall(["Spiked Corridor/Torture Pit"], (message) => progress.push(message));

    assert.equal(result.notFound.length, 0);
    assert.equal(result.results["Spiked Corridor/Torture Pit"].name, "Spiked Corridor // Torture Pit");
    assert.equal(result.results["Spiked Corridor // Torture Pit"].name, "Spiked Corridor // Torture Pit");
    assert.ok(calls.some((call) => call.url.includes("/cards/named")));
    assert.equal(progress.some((message) => message.includes("Retrying unresolved card")), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
