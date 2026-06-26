import test from "node:test";
import assert from "node:assert/strict";
import { analyzeBracket } from "../lib/commanderBrackets.mjs";
import { GAME_CHANGER_METADATA, GAME_CHANGERS, validateGameChangerStaticData } from "../lib/gameChangers.mjs";

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
  const deck = deckWith(["Rhystic Study", "The One Ring", "Gaea's Cradle", "Consecrated Sphinx"]);
  const result = analyzeBracket(deck, {}, { avgCmc: 2.5, rampCount: 10, removalCount: 4 });

  assert.equal(result.gameChangers.length, 4);
  assert.ok(result.bracket >= 4);
});

test("static Game Changer data matches generated metadata", () => {
  const validation = validateGameChangerStaticData();

  assert.equal(GAME_CHANGER_METADATA.sourceQuery, "is:gamechanger");
  assert.equal(GAME_CHANGER_METADATA.commanderPaperQuery, "(game:paper) legal:commander is:gamechanger");
  assert.equal(GAME_CHANGER_METADATA.cardCount, 53);
  assert.equal(GAME_CHANGER_METADATA.commanderPaperCount, 53);
  assert.equal(GAME_CHANGER_METADATA.expectedCount, 53);
  assert.equal(GAME_CHANGERS.length, 53);
  assert.equal(validation.ok, true);
  assert.equal(validation.duplicateCount, 0);
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
  const deck = deckWith(["Demonic Tutor", "Fierce Guardianship", "Imperial Seal", "Ad Nauseam"]);
  const result = analyzeBracket(deck, {}, { avgCmc: 2.5, rampCount: 8, removalCount: 4 });

  assert.deepEqual(result.gameChangers, ["Demonic Tutor", "Fierce Guardianship", "Imperial Seal", "Ad Nauseam"]);
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
  assert.ok(result.dimensions.power.positive.some((item) => item.text.includes("compact combo")));
  assert.ok(result.dimensions.speed.positive.some((item) => item.text.includes("fast-mana")));
  assert.ok(result.dimensions.salt.positive.length);
});
