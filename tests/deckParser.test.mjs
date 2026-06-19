import test from "node:test";
import assert from "node:assert/strict";
import { parseDecklist } from "../lib/deckParser.mjs";

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
