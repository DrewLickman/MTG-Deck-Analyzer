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
});
