import test from "node:test";
import assert from "node:assert/strict";
import {
  addCandidateToMain,
  applyConstructionSession,
  chooseVersusCandidate,
  chooseVersusComparison,
  constructionCounts,
  createConstructionSession,
  drawConstructionCandidates,
  moveMainToCandidatePool,
  restartConstructionSession,
  returnVersusCandidates,
  returnVersusComparison,
  setAsideCandidates,
  setAsideVersusCandidate,
  setAsideVersusComparison,
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

test("moving the main deck to the candidate pool merges with existing sideboard cards and preserves undo", () => {
  const started = createConstructionSession(deckFixture());
  const drafted = addCandidateToMain(started, "Candidate B");
  const reset = moveMainToCandidatePool(drafted);

  assert.deepEqual(constructionCounts(reset), { main: 0, pool: 101, setAside: 0 });
  assert.equal(reset.pool.find((entry) => entry.name === "Candidate B").qty, 2);
  assert.equal(reset.pool.find((entry) => entry.name === "Main Card").qty, 97);
  assert.match(reset.notice, /command-zone cards remain separate/);

  const undone = undoConstructionAction(reset);
  assert.deepEqual(constructionCounts(undone), { main: 98, pool: 3, setAside: 0 });
  assert.equal(undone.main.find((entry) => entry.name === "Candidate B").qty, 1);
});

test("moving an empty main deck is a no-op", () => {
  const started = createConstructionSession(deckFixture());
  const reset = moveMainToCandidatePool(moveMainToCandidatePool(started));
  assert.equal(reset.main.length, 0);
  assert.equal(reset.history.length, 1);
  assert.equal(moveMainToCandidatePool(reset), reset);
});

test("versus moves only the winner and leaves the loser in the pool", () => {
  const started = createConstructionSession(deckFixture());
  const chosen = chooseVersusCandidate(started, "Candidate A", "Candidate C");
  assert.deepEqual(constructionCounts(chosen), { main: 98, pool: 3, setAside: 0 });
  assert.equal(chosen.pool.some((entry) => entry.name === "Candidate A"), false);
  assert.equal(chosen.pool.some((entry) => entry.name === "Candidate C"), true);
  assert.match(chosen.notice, /Candidate C returned to the candidate pool/);
});

test("versus set aside moves only the clicked card and leaves the other in the pool", () => {
  const started = createConstructionSession(deckFixture());
  const setAside = setAsideVersusCandidate(started, "Candidate A", "Candidate C");
  assert.deepEqual(constructionCounts(setAside), { main: 97, pool: 3, setAside: 1 });
  assert.equal(setAside.pool.some((entry) => entry.name === "Candidate A"), false);
  assert.equal(setAside.pool.some((entry) => entry.name === "Candidate C"), true);
  assert.equal(setAside.setAside.find((entry) => entry.name === "Candidate A").qty, 1);
  assert.match(setAside.notice, /Candidate C returned to the candidate pool/);

  const undone = undoConstructionAction(setAside);
  assert.deepEqual(constructionCounts(undone), { main: 97, pool: 4, setAside: 0 });
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

test("oversized versus replaces a main-deck card with the candidate card", () => {
  const deck = { ...deckFixture(), main: [{ qty: 100, name: "Main Card" }] };
  const started = createConstructionSession(deck);
  const chosen = chooseVersusComparison(
    started,
    { name: "Candidate A", source: "pool" },
    { name: "Main Card", source: "main" },
  );
  assert.deepEqual(constructionCounts(chosen), { main: 100, pool: 4, setAside: 0 });
  assert.equal(chosen.main.find((entry) => entry.name === "Candidate A").qty, 1);
  assert.equal(chosen.main.find((entry) => entry.name === "Main Card").qty, 99);
  assert.equal(chosen.pool.find((entry) => entry.name === "Main Card").qty, 1);
  assert.equal(chosen.pool.some((entry) => entry.name === "Candidate A"), false);
});

test("oversized versus keeps or sets aside either source without moving the other card incorrectly", () => {
  const deck = { ...deckFixture(), main: [{ qty: 100, name: "Main Card" }] };
  const started = createConstructionSession(deck);
  const keptMain = chooseVersusComparison(
    started,
    { name: "Main Card", source: "main" },
    { name: "Candidate A", source: "pool" },
  );
  assert.deepEqual(constructionCounts(keptMain), { main: 100, pool: 4, setAside: 0 });
  assert.equal(keptMain.pool.find((entry) => entry.name === "Candidate A").qty, 1);
  assert.equal(keptMain.history.length, 1);
  assert.deepEqual(constructionCounts(undoConstructionAction(keptMain)), { main: 100, pool: 4, setAside: 0 });

  const setAsideMain = setAsideVersusComparison(
    started,
    { name: "Main Card", source: "main" },
    { name: "Candidate A", source: "pool" },
  );
  assert.deepEqual(constructionCounts(setAsideMain), { main: 99, pool: 4, setAside: 1 });
  assert.equal(setAsideMain.setAside.find((entry) => entry.name === "Main Card").qty, 1);
  assert.equal(setAsideMain.pool.find((entry) => entry.name === "Candidate A").qty, 1);

  const setAsidePool = setAsideVersusComparison(
    started,
    { name: "Candidate A", source: "pool" },
    { name: "Main Card", source: "main" },
  );
  assert.deepEqual(constructionCounts(setAsidePool), { main: 100, pool: 3, setAside: 1 });
  assert.equal(setAsidePool.setAside.find((entry) => entry.name === "Candidate A").qty, 1);
  assert.equal(setAsidePool.main.find((entry) => entry.name === "Main Card").qty, 100);
});

test("oversized versus neither preserves both original zones", () => {
  const deck = { ...deckFixture(), main: [{ qty: 100, name: "Main Card" }] };
  const started = createConstructionSession(deck);
  const rejected = returnVersusComparison(started, [
    { name: "Main Card", source: "main" },
    { name: "Candidate A", source: "pool" },
  ]);
  assert.deepEqual(constructionCounts(rejected), { main: 100, pool: 4, setAside: 0 });
  assert.equal(rejected.history.length, 0);
  assert.match(rejected.notice, /returned to the main deck/);
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
  assert.deepEqual(nextDeck.commanders, deck.commanders);
  assert.deepEqual(nextDeck.inferenceWarnings, ["Main deck has 98 cards; expected 99 after command-zone cards."]);
});
