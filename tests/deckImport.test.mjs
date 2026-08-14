import test from "node:test";
import assert from "node:assert/strict";
import { ARCHIDEKT_API_BASE } from "../lib/archidekt.mjs";
import { importDeck } from "../lib/deckImport.mjs";
import { DECKLIST_GG_IMPORT_ENDPOINT } from "../lib/decklistgg.mjs";

function response({ ok = true, status = 200, payload, contentType = "application/json" }) {
  return {
    ok,
    status,
    headers: { get: () => contentType },
    json: async () => payload,
  };
}

test("uses Decklist.gg as the primary Moxfield importer", async () => {
  const calls = [];
  const result = await importDeck("https://moxfield.com/decks/abc12345", async (url, options) => {
    calls.push({ url, options });
    return response({ payload: {
      commander: [{ name: "Kykar, Wind's Fury" }],
      mainboard: [{ name: "Sol Ring" }],
    } });
  });

  assert.equal(result.source, "decklist.gg");
  assert.equal(result.platform, "moxfield");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, DECKLIST_GG_IMPORT_ENDPOINT);
});

test("falls back to Moxfield only when the Decklist.gg primary fails", async () => {
  const calls = [];
  const result = await importDeck("https://moxfield.com/decks/abc12345", async (url) => {
    calls.push(url);
    if (url === DECKLIST_GG_IMPORT_ENDPOINT) {
      return response({ ok: false, status: 503, payload: { error: "temporarily unavailable" } });
    }
    return response({ payload: {
      boards: {
        commanders: { cards: { a: { card: { name: "Kykar, Wind's Fury" } } } },
        mainboard: { cards: { b: { card: { name: "Sol Ring" } } } },
      },
    } });
  });

  assert.equal(result.source, "moxfield");
  assert.match(result.importWarnings[0], /Decklist\.gg import unavailable/);
  assert.match(calls[1], /api2\.moxfield\.com\/v3/);
});

test("imports Archidekt directly because Decklist.gg does not support it", async () => {
  const calls = [];
  const result = await importDeck("https://archidekt.com/decks/365563/brago-blink", async (url) => {
    calls.push(url);
    return response({ payload: {
      name: "Brago Blink",
      cards: [
        { quantity: 1, categories: ["Commander"], card: { oracleCard: { name: "Brago, King Eternal" } } },
        { quantity: 1, categories: ["Ramp"], card: { oracleCard: { name: "Sol Ring" } } },
      ],
    } });
  });

  assert.equal(result.source, "archidekt");
  assert.equal(result.platform, "archidekt");
  assert.deepEqual(result.commanders, ["Brago, King Eternal"]);
  assert.deepEqual(calls, [`${ARCHIDEKT_API_BASE}/365563/`]);
});
