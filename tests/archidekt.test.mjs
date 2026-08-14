import test from "node:test";
import assert from "node:assert/strict";
import { ARCHIDEKT_API_BASE, fetchArchidektDeck, normalizeArchidektDeck } from "../lib/archidekt.mjs";

function card(name, categories, extra = {}) {
  return {
    quantity: extra.quantity || 1,
    categories,
    companion: extra.companion || null,
    card: { oracleCard: { name } },
  };
}

test("normalizes Archidekt categories into command, main, side, and considering sections", () => {
  const normalized = normalizeArchidektDeck({
    name: "Brago Blink",
    owner: { username: "Wildcard" },
    deckFormat: 3,
    cards: [
      card("Brago, King Eternal", ["Commander"]),
      card("Sol Ring", ["Ramp"]),
      card("Counterspell", ["Interaction"], { quantity: 2 }),
      card("Lightning Greaves", ["Sideboard"]),
      card("Windfall", ["Maybeboard"]),
      card("Keruga, the Macrosage", ["Companion"]),
    ],
  });

  assert.deepEqual(normalized.commanders, ["Brago, King Eternal"]);
  assert.deepEqual(normalized.companions, ["Keruga, the Macrosage"]);
  assert.equal(normalized.name, "Brago Blink");
  assert.equal(normalized.playerName, "Wildcard");
  assert.equal(normalized.deckText, "1 Sol Ring\n2 Counterspell\n\nSideboard:\n1 Lightning Greaves\n\nConsidering:\n1 Windfall");
});

test("fetches an Archidekt deck from its public deck endpoint", async () => {
  const calls = [];
  const payload = { id: 365563, cards: [] };
  const result = await fetchArchidektDeck("365563", async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, json: async () => payload };
  });

  assert.equal(result, payload);
  assert.equal(calls[0].url, `${ARCHIDEKT_API_BASE}/365563/`);
  assert.equal(calls[0].options.cache, "no-store");
});
