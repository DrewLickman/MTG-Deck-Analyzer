import test from "node:test";
import assert from "node:assert/strict";
import {
  addCandidateLandsToMain,
  addCandidateToMain,
  applyConstructionSession,
  chooseVersusCandidate,
  chooseVersusComparison,
  constructionCounts,
  createConstructionSession,
  drawConstructionCandidates,
  moveConstructionStack,
  moveMainToCandidatePool,
  restartConstructionSession,
  setAsideCandidates,
  setAsideVersusCandidate,
  setAsideVersusComparison,
  setAsideVersusPair,
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

test("zone stack movement covers every direction, transfers whole quantities, and supports undo", () => {
  const quantities = { main: 2, pool: 3, setAside: 4 };
  const names = { main: "Main Stack", pool: "Pool Stack", setAside: "Aside Stack" };
  const directions = [
    ["main", "pool"], ["main", "setAside"],
    ["pool", "main"], ["pool", "setAside"],
    ["setAside", "main"], ["setAside", "pool"],
  ];

  for (const [from, to] of directions) {
    const started = {
      ...createConstructionSession({ ...deckFixture(), main: [{ qty: quantities.main, name: names.main }], sideboard: [{ qty: quantities.pool, name: names.pool }] }),
      setAside: [{ qty: quantities.setAside, name: names.setAside }],
    };
    const moved = moveConstructionStack(started, { name: names[from], from, to });
    assert.equal(moved[from].some((entry) => entry.name === names[from]), false, `${from} stack removed`);
    assert.equal(moved[to].find((entry) => entry.name === names[from]).qty, quantities[from], `${from} quantity preserved`);
    assert.equal(moved.history.length, 1, `${from} to ${to} is one undo step`);
    assert.deepEqual(constructionCounts(undoConstructionAction(moved)), constructionCounts(started));
  }
});

test("zone stack movement merges quantities, applies to the analyzed deck, and rejects invalid moves", () => {
  const deck = { ...deckFixture(), main: [{ qty: 2, name: "Shared Stack" }], sideboard: [{ qty: 3, name: "Shared Stack" }] };
  const started = createConstructionSession(deck);
  const moved = moveConstructionStack(started, { name: "Shared Stack", from: "pool", to: "main" });
  assert.equal(moved.main.find((entry) => entry.name === "Shared Stack").qty, 5);
  assert.equal(moved.pool.length, 0);

  const applied = applyConstructionSession(deck, moved);
  assert.equal(applied.main.find((entry) => entry.name === "Shared Stack").qty, 5);
  assert.equal(applied.sideboard.length, 0);
  assert.deepEqual(applied.commanders, deck.commanders);

  assert.equal(moveConstructionStack(started, { name: "Shared Stack", from: "main", to: "main" }), started);
  assert.equal(moveConstructionStack(started, { name: "Missing", from: "main", to: "pool" }), started);
  assert.equal(moveConstructionStack(started, { name: "Shared Stack", from: "unknown", to: "pool" }), started);
});

test("bulk land add moves every selected pool quantity, preserves nonlands, and supports undo", () => {
  const deck = {
    ...deckFixture(),
    sideboard: [
      { qty: 2, name: "Island" },
      { qty: 1, name: "Command Tower" },
      { qty: 1, name: "Nonland Candidate" },
    ],
  };
  const started = createConstructionSession(deck);
  const added = addCandidateLandsToMain(started, ["Island", "Command Tower"]);

  assert.deepEqual(constructionCounts(added), { main: 100, pool: 1, setAside: 0 });
  assert.equal(added.main.find((entry) => entry.name === "Island").qty, 2);
  assert.equal(added.main.find((entry) => entry.name === "Command Tower").qty, 1);
  assert.equal(added.pool.find((entry) => entry.name === "Nonland Candidate").qty, 1);
  assert.match(added.notice, /Moved 3 candidate-pool lands/);

  const applied = applyConstructionSession(deck, added);
  assert.equal(applied.cardCount, 100);
  assert.equal(applied.main.find((entry) => entry.name === "Island").qty, 2);
  assert.equal(applied.sideboard.find((entry) => entry.name === "Nonland Candidate").qty, 1);
  assert.deepEqual(applied.commanders, deck.commanders);

  const undone = undoConstructionAction(added);
  assert.deepEqual(constructionCounts(undone), { main: 97, pool: 4, setAside: 0 });
  assert.equal(undone.pool.find((entry) => entry.name === "Island").qty, 2);
});

test("bulk land add with no recognized names is a no-op", () => {
  const started = createConstructionSession(deckFixture());
  assert.equal(addCandidateLandsToMain(started, []), started);
  assert.equal(addCandidateLandsToMain(started, ["Unknown land-like name"]), started);
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

test("pool-versus-pool neither sets both cards aside as one undoable action", () => {
  const started = createConstructionSession(deckFixture());
  const rejected = setAsideVersusPair(started, [
    { name: "Candidate A", source: "pool" },
    { name: "Candidate C", source: "pool" },
  ]);
  assert.deepEqual(constructionCounts(rejected), { main: 97, pool: 2, setAside: 2 });
  assert.equal(rejected.setAside.find((entry) => entry.name === "Candidate A").qty, 1);
  assert.equal(rejected.setAside.find((entry) => entry.name === "Candidate C").qty, 1);
  assert.equal(rejected.history.length, 1);
  assert.match(rejected.notice, /Set both draft cards aside/);
  assert.deepEqual(constructionCounts(undoConstructionAction(rejected)), { main: 97, pool: 4, setAside: 0 });
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

test("main-versus-pool neither sets both cards aside and undo restores their original zones", () => {
  const deck = { ...deckFixture(), main: [{ qty: 100, name: "Main Card" }] };
  const started = createConstructionSession(deck);
  const rejected = setAsideVersusPair(started, [
    { name: "Main Card", source: "main" },
    { name: "Candidate A", source: "pool" },
  ]);
  assert.deepEqual(constructionCounts(rejected), { main: 99, pool: 3, setAside: 2 });
  assert.equal(rejected.setAside.find((entry) => entry.name === "Main Card").qty, 1);
  assert.equal(rejected.setAside.find((entry) => entry.name === "Candidate A").qty, 1);
  assert.equal(rejected.history.length, 1);
  assert.deepEqual(constructionCounts(undoConstructionAction(rejected)), { main: 100, pool: 4, setAside: 0 });
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
