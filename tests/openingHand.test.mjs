import test from "node:test";
import assert from "node:assert/strict";
import { addCardToOpeningHand, analyzeOpeningHand, bottomCardsForLondonMulligan, buildGoldfishPlan, drawFutureCards, drawOpeningHand, drawOpeningSample, removeCardFromOpeningHand } from "../lib/openingHand.mjs";

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

test("opening samples preserve three future draws and manual draws exclude the selected hand", () => {
  const deck = { main: Array.from({ length: 10 }, (_, index) => ({ qty: 1, name: `Card ${index + 1}` })) };
  const sample = drawOpeningSample(deck, () => 0);
  assert.equal(sample.hand.length, 7);
  assert.equal(sample.futureDraws.length, 3);
  assert.equal(new Set([...sample.hand, ...sample.futureDraws].map((entry) => entry.name)).size, 10);

  const manualDraws = drawFutureCards(deck, sample.hand, () => 0);
  assert.equal(manualDraws.length, 3);
  assert.ok(manualDraws.every((entry) => !sample.hand.some((held) => held.name === entry.name)));
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

test("London mulligans draw seven, bottom exact cards, and analyze final sizes", () => {
  const cards = [
    card("Forest", { type_line: "Land", cmc: 0, mana_cost: "", produced_mana: ["G"] }),
    card("Island", { type_line: "Land", cmc: 0, mana_cost: "", produced_mana: ["U"] }),
    ...Array.from({ length: 5 }, (_, index) => card(`Spell ${index + 1}`, { cmc: index + 1 })),
  ];
  const seven = cards.map((item) => ({ name: item.name }));
  const six = bottomCardsForLondonMulligan(seven, [6], 1);
  const five = bottomCardsForLondonMulligan(seven, [5, 6], 2);

  assert.equal(six.length, 6);
  assert.equal(five.length, 5);
  assert.throws(() => bottomCardsForLondonMulligan(seven, [6], 2), /Choose exactly 2/);

  const result = analyzeOpeningHand({ deck: { main: cards.map((item) => ({ qty: 1, name: item.name })) }, hand: five, cardMap: mapOf(cards) });
  assert.equal(result.metrics.handSize, 5);
  assert.match(result.glueSummary, /5-card hand|already cohesive/);
  assert.doesNotMatch(result.glueSummary, /exact seven/);
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
  assert.ok(analysis.metrics.earlyPlays >= 2);
  assert.equal(analysis.metrics.manaSources, 3);
  assert.ok(analysis.strengths.some((item) => item.includes("mana-producing lands")));
});

test("analyzed hands place lands first and sort nonlands by ascending mana value", () => {
  const cards = [
    card("Five Drop", { type_line: "Creature", cmc: 5 }),
    card("Island", { type_line: "Basic Land — Island", cmc: 0, mana_cost: "", produced_mana: ["U"] }),
    card("Two Drop", { type_line: "Creature", cmc: 2 }),
    card("Forest", { type_line: "Basic Land — Forest", cmc: 0, mana_cost: "", produced_mana: ["G"] }),
    card("One Drop", { type_line: "Creature", cmc: 1 }),
    card("Four Drop", { type_line: "Creature", cmc: 4 }),
    card("Three Drop", { type_line: "Creature", cmc: 3 }),
  ];
  const result = analyzeOpeningHand({
    deck: { main: cards.map((item) => ({ qty: 1, name: item.name })) },
    hand: cards.map((item) => ({ name: item.name })),
    cardMap: mapOf(cards),
  });

  assert.deepEqual(result.cards.map((item) => item.name), [
    "Forest",
    "Island",
    "One Drop",
    "Two Drop",
    "Three Drop",
    "Four Drop",
    "Five Drop",
  ]);
});

test("colorless-only and non-mana lands remain distinct mana facts", () => {
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
  assert.equal(result.metrics.manaSources, 2);
  assert.equal(result.metrics.coloredSources, 0);
  assert.equal(result.metrics.colorlessSources, 2);
  assert.equal(result.metrics.nonManaLands, 1);
  assert.notEqual(result.verdict.label, "Strong keep");
  assert.ok(result.concerns.some((item) => item.includes("cannot produce mana")));
  assert.equal(result.glueNeeds[0].key, "manaSources");
  assert.deepEqual(result.glueNeeds[0].examples.map((item) => item.name), ["Forest"]);
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
  assert.ok(result.concerns.some((item) => item.includes("Only 1 mana-producing land source")));
  assert.equal(result.glueNeeds[0].key, "manaSources");
  assert.equal(result.glueNeeds[0].label, "Mana Sources");
  assert.ok(result.glueNeeds[0].examples.some((item) => ["Island", "Command Tower"].includes(item.name)));
  assert.ok(result.glueNeeds.every((need) => need.examples.length <= 3));
  assert.ok(result.glueNeeds.flatMap((need) => need.examples).every((item) => item.improvement > 0));
  assert.match(result.glueSummary, /missing categories/);
});

test("multiple major repair categories cannot remain labeled strong keep", () => {
  const mana = [
    card("Forest", { type_line: "Land", cmc: 0, mana_cost: "", produced_mana: ["G"] }),
    card("Island", { type_line: "Land", cmc: 0, mana_cost: "", produced_mana: ["U"] }),
  ];
  const heavy = Array.from({ length: 5 }, (_, index) => card(`Heavy ${index + 1}`, { type_line: "Creature", cmc: 6, oracle_text: "Flying." }));
  const repair = [
    card("Cheap Ramp", { cmc: 2, oracle_text: "Search your library for a basic land card, put it onto the battlefield." }),
    card("Cheap Draw", { cmc: 2, oracle_text: "Draw two cards." }),
  ];
  const cards = [...mana, ...heavy, ...repair];
  const result = analyzeOpeningHand({
    deck: { main: cards.map((item) => ({ qty: 1, name: item.name })) },
    hand: [...mana, ...heavy].map((item) => ({ name: item.name })),
    cardMap: mapOf(cards),
  });

  assert.notEqual(result.verdict.label, "Strong keep");
  assert.ok(result.glueNeeds.length > 0);
  assert.ok(result.glueNeeds.flatMap((need) => need.examples).every((example) => Number.isFinite(example.resultingScore)));
});

test("a one-land hand full of two-drops and top end is a mulligan", () => {
  const land = card("Forest", { type_line: "Basic Land — Forest", cmc: 0, mana_cost: "", produced_mana: ["G"] });
  const spells = [
    card("Two A", { type_line: "Creature", cmc: 2, mana_cost: "{1}{G}" }),
    card("Two B", { type_line: "Creature", cmc: 2, mana_cost: "{1}{G}" }),
    card("Three", { type_line: "Creature", cmc: 3, mana_cost: "{2}{G}" }),
    card("Five", { type_line: "Creature", cmc: 5, mana_cost: "{4}{G}" }),
    card("Seven", { type_line: "Creature", cmc: 7, mana_cost: "{6}{G}" }),
    card("Eight", { type_line: "Creature", cmc: 8, mana_cost: "{7}{G}" }),
  ];
  const cards = [land, ...spells];
  const result = analyzeOpeningHand({
    deck: { main: cards.map((item) => ({ qty: 1, name: item.name })) },
    hand: cards.map((item) => ({ name: item.name })),
    cardMap: mapOf(cards),
    analysis: { colorPips: { G: 12 } },
  });

  assert.ok(result.score < 45);
  assert.equal(result.verdict.label, "Mulligan");
  assert.equal(result.metrics.earlyPlays, 0);
  assert.ok(result.concerns.some((item) => item.includes("1 lands has no immediately castable")));
});

test("a colorless-producing land counts when the colored lands cover a two-color deck", () => {
  const cards = [
    card("Forest", { type_line: "Basic Land — Forest", cmc: 0, mana_cost: "", produced_mana: ["G"] }),
    card("Island", { type_line: "Basic Land — Island", cmc: 0, mana_cost: "", produced_mana: ["U"] }),
    card("Command Tower", { type_line: "Land", cmc: 0, mana_cost: "", produced_mana: ["G", "U"] }),
    card("Wastes", { type_line: "Basic Land — Wastes", cmc: 0, mana_cost: "", produced_mana: ["C"] }),
    card("Green Setup", { cmc: 2, mana_cost: "{1}{G}", oracle_text: "Draw a card." }),
    card("Blue Setup", { cmc: 2, mana_cost: "{1}{U}", oracle_text: "Scry 2, then draw a card." }),
    card("Payoff", { type_line: "Creature", cmc: 3, mana_cost: "{2}{G}" }),
  ];
  const result = analyzeOpeningHand({
    deck: { main: cards.map((item) => ({ qty: 1, name: item.name })) },
    hand: cards.map((item) => ({ name: item.name })),
    cardMap: mapOf(cards),
    analysis: { colorPips: { G: 8, U: 6 } },
  });

  assert.equal(result.metrics.lands, 4);
  assert.equal(result.metrics.manaSources, 4);
  assert.equal(result.metrics.colorlessSources, 1);
  assert.deepEqual(result.metrics.coveredColors, ["U", "G"]);
  assert.deepEqual(result.metrics.missingColors, []);
  assert.ok(result.strengths.some((item) => item.includes("already covers every deck color")));
  assert.ok(!result.concerns.some((item) => item.includes("colorless mana")));
});

test("missing early colors and non-mana lands receive precise warnings", () => {
  const cards = [
    card("Forest", { type_line: "Basic Land — Forest", cmc: 0, mana_cost: "", produced_mana: ["G"] }),
    card("Maze of Ith", { type_line: "Land", cmc: 0, mana_cost: "", produced_mana: [] }),
    card("Black Spell", { cmc: 2, mana_cost: "{1}{B}", oracle_text: "Draw a card." }),
    card("Green Spell", { cmc: 2, mana_cost: "{1}{G}", oracle_text: "Draw a card." }),
    card("Expensive One", { type_line: "Creature", cmc: 6, mana_cost: "{5}{B}" }),
    card("Expensive Two", { type_line: "Creature", cmc: 6, mana_cost: "{5}{B}" }),
    card("Expensive Three", { type_line: "Creature", cmc: 6, mana_cost: "{5}{B}" }),
  ];
  const result = analyzeOpeningHand({
    deck: { main: cards.map((item) => ({ qty: 1, name: item.name })) },
    hand: cards.map((item) => ({ name: item.name })),
    cardMap: mapOf(cards),
    analysis: { colorPips: { G: 3, B: 9 } },
  });

  assert.ok(result.concerns.some((item) => item.includes("black mana needed by its early spells")));
  assert.ok(result.concerns.some((item) => item.includes("cannot produce mana")));
});

test("the goldfish draws on turn one, uses colorless mana, and can cast a Commander", () => {
  const cards = [
    card("Wastes", { type_line: "Basic Land — Wastes", cmc: 0, mana_cost: "", produced_mana: ["C"] }),
    card("Sol Ring", { type_line: "Artifact", cmc: 1, mana_cost: "{1}", oracle_text: "{T}: Add {C}{C}.", produced_mana: ["C"] }),
    card("Colorless Spell", { type_line: "Artifact", cmc: 1, mana_cost: "{C}" }),
    card("Island", { type_line: "Basic Land — Island", cmc: 0, mana_cost: "", produced_mana: ["U"] }),
    card("Commander", { type_line: "Legendary Creature", cmc: 2, mana_cost: "{1}{U}", oracle_text: "Flying." }),
  ];
  const plan = buildGoldfishPlan({
    hand: [{ name: "Wastes" }, { name: "Sol Ring" }, { name: "Colorless Spell" }, { name: "Island" }],
    futureDraws: [{ name: "Island", copyIndex: 1 }, { name: "Colorless Spell", copyIndex: 1 }, { name: "Colorless Spell", copyIndex: 2 }],
    commanders: [{ name: "Commander" }],
    cardMap: mapOf(cards),
    analysis: { colorPips: { U: 4 } },
  });

  assert.equal(plan.turns.length, 3);
  assert.equal(plan.turns[0].draw.name, "Island");
  assert.ok(plan.turns.flatMap((turn) => turn.plays).some((play) => play.name === "Colorless Spell"));
  assert.ok(plan.turns.flatMap((turn) => turn.plays).some((play) => play.name === "Commander" && play.zone === "command"));
});

test("extreme land counts are capped and future draws do not alter the mulligan grade", () => {
  const land = card("Forest", { type_line: "Basic Land — Forest", cmc: 0, mana_cost: "", produced_mana: ["G"] });
  const spell = card("Cheap Spell", { type_line: "Creature", cmc: 2, mana_cost: "{1}{G}" });
  const cards = [land, spell];
  const deck = { main: [{ qty: 7, name: "Forest" }, { qty: 7, name: "Cheap Spell" }] };
  for (const landCount of [0, 1, 6, 7]) {
    const hand = [...Array.from({ length: landCount }, () => ({ name: "Forest" })), ...Array.from({ length: 7 - landCount }, () => ({ name: "Cheap Spell" }))];
    const result = analyzeOpeningHand({ deck, hand, cardMap: mapOf(cards), analysis: { colorPips: { G: 7 } } });
    assert.ok(result.score <= 44, `${landCount}-land hand was ${result.score}`);
    assert.equal(result.verdict.label, "Mulligan");
  }
  const hand = [{ name: "Forest" }, ...Array.from({ length: 6 }, () => ({ name: "Cheap Spell" }))];
  const withoutDraws = analyzeOpeningHand({ deck, hand, cardMap: mapOf(cards), analysis: { colorPips: { G: 7 } } });
  const withDraws = analyzeOpeningHand({ deck, hand, cardMap: mapOf(cards), analysis: { colorPips: { G: 7 } }, futureDraws: [{ name: "Forest" }, { name: "Forest" }, { name: "Forest" }] });
  assert.equal(withoutDraws.score, withDraws.score);
  assert.equal(withoutDraws.verdict.label, withDraws.verdict.label);
});
