import test from "node:test";
import assert from "node:assert/strict";
import { buildLocalAnalysis } from "../lib/deckAnalysis.mjs";
import { formatManaSymbols, formatTextSymbols, getRoleEvidence, getRoles, makeBasicLandCard } from "../lib/cardUtils.mjs";
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

test("analysis returns normalized type groups and role evidence", () => {
  const deck = parseDecklist(`
Commander:
1 Kykar, Wind's Fury

Deck:
1 Island
1 Sol Ring
1 Counterspell
1 Wrath of God
1 Demonic Tutor
1 Swiftfoot Boots
1 Reanimate
1 Thassa's Oracle
`);
  const cardMap = {
    "Kykar, Wind's Fury": card("Kykar, Wind's Fury", { cmc: 4, mana_cost: "{1}{U}{R}{W}", type_line: "Legendary Creature", oracle_text: "Whenever you cast a noncreature spell, create a Spirit token." }),
    Island: makeBasicLandCard("Island"),
    "Sol Ring": card("Sol Ring", { cmc: 1, mana_cost: "{1}", type_line: "Artifact", oracle_text: "{T}: Add {C}{C}." }),
    Counterspell: card("Counterspell", { cmc: 2, mana_cost: "{U}{U}", type_line: "Instant", oracle_text: "Counter target spell." }),
    "Wrath of God": card("Wrath of God", { cmc: 4, mana_cost: "{2}{W}{W}", type_line: "Sorcery", oracle_text: "Destroy all creatures." }),
    "Demonic Tutor": card("Demonic Tutor", { cmc: 2, mana_cost: "{1}{B}", type_line: "Sorcery", oracle_text: "Search your library for a card, put that card into your hand, then shuffle." }),
    "Swiftfoot Boots": card("Swiftfoot Boots", { cmc: 2, mana_cost: "{2}", type_line: "Artifact", oracle_text: "Equipped creature has hexproof and haste." }),
    Reanimate: card("Reanimate", { cmc: 1, mana_cost: "{B}", type_line: "Sorcery", oracle_text: "Put target creature card from a graveyard onto the battlefield under your control." }),
    "Thassa's Oracle": card("Thassa's Oracle", { cmc: 2, mana_cost: "{U}{U}", type_line: "Creature", oracle_text: "When this creature enters, look at the top X cards. If X is greater than or equal to the number of cards in your library, you win the game." }),
  };

  const analysis = buildLocalAnalysis(deck, cardMap);
  const typeKeys = analysis.cardGroups.typeGroups.map((group) => group.key);
  const ramp = analysis.cardGroups.roleGroups.find((group) => group.key === "ramp");
  const combo = analysis.cardGroups.roleGroups.find((group) => group.key === "comboPiece");

  assert.ok(typeKeys.includes("creatures"));
  assert.ok(typeKeys.includes("instants"));
  assert.ok(typeKeys.includes("sorceries"));
  assert.ok(typeKeys.includes("artifacts"));
  assert.ok(typeKeys.includes("lands"));
  assert.ok(ramp.evidence.some((item) => item.cardName === "Sol Ring" && item.reason && item.confidence && item.matchingRule && item.source));
  assert.ok(combo.evidence.some((item) => item.cardName === "Thassa's Oracle" && item.confidence === "high"));
});

test("card grouping covers every supported type bucket", () => {
  const deck = parseDecklist(`
Commander:
1 Type Commander

Deck:
1 Type Creature
1 Type Instant
1 Type Sorcery
1 Type Artifact
1 Type Enchantment
1 Type Planeswalker
1 Type Battle
1 Island
`);
  const cardMap = {
    "Type Commander": card("Type Commander", { type_line: "Legendary Creature", oracle_text: "Ward 2." }),
    "Type Creature": card("Type Creature", { type_line: "Creature", oracle_text: "Vigilance." }),
    "Type Instant": card("Type Instant", { type_line: "Instant", oracle_text: "Target creature gets +1/+1 until end of turn." }),
    "Type Sorcery": card("Type Sorcery", { type_line: "Sorcery", oracle_text: "Create a token." }),
    "Type Artifact": card("Type Artifact", { type_line: "Artifact", oracle_text: "Ward 2." }),
    "Type Enchantment": card("Type Enchantment", { type_line: "Enchantment", oracle_text: "Creatures you control have vigilance." }),
    "Type Planeswalker": card("Type Planeswalker", { type_line: "Legendary Planeswalker", oracle_text: "+1: Scry 1." }),
    "Type Battle": card("Type Battle", { type_line: "Battle", oracle_text: "When this enters, draw a card." }),
    Island: makeBasicLandCard("Island"),
  };

  const analysis = buildLocalAnalysis(deck, cardMap);
  const groups = Object.fromEntries(analysis.cardGroups.typeGroups.map((group) => [group.key, group]));

  for (const key of ["creatures", "instants", "sorceries", "artifacts", "enchantments", "planeswalkers", "battles", "lands"]) {
    assert.ok(groups[key], `${key} group should exist`);
    assert.ok(groups[key].count >= 1, `${key} group should have cards`);
  }
  assert.ok(groups.creatures.cards.some((item) => item.name === "Type Creature"));
  assert.ok(groups.planeswalkers.cards.some((item) => item.name === "Type Planeswalker"));
  assert.ok(groups.battles.cards.some((item) => item.name === "Type Battle"));
});

test("role detection covers clear positives and near misses", () => {
  const cases = [
    ["ramp", card("Ramp Spell", { oracle_text: "Search your library for a basic land card, put it onto the battlefield, then shuffle." }), card("Not Ramp", { oracle_text: "Put a +1/+1 counter on target creature." })],
    ["draw", card("Draw Spell", { oracle_text: "Draw two cards." }), card("Not Draw", { oracle_text: "Each opponent draws a bead on your plan." })],
    ["removal", card("Removal Spell", { oracle_text: "Exile target creature." }), card("Not Removal", { oracle_text: "Exile the top card of your library. You may play it this turn." })],
    ["boardWipe", card("Wipe Spell", { oracle_text: "Destroy all creatures." }), card("Not Wipe", { oracle_text: "Destroy target creature." })],
    ["tutor", card("Tutor Spell", { oracle_text: "Search your library for a card, put it into your hand, then shuffle." }), card("Not Tutor", { oracle_text: "Search your library for a basic land card, reveal it, then shuffle." })],
    ["protection", card("Protect Spell", { oracle_text: "Target creature gains hexproof until end of turn." }), card("Not Protect", { oracle_text: "Prevent the next 1 damage that would be dealt to any target." })],
    ["recursion", card("Recursion Spell", { oracle_text: "Return target creature card from your graveyard to your hand." }), card("Not Recursion", { oracle_text: "Exile target card from an opponent's graveyard." })],
    ["fastMana", card("Mana Vault", { name: "Mana Vault", oracle_text: "{T}: Add {C}{C}{C}." }), card("Worn Powerstone", { name: "Worn Powerstone", oracle_text: "{T}: Add {C}{C}." })],
    ["stax", card("Stax Piece", { oracle_text: "Spells your opponents cast cost {1} more to cast." }), card("Not Stax", { oracle_text: "Spells you cast cost {1} less to cast." })],
    ["comboPiece", card("Thassa's Oracle", { name: "Thassa's Oracle", oracle_text: "If X is greater than or equal to the number of cards in your library, you win the game." }), card("Laboratory Assistant", { name: "Laboratory Assistant", oracle_text: "When this enters, mill a card." })],
  ];

  for (const [role, positive, nearMiss] of cases) {
    assert.equal(getRoles(positive)[role], true, `${role} positive should match`);
    assert.equal(getRoles(nearMiss)[role], false, `${role} near miss should not match`);
    const evidence = getRoleEvidence(positive).find((item) => item.role === role);
    assert.ok(evidence?.cardName, `${role} evidence includes card name`);
    assert.ok(evidence?.reason, `${role} evidence includes reason`);
    assert.ok(evidence?.confidence, `${role} evidence includes confidence`);
    assert.ok(evidence?.matchingRule, `${role} evidence includes matching rule`);
  }
});

test("card group summaries include Scryfall image URLs and missing-image fallback data", () => {
  const deck = parseDecklist(`
Commander:
1 Image Commander

Deck:
1 Image Card
1 No Image Card
`);
  const cardMap = {
    "Image Commander": card("Image Commander", { type_line: "Legendary Creature", oracle_text: "Ward 2." }),
    "Image Card": card("Image Card", {
      type_line: "Artifact",
      oracle_text: "{T}: Add {C}.",
      image_uris: { normal: "https://cards.scryfall.io/normal/front/example.jpg" },
    }),
    "No Image Card": card("No Image Card", { type_line: "Instant", oracle_text: "Draw a card." }),
  };

  const analysis = buildLocalAnalysis(deck, cardMap);
  const artifact = analysis.cardGroups.typeGroups.find((group) => group.key === "artifacts").cards.find((item) => item.name === "Image Card");
  const instant = analysis.cardGroups.typeGroups.find((group) => group.key === "instants").cards.find((item) => item.name === "No Image Card");

  assert.equal(artifact.imageUrl, "https://cards.scryfall.io/normal/front/example.jpg");
  assert.equal(instant.imageUrl, null);
});

test("answer gaps include concrete counts and expected ranges", () => {
  const deck = parseDecklist(`
Commander:
1 Kykar, Wind's Fury

Deck:
36 Island
1 Counterspell
`);
  const cardMap = {
    "Kykar, Wind's Fury": card("Kykar, Wind's Fury", { cmc: 4, mana_cost: "{1}{U}{R}{W}", type_line: "Legendary Creature", oracle_text: "Whenever you cast a noncreature spell, create a Spirit token." }),
    Island: makeBasicLandCard("Island"),
    Counterspell: card("Counterspell", { cmc: 2, mana_cost: "{U}{U}", type_line: "Instant", oracle_text: "Counter target spell." }),
  };

  const analysis = buildLocalAnalysis(deck, cardMap);
  const wipeGap = analysis.structure.answerGaps.find((gap) => gap.key === "boardWipes");
  const graveGap = analysis.structure.answerGaps.find((gap) => gap.key === "graveyardInteraction");

  assert.equal(wipeGap.count, 0);
  assert.match(wipeGap.message, /0 found; 3-4/);
  assert.match(graveGap.message, /0 found; 1-3/);
  assert.ok(analysis.priorityFindings.some((finding) => finding.detail.includes("Board wipes")));
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
1 Token Spell Two
1 Token Spell Three
1 Token Spell Four
1 Token Spell Five
1 Token Spell Six
1 Token Spell Seven
1 Token Spell Eight
1 Token Spell Nine
`);
  const cardMap = {
    "Generic Commander": card("Generic Commander", { cmc: 4, mana_cost: "{4}", type_line: "Legendary Creature", oracle_text: "Ward 2." }),
    Island: makeBasicLandCard("Island"),
    "Young Pyromancer": card("Young Pyromancer", { cmc: 2, mana_cost: "{1}{R}", type_line: "Creature", oracle_text: "Whenever you cast an instant or sorcery spell, create a 1/1 token." }),
    "Impact Tremors": card("Impact Tremors", { cmc: 2, mana_cost: "{1}{R}", type_line: "Enchantment", oracle_text: "Whenever a creature enters the battlefield under your control, Impact Tremors deals 1 damage to each opponent." }),
    "Token Spell": card("Token Spell", { cmc: 3, mana_cost: "{2}{R}", type_line: "Sorcery", oracle_text: "Create two creature tokens." }),
    "Token Spell Two": card("Token Spell Two", { cmc: 3, mana_cost: "{2}{R}", type_line: "Sorcery", oracle_text: "Create two creature tokens." }),
    "Token Spell Three": card("Token Spell Three", { cmc: 3, mana_cost: "{2}{R}", type_line: "Sorcery", oracle_text: "Create two creature tokens." }),
    "Token Spell Four": card("Token Spell Four", { cmc: 3, mana_cost: "{2}{R}", type_line: "Sorcery", oracle_text: "Create two creature tokens." }),
    "Token Spell Five": card("Token Spell Five", { cmc: 3, mana_cost: "{2}{R}", type_line: "Sorcery", oracle_text: "Create two creature tokens." }),
    "Token Spell Six": card("Token Spell Six", { cmc: 3, mana_cost: "{2}{R}", type_line: "Sorcery", oracle_text: "Create two creature tokens." }),
    "Token Spell Seven": card("Token Spell Seven", { cmc: 3, mana_cost: "{2}{R}", type_line: "Sorcery", oracle_text: "Create two creature tokens." }),
    "Token Spell Eight": card("Token Spell Eight", { cmc: 3, mana_cost: "{2}{R}", type_line: "Sorcery", oracle_text: "Create two creature tokens." }),
    "Token Spell Nine": card("Token Spell Nine", { cmc: 3, mana_cost: "{2}{R}", type_line: "Sorcery", oracle_text: "Create two creature tokens." }),
  };

  const withoutCore = buildLocalAnalysis(deck, cardMap);
  const withCore = buildLocalAnalysis(deck, cardMap, { coreCards: ["Young Pyromancer"] });
  const identityCluster = withCore.synergyClusters.find((cluster) => cluster.name === "Commander/Core Identity");
  const tokenCluster = withCore.synergyClusters.find((cluster) => cluster.name === "Token Pressure");

  assert.equal(withoutCore.synergyClusters.some((cluster) => cluster.name === "Commander/Core Identity"), false);
  assert.ok(identityCluster.cards.includes("Young Pyromancer"));
  assert.ok(identityCluster.cards.includes("Token Spell"));
  assert.equal(tokenCluster.cards.length, 10);
  assert.ok(tokenCluster.cards.includes("Token Spell Nine"));
});
