import test from "node:test";
import assert from "node:assert/strict";
import { buildTierRows } from "../lib/deckTiers.mjs";
import { normalizeName } from "../lib/cardUtils.mjs";

function tierOf(rows, name) {
  return rows.find((row) => row.cards.some((card) => card.name === name))?.tier;
}

test("low-confidence cut candidates are not automatically demoted", () => {
  const rows = buildTierRows({
    analysis: {
      scores: [{ name: "Useful Role Player", score: 4, roles: ["draw"], zone: "main" }],
      cutCandidates: [{ name: "Useful Role Player", score: 4, confidence: "low", rank: 0, roles: ["draw"] }],
    },
    cutDecisions: {},
  });

  assert.equal(tierOf(rows, "Useful Role Player"), "B");
});

test("required cuts and manual cut decisions land in F", () => {
  const rows = buildTierRows({
    analysis: {
      scores: [
        { name: "Required Cut", score: 8, roles: ["payoff"], zone: "main" },
        { name: "Manual Cut", score: 8, roles: ["engine"], zone: "main" },
      ],
      cutCandidates: [
        { name: "Required Cut", score: 8, confidence: "high", rank: 8, sizeCutRecommended: true, roles: ["payoff"] },
        { name: "Manual Cut", score: 8, confidence: "low", rank: 0, roles: ["engine"] },
      ],
    },
    cutDecisions: { [normalizeName("Manual Cut")]: "cut" },
  });

  assert.equal(tierOf(rows, "Required Cut"), "F");
  assert.equal(tierOf(rows, "Manual Cut"), "F");
});

test("commanders and protected cards land in S", () => {
  const rows = buildTierRows({
    analysis: {
      scores: [
        { name: "Deck Commander", score: 1, roles: ["commander"], protected: true, zone: "commanders" },
        { name: "Core Engine", score: 2, roles: ["core"], protected: true, zone: "main" },
      ],
      cutCandidates: [],
    },
    cutDecisions: {},
  });

  assert.equal(tierOf(rows, "Deck Commander"), "S");
  assert.equal(tierOf(rows, "Core Engine"), "S");
});

test("manual keep decisions raise weak cards to at least C", () => {
  const rows = buildTierRows({
    analysis: {
      scores: [{ name: "Pet Card", score: -6, roles: [], zone: "main" }],
      cutCandidates: [{ name: "Pet Card", score: -6, confidence: "high", rank: 7, roles: [] }],
    },
    cutDecisions: { [normalizeName("Pet Card")]: "keep" },
  });

  assert.equal(tierOf(rows, "Pet Card"), "C");
});

test("typical card pools distribute across all tiers", () => {
  const scores = Array.from({ length: 40 }, (_, index) => ({
    name: `Card ${String(index + 1).padStart(2, "0")}`,
    score: 10 - Math.floor(index / 4),
    roles: ["engine"],
    zone: "main",
  }));

  const rows = buildTierRows({
    analysis: { scores, cutCandidates: [] },
    cutDecisions: {},
  });

  assert.deepEqual(rows.map((row) => row.tier), ["S", "A", "B", "C", "D", "F"]);
  assert.ok(rows.every((row) => row.cards.length > 0));
});
