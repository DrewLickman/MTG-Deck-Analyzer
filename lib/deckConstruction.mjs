import { normalizeName } from "./cardUtils.mjs";

const HISTORY_LIMIT = 40;

function cloneEntries(entries = []) {
  return entries.map((entry) => ({ ...entry }));
}

function countEntries(entries = []) {
  return entries.reduce((sum, entry) => sum + (Number(entry.qty) || 0), 0);
}

function findEntryIndex(entries, name) {
  const key = normalizeName(name);
  return entries.findIndex((entry) => normalizeName(entry.name) === key);
}

function addOne(entries, name) {
  const next = cloneEntries(entries);
  const index = findEntryIndex(next, name);
  if (index >= 0) next[index] = { ...next[index], qty: next[index].qty + 1 };
  else next.push({ qty: 1, name });
  return next;
}

function removeOne(entries, name) {
  const index = findEntryIndex(entries, name);
  if (index < 0) return null;
  const next = cloneEntries(entries);
  const entry = next[index];
  if (entry.qty > 1) next[index] = { ...entry, qty: entry.qty - 1 };
  else next.splice(index, 1);
  return next;
}

function snapshot(session, action) {
  return {
    main: cloneEntries(session.main),
    pool: cloneEntries(session.pool),
    setAside: cloneEntries(session.setAside),
    action,
  };
}

function withHistory(session, action, zones) {
  return {
    ...session,
    ...zones,
    history: [...session.history, snapshot(session, action)].slice(-HISTORY_LIMIT),
    notice: action,
  };
}

export function createConstructionSession(deck = {}) {
  const main = cloneEntries(deck.main);
  const pool = cloneEntries(deck.sideboard);
  const setAside = [];
  return {
    main,
    pool,
    setAside,
    initial: { main: cloneEntries(main), pool: cloneEntries(pool), setAside: [] },
    history: [],
    notice: pool.length
      ? "Candidate pool loaded from the imported Moxfield sideboard."
      : "The imported Moxfield sideboard is empty.",
  };
}

export function constructionCounts(session) {
  return {
    main: countEntries(session?.main),
    pool: countEntries(session?.pool),
    setAside: countEntries(session?.setAside),
  };
}

export function drawConstructionCandidates(entries = [], count = 1, random = Math.random) {
  const available = cloneEntries(entries).filter((entry) => entry.qty > 0);
  const drawn = [];
  while (available.length && drawn.length < count) {
    const index = Math.min(available.length - 1, Math.floor(random() * available.length));
    drawn.push(available[index].name);
    available.splice(index, 1);
  }
  return drawn;
}

export function addCandidateToMain(session, name, action = `Added ${name} to the main deck.`) {
  const pool = removeOne(session.pool, name);
  if (!pool) return session;
  return withHistory(session, action, {
    main: addOne(session.main, name),
    pool,
    setAside: cloneEntries(session.setAside),
  });
}

export function setAsideCandidates(session, names = []) {
  let pool = cloneEntries(session.pool);
  let setAside = cloneEntries(session.setAside);
  const moved = [];

  for (const name of names) {
    const nextPool = removeOne(pool, name);
    if (!nextPool) continue;
    pool = nextPool;
    setAside = addOne(setAside, name);
    moved.push(name);
  }

  if (!moved.length) return session;
  const action = moved.length === 1
    ? `Set ${moved[0]} aside for this session.`
    : `Set ${moved.join(" and ")} aside for this session.`;
  return withHistory(session, action, { main: cloneEntries(session.main), pool, setAside });
}

export function chooseVersusCandidate(session, winnerName, loserName) {
  return addCandidateToMain(
    session,
    winnerName,
    `Added ${winnerName}; ${loserName} returned to the candidate pool.`,
  );
}

export function returnVersusCandidates(session, names = []) {
  const returned = names.filter((name) => findEntryIndex(session.pool, name) >= 0);
  if (!returned.length) return session;
  return {
    ...session,
    notice: `Neither selected; ${returned.join(" and ")} returned to the candidate pool.`,
  };
}

export function undoConstructionAction(session) {
  if (!session?.history?.length) return session;
  const previous = session.history[session.history.length - 1];
  return {
    ...session,
    main: cloneEntries(previous.main),
    pool: cloneEntries(previous.pool),
    setAside: cloneEntries(previous.setAside),
    history: session.history.slice(0, -1),
    notice: `Undid: ${previous.action}`,
  };
}

export function restartConstructionSession(session) {
  if (!session?.initial) return session;
  const current = constructionCounts(session);
  const initial = constructionCounts(session.initial);
  if (current.main === initial.main && current.pool === initial.pool && current.setAside === initial.setAside) return session;
  return withHistory(session, "Restarted the drafting session.", {
    main: cloneEntries(session.initial.main),
    pool: cloneEntries(session.initial.pool),
    setAside: cloneEntries(session.initial.setAside),
  });
}

export function applyConstructionSession(deck, session) {
  if (!deck || !session) return deck;
  const main = cloneEntries(session.main);
  const cardCount = countEntries(main);
  const inferenceWarnings = (deck.inferenceWarnings || [])
    .filter((warning) => !/^Main deck has \d+ cards; expected \d+ after command-zone cards\.$/.test(warning));
  if (cardCount !== deck.expectedMainCount) {
    inferenceWarnings.push(`Main deck has ${cardCount} cards; expected ${deck.expectedMainCount} after command-zone cards.`);
  }
  return {
    ...deck,
    main,
    sideboard: cloneEntries(session.pool),
    cardCount,
    inferenceWarnings,
  };
}
