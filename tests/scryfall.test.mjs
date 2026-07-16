import test from "node:test";
import assert from "node:assert/strict";
import { fetchScryfall, seedScryfallResults } from "../lib/scryfall.mjs";
import { SCRYFALL_BATCH_SIZE, SOS_FULL_ART_BASICS } from "../lib/cardUtils.mjs";

test("basic land seeds use the English SOS full-art Spellcraft cycle", () => {
  const names = ["Plains", "Island", "Swamp", "Mountain", "Forest"];
  const results = seedScryfallResults(names);

  assert.deepEqual(names.map((name) => results[name].collector_number), ["267", "268", "269", "270", "271"]);
  for (const name of names) {
    assert.equal(results[name].set, "sos");
    assert.equal(results[name].lang, "en");
    assert.equal(results[name].full_art, true);
    assert.equal(results[name].image_uris.normal, SOS_FULL_ART_BASICS[name].image_uris.normal);
    assert.match(results[name].image_uris.normal, /^https:\/\/cards\.scryfall\.io\/normal\//);
  }
});

test("Wastes still receives live Scryfall image enrichment because SOS has no Wastes", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.match(String(url), /\/cards\/collection/);
    return {
      ok: true,
      json: async () => ({
        data: [{
          name: "Wastes",
          cmc: 0,
          mana_cost: "",
          type_line: "Basic Land — Wastes",
          image_uris: { normal: "https://cards.scryfall.io/normal/wastes.jpg" },
        }],
        not_found: [],
      }),
    };
  };

  try {
    const result = await fetchScryfall(["Wastes"]);
    assert.equal(result.results.Wastes.image_uris.normal, "https://cards.scryfall.io/normal/wastes.jpg");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

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

test("collection HTTP errors are not treated as successful imports", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("/cards/collection")) {
      return {
        ok: false,
        status: 500,
        statusText: "Server Error",
        json: async () => ({ details: "Temporary Scryfall issue." }),
      };
    }
    if (String(url).includes("/cards/named") && String(url).includes("Fallback+Test+Card")) {
      return {
        ok: true,
        json: async () => ({
          name: "Fallback Test Card",
          cmc: 2,
          mana_cost: "{1}{U}",
          oracle_text: "Draw a card.",
          type_line: "Instant",
        }),
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };

  try {
    console.warn = () => {};
    const result = await fetchScryfall(["Fallback Test Card"]);

    assert.equal(result.notFound.length, 0);
    assert.equal(result.results["Fallback Test Card"].name, "Fallback Test Card");
    assert.ok(calls[0].options.headers["User-Agent"]);
    assert.ok(calls.some((call) => call.url.includes("/cards/named")));
  } finally {
    console.warn = originalWarn;
    globalThis.fetch = originalFetch;
  }
});

test("transient collection failures retry the batch before named fallback", async () => {
  const originalFetch = globalThis.fetch;
  let collectionCalls = 0;
  let namedCalls = 0;

  globalThis.fetch = async (url, options) => {
    if (String(url).includes("/cards/collection")) {
      collectionCalls += 1;
      if (collectionCalls === 1) throw new TypeError("Failed to fetch");
      const identifiers = JSON.parse(options.body).identifiers;
      return {
        ok: true,
        json: async () => ({
          data: identifiers.map(({ name }) => ({
            name,
            cmc: 2,
            mana_cost: "{1}{R}",
            oracle_text: "",
            type_line: "Sorcery",
          })),
          not_found: [],
        }),
      };
    }
    if (String(url).includes("/cards/named")) namedCalls += 1;
    return { ok: false, status: 404, json: async () => ({}) };
  };

  try {
    const result = await fetchScryfall(["Transient Test Card"]);

    assert.equal(collectionCalls, 2);
    assert.equal(namedCalls, 0);
    assert.equal(result.notFound.length, 0);
    assert.equal(result.results["Transient Test Card"].name, "Transient Test Card");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetches Scryfall collection batches concurrently", async () => {
  const names = Array.from({ length: SCRYFALL_BATCH_SIZE + 1 }, (_, index) => `Parallel Test Card ${index}`);
  const originalFetch = globalThis.fetch;
  let collectionCalls = 0;
  let inFlight = 0;
  let maxInFlight = 0;

  globalThis.fetch = async (url, options) => {
    if (!String(url).includes("/cards/collection")) {
      return { ok: false, status: 404, json: async () => ({}) };
    }

    collectionCalls += 1;
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 10));
    inFlight -= 1;

    const identifiers = JSON.parse(options.body).identifiers;
    return {
      ok: true,
      json: async () => ({
        data: identifiers.map(({ name }) => ({
          name,
          cmc: 1,
          mana_cost: "{1}",
          oracle_text: "",
          type_line: "Artifact",
        })),
        not_found: [],
      }),
    };
  };

  try {
    const result = await fetchScryfall(names);

    assert.equal(collectionCalls, 2);
    assert.ok(maxInFlight > 1);
    assert.equal(result.notFound.length, 0);
    assert.equal(result.results["Parallel Test Card 0"].name, "Parallel Test Card 0");
    assert.equal(result.results[`Parallel Test Card ${SCRYFALL_BATCH_SIZE}`].name, `Parallel Test Card ${SCRYFALL_BATCH_SIZE}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
