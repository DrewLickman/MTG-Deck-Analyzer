import test from "node:test";
import assert from "node:assert/strict";
import { analyzeBracket } from "../lib/commanderBrackets.mjs";

function deckWith(names) {
  return {
    commanders: [{ qty: 1, name: "Kykar, Wind's Fury" }],
    companions: [],
    main: names.map((name) => ({ qty: 1, name })),
    sideboard: [],
    considering: [],
    inferenceWarnings: [],
  };
}

function card(name, text = "") {
  return {
    name,
    cmc: 2,
    mana_cost: "{2}",
    oracle_text: text,
    type_line: "Instant",
    legalities: { commander: "legal" },
  };
}

test("Game Changer count raises the bracket floor", () => {
  const deck = deckWith(["Rhystic Study", "The One Ring", "Gaea's Cradle", "Mana Drain"]);
  const result = analyzeBracket(deck, {}, { avgCmc: 2.5, rampCount: 10, removalCount: 4 });

  assert.equal(result.gameChangers.length, 4);
  assert.ok(result.bracket >= 4);
});

test("sideboard Game Changers do not affect bracket calculation", () => {
  const deck = deckWith(["Sol Ring", "Arcane Signet"]);
  deck.sideboard = [
    { qty: 1, name: "The One Ring" },
    { qty: 1, name: "Cyclonic Rift" },
    { qty: 1, name: "Rhystic Study" },
    { qty: 1, name: "Gaea's Cradle" },
  ];
  const result = analyzeBracket(deck, {}, { avgCmc: 3.5, rampCount: 2, removalCount: 1 });

  assert.deepEqual(result.gameChangers, []);
  assert.equal(result.bracket, 2);
});

test("updated unban Game Changers are counted", () => {
  const deck = deckWith(["Gifts Ungiven", "Braids, Cabal Minion", "Coalition Victory", "Panoptic Mirror"]);
  const result = analyzeBracket(deck, {}, { avgCmc: 3, rampCount: 8, removalCount: 4 });

  assert.deepEqual(result.gameChangers, ["Gifts Ungiven", "Braids, Cabal Minion", "Coalition Victory", "Panoptic Mirror"]);
  assert.ok(result.bracket >= 4);
});

test("common noncommander Game Changers beyond the starter list are counted", () => {
  const deck = deckWith(["Demonic Tutor", "Fierce Guardianship", "Deflecting Swat", "Ad Nauseam"]);
  const result = analyzeBracket(deck, {}, { avgCmc: 2.5, rampCount: 8, removalCount: 4 });

  assert.deepEqual(result.gameChangers, ["Demonic Tutor", "Fierce Guardianship", "Deflecting Swat", "Ad Nauseam"]);
  assert.ok(result.bracket >= 4);
});

test("compact combo and speed signals produce a higher bracket", () => {
  const deck = deckWith(["Thassa's Oracle", "Demonic Consultation", "Ancient Tomb", "Mana Vault"]);
  const cardMap = {
    "Thassa's Oracle": card("Thassa's Oracle"),
    "Demonic Consultation": card("Demonic Consultation", "Name a card. Exile cards from your library."),
    "Ancient Tomb": card("Ancient Tomb"),
    "Mana Vault": card("Mana Vault"),
  };
  const result = analyzeBracket(deck, cardMap, { avgCmc: 2.2, rampCount: 10, removalCount: 4 });

  assert.ok(result.comboSignals.length >= 1);
  assert.ok(result.bracket >= 4);
});
