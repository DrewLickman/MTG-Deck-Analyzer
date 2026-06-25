import test from "node:test";
import assert from "node:assert/strict";
import {
  DECKLIST_GG_IMPORT_ENDPOINT,
  fetchDecklistGgDeck,
  moxfieldDeckUrl,
  normalizeDecklistGgDeck,
} from "../lib/decklistgg.mjs";

test("normalizes Decklist.gg response into app import payload", () => {
  const normalized = normalizeDecklistGgDeck({
    playerName: "MagicalMongoose",
    deckName: "Look Ma, no hands!",
    format: "commander",
    mainboard: [
      { name: "Sol Ring", quantity: 1 },
      { name: "Malakir Rebirth // Malakir Mire", quantity: 1 },
    ],
    sideboard: [{ name: "Lightning Greaves", quantity: 1 }],
    commander: [{ name: "Djeru and Hazoret", quantity: 1 }],
  });

  assert.deepEqual(normalized.commanders, ["Djeru and Hazoret"]);
  assert.deepEqual(normalized.companions, []);
  assert.equal(normalized.name, "Look Ma, no hands!");
  assert.equal(normalized.playerName, "MagicalMongoose");
  assert.equal(normalized.format, "commander");
  assert.equal(normalized.deckText, "1 Sol Ring\n1 Malakir Rebirth // Malakir Mire\n\nSideboard:\n1 Lightning Greaves");
});

test("normalizes Decklist.gg object-style card sections", () => {
  const normalized = normalizeDecklistGgDeck({
    commanders: { a: { quantity: 1, card: { name: "Kykar, Wind's Fury" } } },
    companions: { b: { quantity: 1, card: { name: "Keruga, the Macrosage" } } },
    main: { c: { quantity: 2, card: { name: "Counterspell" } } },
    considering: { d: { quantity: 1, card: { name: "Windfall" } } },
  });

  assert.deepEqual(normalized.commanders, ["Kykar, Wind's Fury"]);
  assert.deepEqual(normalized.companions, ["Keruga, the Macrosage"]);
  assert.equal(normalized.deckText, "2 Counterspell\n\nConsidering:\n1 Windfall");
});

test("posts deck URL to Decklist.gg import endpoint", async () => {
  const calls = [];
  const payload = { mainboard: [{ name: "Sol Ring", quantity: 1 }], commander: [] };
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      json: async () => payload,
    };
  };

  const result = await fetchDecklistGgDeck("https://moxfield.com/decks/abc123", fetchImpl);

  assert.equal(result, payload);
  assert.equal(calls[0].url, DECKLIST_GG_IMPORT_ENDPOINT);
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].options.body), { url: "https://moxfield.com/decks/abc123" });
});

test("builds canonical Moxfield URL for Decklist.gg fallback", () => {
  assert.equal(moxfieldDeckUrl("DlEhQF9KOU-8iXpfmXzitg"), "https://moxfield.com/decks/DlEhQF9KOU-8iXpfmXzitg");
});
