import test from "node:test";
import assert from "node:assert/strict";
import { buildLocalAnalysis } from "../lib/deckAnalysis.mjs";
import { makeBasicLandCard } from "../lib/cardUtils.mjs";
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
