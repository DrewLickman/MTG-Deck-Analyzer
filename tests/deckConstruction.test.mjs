import test from "node:test";
import assert from "node:assert/strict";
import {
  addCandidateToMain,
  applyConstructionSession,
  chooseVersusCandidate,
  constructionCounts,
  createConstructionSession,
  drawConstructionCandidates,
  restartConstructionSession,
  returnVersusCandidates,
  setAsideCandidates,
  undoConstructionAction,
} from "../lib/deckConstruction.mjs";

function deckFixture() {
  return {
    main: [{ qty: 97, name: "Main Card" }],
    sideboard: [
      { qty: 1, name: "Candidate A" },
      { qty: 2, name: "Candidate B" },
      { qty: 1, name: "Candidate C" },
    ],
    considering: [{ qty: 1, name: "Maybe Card" }],
    commanders: [{ qty: 1, name: "Commander" }],
    expectedMainCount: 99,
    cardCount: 97,
    inferenceWarnings: ["Main deck has 97 cards; expected 99 after command-zone cards."],
  };
}

test("construction session starts with independent main, sideboard pool, and empty set-aside zones", () => {
  const session = createConstructionSession(deckFixture());
  assert.deepEqual(constructionCounts(session), { main: 97, pool: 4, setAside: 0 });
  assert.notEqual(session.main, deckFixture().main);
  assert.notEqual(session.pool, deckFixture().sideboard);
});

test("pick one moves a single candidate copy to the main deck and supports undo", () => {
  const started = createConstructionSession(deckFixture());
  const added = addCandidateToMain(started, "Candidate B");
  assert.deepEqual(constructionCounts(added), { main: 98, pool: 3, setAside: 0 });
  assert.equal(added.pool.find((entry) => entry.name === "Candidate B").qty, 1);

  const undone = undoConstructionAction(added);
  assert.deepEqual(constructionCounts(undone), { main: 97, pool: 4, setAside: 0 });
  assert.match(undone.notice, /^Undid:/);
});

test("versus moves only the winner and leaves the loser in the pool", () => {
  const started = createConstructionSession(deckFixture());
  const chosen = chooseVersusCandidate(started, "Candidate A", "Candidate C");
  assert.deepEqual(constructionCounts(chosen), { main: 98, pool: 3, setAside: 0 });
  assert.equal(chosen.pool.some((entry) => entry.name === "Candidate A"), false);
  assert.equal(chosen.pool.some((entry) => entry.name === "Candidate C"), true);
  assert.match(chosen.notice, /Candidate C returned to the candidate pool/);
});

test("versus neither returns both cards to the pool without changing set aside", () => {
  const started = createConstructionSession(deckFixture());
  const rejected = returnVersusCandidates(started, ["Candidate A", "Candidate C"]);
  assert.deepEqual(constructionCounts(rejected), { main: 97, pool: 4, setAside: 0 });
  assert.equal(rejected.pool.some((entry) => entry.name === "Candidate A"), true);
  assert.equal(rejected.pool.some((entry) => entry.name === "Candidate C"), true);
  assert.equal(rejected.history.length, 0);
  assert.match(rejected.notice, /returned to the candidate pool/);
});

test("explicit pick-one set aside remains recoverable through restart and undo", () => {
  const started = createConstructionSession(deckFixture());
  const rejected = setAsideCandidates(started, ["Candidate A"]);
  assert.deepEqual(constructionCounts(rejected), { main: 97, pool: 3, setAside: 1 });
  const restarted = restartConstructionSession(rejected);
  assert.deepEqual(constructionCounts(restarted), { main: 97, pool: 4, setAside: 0 });
  assert.deepEqual(constructionCounts(undoConstructionAction(restarted)), { main: 97, pool: 3, setAside: 1 });
});

test("draw selects distinct candidate names with an injectable random source", () => {
  const session = createConstructionSession(deckFixture());
  const rolls = [0, 0];
  const drawn = drawConstructionCandidates(session.pool, 2, () => rolls.shift());
  assert.deepEqual(drawn, ["Candidate A", "Candidate B"]);
});

test("applying a construction session updates the analyzed main and sideboard counts without touching considering", () => {
  const deck = deckFixture();
  const session = addCandidateToMain(createConstructionSession(deck), "Candidate A");
  const nextDeck = applyConstructionSession(deck, session);
  assert.equal(nextDeck.cardCount, 98);
  assert.equal(nextDeck.sideboard.some((entry) => entry.name === "Candidate A"), false);
  assert.deepEqual(nextDeck.considering, deck.considering);
  assert.deepEqual(nextDeck.inferenceWarnings, ["Main deck has 98 cards; expected 99 after command-zone cards."]);
});
