import test from "node:test";
import assert from "node:assert/strict";
import { extractMoxfieldId, normalizeMoxfieldDeck } from "../lib/moxfield.mjs";

test("extracts moxfield deck id from url or raw id", () => {
  assert.equal(extractMoxfieldId("https://moxfield.com/decks/BvKkr01dnEO8UbJi4Eu0_g"), "BvKkr01dnEO8UbJi4Eu0_g");
  assert.equal(extractMoxfieldId("BvKkr01dnEO8UbJi4Eu0_g"), "BvKkr01dnEO8UbJi4Eu0_g");
  assert.equal(extractMoxfieldId("https://example.com/nope"), null);
});

test("normalizes moxfield board json into deck text", () => {
  const normalized = normalizeMoxfieldDeck({
    name: "Test Deck",
    boards: {
      commanders: { cards: { a: { quantity: 1, card: { name: "Kykar, Wind's Fury" } } } },
      companions: { cards: { b: { quantity: 1, card: { name: "Keruga, the Macrosage" } } } },
      mainboard: { cards: { c: { quantity: 1, card: { name: "Sol Ring" } } } },
      sideboard: { cards: { d: { quantity: 1, card: { name: "Lightning Greaves" } } } },
      maybeboard: { cards: { e: { quantity: 2, card: { name: "Counterspell" } } } },
    },
  });

  assert.deepEqual(normalized.commanders, ["Kykar, Wind's Fury"]);
  assert.deepEqual(normalized.companions, ["Keruga, the Macrosage"]);
  assert.equal(normalized.deckText, "1 Sol Ring\n\nSideboard:\n1 Lightning Greaves\n\nConsidering:\n2 Counterspell");
});

