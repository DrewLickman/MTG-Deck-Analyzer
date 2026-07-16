import test from "node:test";
import assert from "node:assert/strict";
import { addCardToOpeningHand, analyzeOpeningHand, drawOpeningHand, removeCardFromOpeningHand } from "../lib/openingHand.mjs";

function card(name, options = {}) {
  return {
    name,
    type_line: options.type_line || "Sorcery",
    oracle_text: options.oracle_text || "",
    cmc: options.cmc ?? 2,
    mana_cost: options.mana_cost || "{1}{G}",
    produced_mana: options.produced_mana,
  };
}

function mapOf(cards) {
  return Object.fromEntries(cards.flatMap((item) => [[item.name, item], [item.name.toLowerCase(), item]]));
}

test("each opening hand starts from the full main deck", () => {
  const deck = {
    main: Array.from({ length: 8 }, (_, index) => ({ qty: 1, name: `Card ${index + 1}` })),
  };
  const first = drawOpeningHand(deck, () => 0);
  const second = drawOpeningHand(deck, () => 0);

  assert.equal(first.length, 7);
  assert.deepEqual(second, first);
  assert.equal(deck.main.length, 8);
});

test("manual opening-hand selection respects deck quantities and seven-card limit", () => {
  const deck = {
    main: [
      { qty: 2, name: "Forest" },
      ...Array.from({ length: 6 }, (_, index) => ({ qty: 1, name: `Spell ${index + 1}` })),
    ],
  };
  let hand = [];
  hand = addCardToOpeningHand(deck, hand, "forest");
  hand = addCardToOpeningHand(deck, hand, "Forest");
  hand = addCardToOpeningHand(deck, hand, "Forest");
  assert.deepEqual(hand, [{ name: "Forest", copyIndex: 0 }, { name: "Forest", copyIndex: 1 }]);

  for (let index = 1; index <= 6; index += 1) hand = addCardToOpeningHand(deck, hand, `Spell ${index}`);
  assert.equal(hand.length, 7);
  assert.equal(hand.some((entry) => entry.name === "Spell 6"), false);

  hand = removeCardFromOpeningHand(hand, 0);
  assert.equal(hand.length, 6);
  hand = addCardToOpeningHand(deck, hand, "Forest");
  assert.equal(hand.at(-1).copyIndex, 0);
});

test("opening-hand analysis rewards balanced mana, early action, and card flow", () => {
  const lands = [
    card("Forest", { type_line: "Land", cmc: 0, mana_cost: "", produced_mana: ["G"] }),
    card("Island", { type_line: "Land", cmc: 0, mana_cost: "", produced_mana: ["U"] }),
    card("Command Tower", { type_line: "Land", cmc: 0, mana_cost: "", produced_mana: ["W", "U", "B", "R", "G"] }),
  ];
  const ramp = card("Nature's Lore", { oracle_text: "Search your library for a Forest card, put that card onto the battlefield.", cmc: 2 });
  const draw = card("Chart a Course", { oracle_text: "Draw two cards, then discard a card.", cmc: 2 });
  const engine = card("Token Engine", { oracle_text: "Whenever you cast a spell, create a 1/1 token.", cmc: 2 });
  const removal = card("Quick Answer", { type_line: "Instant", oracle_text: "Destroy target creature.", cmc: 1 });
  const cards = [...lands, ramp, draw, engine, removal];
  const hand = cards.map((item) => ({ name: item.name }));
  const analysis = analyzeOpeningHand({
    deck: { main: cards.map((item) => ({ qty: 1, name: item.name })) },
    hand,
    cardMap: mapOf(cards),
    coreCards: ["Token Engine"],
  });

  assert.ok(analysis.score >= 78);
  assert.equal(analysis.verdict.label, "Strong keep");
  assert.equal(analysis.metrics.lands, 3);
  assert.equal(analysis.metrics.coloredSources, 3);
  assert.ok(analysis.metrics.earlyPlays >= 3);
  assert.ok(analysis.strengths.some((item) => item.includes("functional mana base")));
});

test("colorless-only and non-mana lands do not support a strong keep", () => {
  const wastes = card("Wastes", { type_line: "Basic Land — Wastes", cmc: 0, mana_cost: "", produced_mana: ["C"] });
  const ancientTomb = card("Ancient Tomb", { type_line: "Land", oracle_text: "{T}: Add {C}{C}.", cmc: 0, mana_cost: "", produced_mana: ["C"] });
  const maze = card("Maze of Ith", { type_line: "Land", oracle_text: "Untap target attacking creature. Prevent all combat damage.", cmc: 0, mana_cost: "", produced_mana: [] });
  const spells = [
    card("Cheap Draw", { type_line: "Instant", oracle_text: "Draw two cards.", cmc: 1 }),
    card("Cheap Ramp", { oracle_text: "Search your library for a basic land card, put it onto the battlefield.", cmc: 2 }),
    card("Cheap Engine", { type_line: "Artifact", oracle_text: "Whenever you cast a spell, create a token.", cmc: 2 }),
    card("Cheap Answer", { type_line: "Instant", oracle_text: "Destroy target creature.", cmc: 1 }),
  ];
  const coloredLands = [
    card("Plains", { type_line: "Basic Land — Plains", cmc: 0, mana_cost: "", produced_mana: ["W"] }),
    card("Island", { type_line: "Basic Land — Island", cmc: 0, mana_cost: "", produced_mana: ["U"] }),
    card("Forest", { type_line: "Basic Land — Forest", cmc: 0, mana_cost: "", produced_mana: ["G"] }),
  ];
  const cards = [wastes, ancientTomb, maze, ...spells, ...coloredLands];
  const hand = [wastes, ancientTomb, maze, ...spells].map((item) => ({ name: item.name }));
  const result = analyzeOpeningHand({
    deck: { main: cards.map((item) => ({ qty: 1, name: item.name })) },
    hand,
    cardMap: mapOf(cards),
  });

  assert.equal(result.metrics.lands, 3);
  assert.equal(result.metrics.coloredSources, 0);
  assert.equal(result.metrics.nonColoredLands, 3);
  assert.notEqual(result.verdict.label, "Strong keep");
  assert.ok(result.concerns.some((item) => item.includes("cannot produce colored mana")));
  assert.equal(result.glueNeeds[0].key, "manaSources");
  assert.deepEqual(result.glueNeeds[0].examples.map((item) => item.name), ["Forest", "Island", "Plains"]);
});

test("glue recommendations group repairs by missing category with up to three examples", () => {
  const forest = card("Forest", { type_line: "Basic Land — Forest", cmc: 0, mana_cost: "" });
  const island = card("Island", { type_line: "Basic Land — Island", cmc: 0, mana_cost: "" });
  const tower = card("Command Tower", { type_line: "Land", cmc: 0, mana_cost: "" });
  const expensive = Array.from({ length: 6 }, (_, index) => card(`Expensive ${index + 1}`, { type_line: "Creature", cmc: 6 + index }));
  const selection = card("Hand Smoother", { type_line: "Instant", oracle_text: "Scry 2, then draw a card.", cmc: 1 });
  const cards = [forest, island, tower, ...expensive, selection];
  const hand = [forest, ...expensive].map((item) => ({ name: item.name }));
  const result = analyzeOpeningHand({
    deck: { main: cards.map((item) => ({ qty: 1, name: item.name })) },
    hand,
    cardMap: mapOf(cards),
    analysis: { scores: [{ name: "Hand Smoother", score: 8 }] },
  });

  assert.equal(result.verdict.label, "Mulligan");
  assert.ok(result.concerns.some((item) => item.includes("Only 1 colored mana source")));
  assert.equal(result.glueNeeds[0].key, "manaSources");
  assert.equal(result.glueNeeds[0].label, "Mana Sources");
  assert.ok(result.glueNeeds[0].examples.some((item) => ["Island", "Command Tower"].includes(item.name)));
  assert.ok(result.glueNeeds.every((need) => need.examples.length <= 3));
  assert.ok(result.glueNeeds.flatMap((need) => need.examples).every((item) => item.improvement > 0));
  assert.match(result.glueSummary, /missing categories/);
});
