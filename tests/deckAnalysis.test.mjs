import test from "node:test";
import assert from "node:assert/strict";
import { buildLocalAnalysis } from "../lib/deckAnalysis.mjs";
import { formatManaSymbols, formatTextSymbols, makeBasicLandCard } from "../lib/cardUtils.mjs";
import { parseDecklist } from "../lib/deckParser.mjs";

function card(name, overrides = {}) {
  return {
    name,
    cmc: overrides.cmc ?? 2,
    mana_cost: overrides.mana_cost ?? "{2}",
    oracle_text: overrides.oracle_text ?? "",
    type_line: overrides.type_line ?? "Artifact",
    legalities: { commander: "legal" },
    ...overrides,
  };
}

test("mana symbols render as compact icons", () => {
  assert.equal(formatManaSymbols("{3}{W}{B}"), "🔘🔘🔘⚪️⚫️");
  assert.equal(formatTextSymbols("{T}: Add {C}{U}."), "↩️: Add 🔘🔵.");
});

test("commanders and companions are excluded from main counts while basics count as lands", () => {
  const deck = parseDecklist(`
Commander:
1 Kykar, Wind's Fury

Companion:
1 Keruga, the Macrosage

Deck:
36 Island
1 Sol Ring
`);
  const cardMap = {
    "Kykar, Wind's Fury": card("Kykar, Wind's Fury", { cmc: 4, mana_cost: "{1}{U}{R}{W}", type_line: "Legendary Creature", oracle_text: "Whenever you cast a noncreature spell, create a Spirit token." }),
    "Keruga, the Macrosage": card("Keruga, the Macrosage", { cmc: 5, mana_cost: "{3}{G/U}{G/U}", type_line: "Legendary Creature", oracle_text: "Companion" }),
    Island: makeBasicLandCard("Island"),
    "Sol Ring": card("Sol Ring", { cmc: 1, mana_cost: "{1}", oracle_text: "{T}: Add {C}{C}." }),
  };

  const analysis = buildLocalAnalysis(deck, cardMap);
  assert.equal(deck.expectedMainCount, 99);
  assert.equal(analysis.stats.cardCount, 37);
  assert.equal(analysis.stats.landCount, 36);
  assert.equal(analysis.stats.rampCount, 1);
  assert.ok(Array.isArray(analysis.structure.roleBalance));
  assert.ok(analysis.structure.cardFlowProfile);
  assert.ok(analysis.structure.interactionProfile);
  assert.ok(analysis.structure.resilienceProfile);
  assert.ok(analysis.structure.winPlan);
  assert.ok(Array.isArray(analysis.priorityFindings));
  assert.ok(Array.isArray(analysis.scorecard));
  assert.equal(typeof analysis.overallScore, "number");
});

test("local analysis identifies engines, payoffs, finishers, and interaction profiles", () => {
  const deck = parseDecklist(`
Commander:
1 Kykar, Wind's Fury

Deck:
36 Island
1 Young Pyromancer
1 Impact Tremors
1 Crackling Drake
1 Counterspell
1 Swords to Plowshares
1 Faithless Looting
`);
  const cardMap = {
    "Kykar, Wind's Fury": card("Kykar, Wind's Fury", { cmc: 4, mana_cost: "{1}{U}{R}{W}", type_line: "Legendary Creature", oracle_text: "Whenever you cast a noncreature spell, create a Spirit token." }),
    Island: makeBasicLandCard("Island"),
    "Young Pyromancer": card("Young Pyromancer", { cmc: 2, mana_cost: "{1}{R}", type_line: "Creature", oracle_text: "Whenever you cast an instant or sorcery spell, create a 1/1 token." }),
    "Impact Tremors": card("Impact Tremors", { cmc: 2, mana_cost: "{1}{R}", type_line: "Enchantment", oracle_text: "Whenever a creature enters the battlefield under your control, Impact Tremors deals 1 damage to each opponent." }),
    "Crackling Drake": card("Crackling Drake", { cmc: 4, mana_cost: "{U}{U}{R}{R}", type_line: "Creature", oracle_text: "Flying. Its power is equal to the number of instant and sorcery cards you own in exile and in your graveyard. Draw a card." }),
    Counterspell: card("Counterspell", { cmc: 2, mana_cost: "{U}{U}", type_line: "Instant", oracle_text: "Counter target spell." }),
    "Swords to Plowshares": card("Swords to Plowshares", { cmc: 1, mana_cost: "{W}", type_line: "Instant", oracle_text: "Exile target creature." }),
    "Faithless Looting": card("Faithless Looting", { cmc: 1, mana_cost: "{R}", type_line: "Sorcery", oracle_text: "Draw two cards, then discard two cards. Flashback." }),
  };

  const analysis = buildLocalAnalysis(deck, cardMap);
  const engineRole = analysis.structure.roleBalance.find((role) => role.key === "engine");
  const payoffRole = analysis.structure.roleBalance.find((role) => role.key === "payoff");

  assert.ok(engineRole.count >= 1);
  assert.ok(payoffRole.count >= 1);
  assert.ok(analysis.structure.interactionProfile.instantSpeed >= 2);
  assert.ok(analysis.structure.winPlan.engines.includes("Young Pyromancer"));
});

test("average mana value includes commander and mana curve stacks by color bucket", () => {
  const deck = parseDecklist(`
Commander:
1 Six Mana Commander

Deck:
36 Island
10 Black Three
5 Blue Three
2 Multicolor Three
1 Sol Ring
`);
  const cardMap = {
    "Six Mana Commander": card("Six Mana Commander", { cmc: 6, mana_cost: "{4}{U}{R}", type_line: "Legendary Creature", oracle_text: "Flying." }),
    Island: makeBasicLandCard("Island"),
    "Black Three": card("Black Three", { cmc: 3, mana_cost: "{2}{B}", type_line: "Creature", oracle_text: "Menace." }),
    "Blue Three": card("Blue Three", { cmc: 3, mana_cost: "{2}{U}", type_line: "Instant", oracle_text: "Draw a card." }),
    "Multicolor Three": card("Multicolor Three", { cmc: 3, mana_cost: "{1}{U}{R}", type_line: "Sorcery", oracle_text: "Draw a card." }),
    "Sol Ring": card("Sol Ring", { cmc: 1, mana_cost: "{1}", oracle_text: "{T}: Add {C}{C}." }),
  };

  const analysis = buildLocalAnalysis(deck, cardMap);
  const mvThree = analysis.structure.manaCurve.find((bucket) => bucket.cmc === "3");

  assert.equal(analysis.stats.avgCmc, 3.05);
  assert.equal(mvThree.B, 10);
  assert.equal(mvThree.U, 7);
  assert.equal(mvThree.R, 2);
  assert.equal(mvThree.total, 17);
});

test("commanders appear in card scores and commander turn follows commander mana value", () => {
  const deck = parseDecklist(`
Commander:
1 Five Mana Commander

Deck:
36 Island
1 Sol Ring
1 Setup Spell
`);
  const cardMap = {
    "Five Mana Commander": card("Five Mana Commander", { cmc: 5, mana_cost: "{3}{U}{R}", type_line: "Legendary Creature", oracle_text: "Whenever you cast an instant or sorcery spell, draw a card." }),
    Island: makeBasicLandCard("Island"),
    "Sol Ring": card("Sol Ring", { cmc: 1, mana_cost: "{1}", oracle_text: "{T}: Add {C}{C}." }),
    "Setup Spell": card("Setup Spell", { cmc: 2, mana_cost: "{1}{U}", type_line: "Instant", oracle_text: "Draw a card." }),
  };

  const analysis = buildLocalAnalysis(deck, cardMap);
  const commanderScore = analysis.scores.find((score) => score.name === "Five Mana Commander");
  const commanderBand = analysis.structure.curveBands.find((band) => band.commanderNames.includes("Five Mana Commander"));

  assert.ok(commanderScore);
  assert.equal(commanderScore.protected, true);
  assert.ok(commanderScore.roles.includes("commander"));
  assert.equal(commanderBand.label, "Commander Turn");
});

test("ignored settings remove their category from overall score", () => {
  const deck = parseDecklist(`
Commander:
1 Kykar, Wind's Fury

Deck:
36 Island
1 Seven Drop
`);
  const cardMap = {
    "Kykar, Wind's Fury": card("Kykar, Wind's Fury", { cmc: 4, mana_cost: "{1}{U}{R}{W}", type_line: "Legendary Creature", oracle_text: "Whenever you cast a noncreature spell, create a Spirit token." }),
    Island: makeBasicLandCard("Island"),
    "Seven Drop": card("Seven Drop", { cmc: 7, mana_cost: "{7}", type_line: "Creature", oracle_text: "Trample." }),
  };

  const normal = buildLocalAnalysis(deck, cardMap, { analysisSettings: { avgManaValueTarget: 2 } });
  const ignored = buildLocalAnalysis(deck, cardMap, { analysisSettings: { avgManaValueTarget: 2, ignoredSettings: ["avgManaValueTarget"] } });
  const curve = ignored.scorecard.find((item) => item.key === "curve");
  const expectedOverall = Math.round(
    ignored.scorecard.filter((item) => !item.ignored).reduce((sum, item) => sum + item.score, 0) /
    ignored.scorecard.filter((item) => !item.ignored).length,
  );

  assert.equal(curve.ignored, true);
  assert.notEqual(normal.scorecard.find((item) => item.key === "curve").ignored, true);
  assert.equal(ignored.overallScore, expectedOverall);
});

test("additional role tags are detected", () => {
  const deck = parseDecklist(`
Commander:
1 Kykar, Wind's Fury

Deck:
36 Island
1 Faithless Looting
1 Rest in Peace
1 Goblin Bombardment
1 Fervor
`);
  const cardMap = {
    "Kykar, Wind's Fury": card("Kykar, Wind's Fury", { cmc: 4, mana_cost: "{1}{U}{R}{W}", type_line: "Legendary Creature", oracle_text: "Whenever you cast a noncreature spell, create a Spirit token." }),
    Island: makeBasicLandCard("Island"),
    "Faithless Looting": card("Faithless Looting", { cmc: 1, mana_cost: "{R}", type_line: "Sorcery", oracle_text: "Draw two cards, then discard two cards. Flashback." }),
    "Rest in Peace": card("Rest in Peace", { cmc: 2, mana_cost: "{1}{W}", type_line: "Enchantment", oracle_text: "When Rest in Peace enters, exile all graveyards. Cards in graveyards can't move." }),
    "Goblin Bombardment": card("Goblin Bombardment", { cmc: 2, mana_cost: "{1}{R}", type_line: "Enchantment", oracle_text: "Sacrifice a creature: Goblin Bombardment deals 1 damage to any target." }),
    Fervor: card("Fervor", { cmc: 3, mana_cost: "{2}{R}", type_line: "Enchantment", oracle_text: "Creatures you control have haste." }),
  };

  const analysis = buildLocalAnalysis(deck, cardMap);
  const byName = Object.fromEntries(analysis.scores.map((score) => [score.name, score.roles]));

  assert.ok(byName["Faithless Looting"].includes("cardSelection"));
  assert.ok(byName["Rest in Peace"].includes("graveyardHate"));
  assert.ok(byName["Goblin Bombardment"].includes("sacrificeOutlet"));
  assert.ok(byName.Fervor.includes("haste"));
});

test("scorecard responds to adjustable targets", () => {
  const deck = parseDecklist(`
Commander:
1 Kykar, Wind's Fury

Deck:
36 Island
1 Sol Ring
1 Arcane Signet
`);
  const cardMap = {
    "Kykar, Wind's Fury": card("Kykar, Wind's Fury", { cmc: 4, mana_cost: "{1}{U}{R}{W}", type_line: "Legendary Creature", oracle_text: "Whenever you cast a noncreature spell, create a Spirit token." }),
    Island: makeBasicLandCard("Island"),
    "Sol Ring": card("Sol Ring", { cmc: 1, mana_cost: "{1}", oracle_text: "{T}: Add {C}{C}." }),
    "Arcane Signet": card("Arcane Signet", { cmc: 2, mana_cost: "{2}", oracle_text: "{T}: Add one mana of any color in your commander's color identity." }),
  };

  const loose = buildLocalAnalysis(deck, cardMap, { analysisSettings: { rampTarget: 2 } });
  const strict = buildLocalAnalysis(deck, cardMap, { analysisSettings: { rampTarget: 10 } });
  const looseRamp = loose.scorecard.find((item) => item.key === "ramp");
  const strictRamp = strict.scorecard.find((item) => item.key === "ramp");

  assert.ok(looseRamp.score > strictRamp.score);
});

test("core identity cards are protected from cut suggestions and shape synergy", () => {
  const deck = parseDecklist(`
Commander:
1 Kykar, Wind's Fury

Deck:
36 Island
1 Young Pyromancer
1 Impact Tremors
1 Sol Ring
1 Expensive Blank

Sideboard:
1 Faithless Looting
`);
  const cardMap = {
    "Kykar, Wind's Fury": card("Kykar, Wind's Fury", { cmc: 4, mana_cost: "{1}{U}{R}{W}", type_line: "Legendary Creature", oracle_text: "Whenever you cast a noncreature spell, create a Spirit token." }),
    Island: makeBasicLandCard("Island"),
    "Young Pyromancer": card("Young Pyromancer", { cmc: 2, mana_cost: "{1}{R}", type_line: "Creature", oracle_text: "Whenever you cast an instant or sorcery spell, create a 1/1 token." }),
    "Impact Tremors": card("Impact Tremors", { cmc: 2, mana_cost: "{1}{R}", type_line: "Enchantment", oracle_text: "Whenever a creature enters the battlefield under your control, Impact Tremors deals 1 damage to each opponent." }),
    "Sol Ring": card("Sol Ring", { cmc: 1, mana_cost: "{1}", oracle_text: "{T}: Add {C}{C}." }),
    "Expensive Blank": card("Expensive Blank", { cmc: 7, mana_cost: "{7}", type_line: "Creature", oracle_text: "Vanilla large creature." }),
    "Faithless Looting": card("Faithless Looting", { cmc: 1, mana_cost: "{R}", type_line: "Sorcery", oracle_text: "Draw two cards, then discard two cards. Flashback." }),
  };

  const analysis = buildLocalAnalysis(deck, cardMap, { coreCards: ["Expensive Blank", "Young Pyromancer"], analysisSettings: { synergySensitivity: 2 } });
  const coreScore = analysis.scores.find((score) => score.name === "Expensive Blank");
  const synergy = analysis.scorecard.find((item) => item.key === "synergy");

  assert.equal(coreScore.protected, true);
  assert.equal(analysis.upgrades.some((upgrade) => upgrade.cut === "Expensive Blank"), false);
  assert.ok(synergy.highlightCards.includes("Young Pyromancer"));
});

test("core identity cards propagate into synergy clusters", () => {
  const deck = parseDecklist(`
Commander:
1 Generic Commander

Deck:
36 Island
1 Young Pyromancer
1 Impact Tremors
1 Token Spell
`);
  const cardMap = {
    "Generic Commander": card("Generic Commander", { cmc: 4, mana_cost: "{4}", type_line: "Legendary Creature", oracle_text: "Ward 2." }),
    Island: makeBasicLandCard("Island"),
    "Young Pyromancer": card("Young Pyromancer", { cmc: 2, mana_cost: "{1}{R}", type_line: "Creature", oracle_text: "Whenever you cast an instant or sorcery spell, create a 1/1 token." }),
    "Impact Tremors": card("Impact Tremors", { cmc: 2, mana_cost: "{1}{R}", type_line: "Enchantment", oracle_text: "Whenever a creature enters the battlefield under your control, Impact Tremors deals 1 damage to each opponent." }),
    "Token Spell": card("Token Spell", { cmc: 3, mana_cost: "{2}{R}", type_line: "Sorcery", oracle_text: "Create two creature tokens." }),
  };

  const withoutCore = buildLocalAnalysis(deck, cardMap);
  const withCore = buildLocalAnalysis(deck, cardMap, { coreCards: ["Young Pyromancer"] });
  const identityCluster = withCore.synergyClusters.find((cluster) => cluster.name === "Commander/Core Identity");

  assert.equal(withoutCore.synergyClusters.some((cluster) => cluster.name === "Commander/Core Identity"), false);
  assert.ok(identityCluster.cards.includes("Young Pyromancer"));
  assert.ok(identityCluster.cards.includes("Token Spell"));
});
