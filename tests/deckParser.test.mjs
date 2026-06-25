import test from "node:test";
import assert from "node:assert/strict";
import { parseDecklist, validateCommandZone } from "../lib/deckParser.mjs";

function card(name, oracle_text = "") {
  return { name, oracle_text, type_line: "Legendary Creature", legalities: { commander: "legal" } };
}

test("infers one commander from a separated bottom block", () => {
  const deck = parseDecklist(`
1 Whir of Invention
1 Whirlwind of Thought
1 Windbrisk Heights
1 Windfall
1 Young Pyromancer
1 Zinnia, Valley's Voice


1 Kykar, Wind's Fury
`);

  assert.deepEqual(deck.commanderNames, ["Kykar, Wind's Fury"]);
  assert.equal(deck.commandSource, "bottom-block");
  assert.equal(deck.main.some((entry) => entry.name === "Kykar, Wind's Fury"), false);
});

test("infers partner commanders from a two-card separated bottom block", () => {
  const deck = parseDecklist(`
1 Kiora, Behemoth Beckoner
1 Kodama's Reach
1 Lorthos, the Tidemaker
1 Misty Rainforest
1 Overwhelming Stampede
1 Raiders' Karve


1 Brinelin, the Moon Kraken
1 Gilanra, Caller of Wirewood
`);

  assert.deepEqual(deck.commanderNames, ["Brinelin, the Moon Kraken", "Gilanra, Caller of Wirewood"]);
  assert.equal(deck.expectedMainCount, 98);
  assert.equal(deck.commandSource, "bottom-block");
});

test("infers bottom commander after a separated sideboard block", () => {
  const deck = parseDecklist(`
1 Sol Ring
1 Arcane Signet
1 Windfall

SIDEBOARD:
1 Lightning Greaves
1 Swiftfoot Boots

1 Kykar, Wind's Fury
`);

  assert.deepEqual(deck.commanderNames, ["Kykar, Wind's Fury"]);
  assert.equal(deck.commandSource, "bottom-block");
  assert.equal(deck.sideboard.length, 2);
  assert.equal(deck.sideboard.some((entry) => entry.name === "Kykar, Wind's Fury"), false);
});

test("infers partner commanders after sideboard while preserving sideboard entries", () => {
  const deck = parseDecklist(`
1 Kodama's Reach
1 Misty Rainforest

Sideboard
1 Heroic Intervention

1 Brinelin, the Moon Kraken
1 Gilanra, Caller of Wirewood
`);

  assert.deepEqual(deck.commanderNames, ["Brinelin, the Moon Kraken", "Gilanra, Caller of Wirewood"]);
  assert.equal(deck.expectedMainCount, 98);
  assert.equal(deck.sideboard[0].name, "Heroic Intervention");
});

test("falls back to the first card when there is no separated command block", () => {
  const deck = parseDecklist(`
1 Zinnia, Valley's Voice
1 Sol Ring
1 Arcane Signet
`);

  assert.deepEqual(deck.commanderNames, ["Zinnia, Valley's Voice"]);
  assert.equal(deck.commandSource, "first-card");
  assert.equal(deck.main.some((entry) => entry.name === "Zinnia, Valley's Voice"), false);
});

test("does not steal the only sideboard block as a commander", () => {
  const deck = parseDecklist(`
1 Kykar, Wind's Fury
1 Sol Ring

Sideboard:
1 Lightning Greaves
`);

  assert.deepEqual(deck.commanderNames, ["Kykar, Wind's Fury"]);
  assert.equal(deck.sideboard[0].name, "Lightning Greaves");
});

test("explicit commander, companion, sideboard, and considering sections stay separate", () => {
  const deck = parseDecklist(`
Commander:
1 Kykar, Wind's Fury

Companion:
1 Keruga, the Macrosage

Deck:
1 Sol Ring
1 Island

Sideboard:
1 Lightning Greaves

Considering:
1 Cyclonic Rift
`);

  assert.deepEqual(deck.commanderNames, ["Kykar, Wind's Fury"]);
  assert.deepEqual(deck.companionNames, ["Keruga, the Macrosage"]);
  assert.equal(deck.main.length, 2);
  assert.equal(deck.sideboard[0].name, "Lightning Greaves");
  assert.equal(deck.considering[0].name, "Cyclonic Rift");
  assert.equal(deck.expectedMainCount, 99);
});

test("manual commander override wins over inferred identity", () => {
  const deck = parseDecklist(
    `
1 Sol Ring
1 Arcane Signet

1 Kykar, Wind's Fury
`,
    { commanderInput: "Zinnia, Valley's Voice" },
  );

  assert.deepEqual(deck.commanderNames, ["Zinnia, Valley's Voice"]);
  assert.equal(deck.commandSource, "manual");
});

test("parses common quantity and set-code export lines", () => {
  const deck = parseDecklist(`
1x Kykar, Wind's Fury (CMM) 311
* 1 Sol Ring (LTC) 279
1 Arcane Signet
`);

  assert.deepEqual(deck.commanderNames, ["Kykar, Wind's Fury"]);
  assert.equal(deck.main[0].name, "Sol Ring");
  assert.equal(deck.main[1].name, "Arcane Signet");
});

test("valid partner and companion flags come from card text", () => {
  const deck = parseDecklist(`
Commanders:
1 Brinelin, the Moon Kraken
1 Gilanra, Caller of Wirewood

Companion:
1 Keruga, the Macrosage

Deck:
1 Sol Ring
`);
  const validated = validateCommandZone(
    deck,
    {
      "Brinelin, the Moon Kraken": card("Brinelin, the Moon Kraken", "Partner"),
      "Gilanra, Caller of Wirewood": card("Gilanra, Caller of Wirewood", "Partner"),
      "Keruga, the Macrosage": card("Keruga, the Macrosage", "Companion"),
      "Sol Ring": card("Sol Ring"),
    },
    (cardMap, name) => cardMap[name],
    (cardData) => (cardData?.oracle_text || "").toLowerCase(),
  );

  assert.equal(validated.hasValidPartner, true);
  assert.equal(validated.hasValidCompanion, true);
});
