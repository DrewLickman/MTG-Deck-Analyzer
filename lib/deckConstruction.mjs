import { normalizeName } from "./cardUtils.mjs";

const HISTORY_LIMIT = 40;
const CONSTRUCTION_ZONES = new Set(["main", "pool", "setAside"]);

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

function addQuantity(entries, entry) {
  const quantity = Number(entry?.qty) || 0;
  if (quantity <= 0 || !entry?.name) return entries;
  const next = cloneEntries(entries);
  const index = findEntryIndex(next, entry.name);
  if (index >= 0) next[index] = { ...next[index], qty: (Number(next[index].qty) || 0) + quantity };
  else next.push({ ...entry, qty: quantity });
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

export function moveMainToCandidatePool(session) {
  const movedCount = countEntries(session?.main);
  if (!movedCount) return session;

  let pool = cloneEntries(session.pool);
  for (const entry of session.main) pool = addQuantity(pool, entry);

  return withHistory(
    session,
    `Moved ${movedCount} main-deck card${movedCount === 1 ? "" : "s"} to the candidate pool; command-zone cards remain separate.`,
    {
      main: [],
      pool,
      setAside: cloneEntries(session.setAside),
    },
  );
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

export function setAsideVersusCandidate(session, chosenName, otherName) {
  const pool = removeOne(session.pool, chosenName);
  if (!pool) return session;
  return withHistory(
    session,
    `Set ${chosenName} aside; ${otherName} returned to the candidate pool.`,
    {
      main: cloneEntries(session.main),
      pool,
      setAside: addOne(session.setAside, chosenName),
    },
  );
}

function hasComparisonCard(session, card) {
  const entries = card?.source === "main" ? session.main : card?.source === "pool" ? session.pool : null;
  return Boolean(card?.name && entries && findEntryIndex(entries, card.name) >= 0);
}

function comparisonSourceLabel(source) {
  return source === "main" ? "the main deck" : "the candidate pool";
}

function constructionZoneLabel(zone) {
  if (zone === "main") return "the main deck";
  if (zone === "pool") return "the candidate pool";
  return "Set Aside";
}

export function chooseVersusComparison(session, chosen, other) {
  if (!hasComparisonCard(session, chosen) || !hasComparisonCard(session, other)) return session;

  if (chosen.source === "pool" && other.source === "pool") {
    return chooseVersusCandidate(session, chosen.name, other.name);
  }

  if (chosen.source === "pool" && other.source === "main") {
    const pool = removeOne(session.pool, chosen.name);
    const main = removeOne(session.main, other.name);
    if (!pool || !main) return session;
    return withHistory(
      session,
      `Added ${chosen.name} from the candidate pool; ${other.name} returned to the candidate pool.`,
      {
        main: addOne(main, chosen.name),
        pool: addOne(pool, other.name),
        setAside: cloneEntries(session.setAside),
      },
    );
  }

  return withHistory(
    session,
    `Kept ${chosen.name} from ${comparisonSourceLabel(chosen.source)}; ${other.name} returned to the candidate pool.`,
    {
      main: session.main,
      pool: session.pool,
      setAside: session.setAside,
    },
  );
}

export function moveConstructionStack(session, { name, from, to } = {}) {
  if (!name || !CONSTRUCTION_ZONES.has(from) || !CONSTRUCTION_ZONES.has(to) || from === to) return session;

  const sourceIndex = findEntryIndex(session[from], name);
  if (sourceIndex < 0) return session;

  const moved = session[from][sourceIndex];
  const source = cloneEntries(session[from]);
  source.splice(sourceIndex, 1);
  const zones = {
    main: cloneEntries(session.main),
    pool: cloneEntries(session.pool),
    setAside: cloneEntries(session.setAside),
  };
  zones[from] = source;
  zones[to] = addQuantity(session[to], moved);

  return withHistory(
    session,
    `Moved ${Number(moved.qty) || 0}x ${moved.name} from ${constructionZoneLabel(from)} to ${constructionZoneLabel(to)}.`,
    zones,
  );
}

export function addCandidateLandsToMain(session, landNames = []) {
  const landKeys = new Set(landNames.map((name) => normalizeName(name)).filter(Boolean));
  if (!landKeys.size) return session;

  let main = cloneEntries(session.main);
  let pool = cloneEntries(session.pool);
  let movedCount = 0;

  for (const entry of session.pool) {
    if (!landKeys.has(normalizeName(entry.name))) continue;
    const quantity = Number(entry.qty) || 0;
    if (quantity <= 0) continue;
    main = addQuantity(main, entry);
    movedCount += quantity;
  }

  if (!movedCount) return session;
  pool = pool.filter((entry) => !landKeys.has(normalizeName(entry.name)));

  return withHistory(
    session,
    `Moved ${movedCount} candidate-pool land${movedCount === 1 ? "" : "s"} to the main deck.`,
    {
      main,
      pool,
      setAside: cloneEntries(session.setAside),
    },
  );
}

export function setAsideVersusComparison(session, chosen, other) {
  if (!hasComparisonCard(session, chosen) || !hasComparisonCard(session, other)) return session;
  if (chosen.source === "pool" && other.source === "pool") {
    return setAsideVersusCandidate(session, chosen.name, other.name);
  }

  if (chosen.source === "main") {
    const main = removeOne(session.main, chosen.name);
    if (!main) return session;
    return withHistory(
      session,
      `Set ${chosen.name} from the main deck aside; ${other.name} returned to the candidate pool.`,
      {
        main,
        pool: cloneEntries(session.pool),
        setAside: addOne(session.setAside, chosen.name),
      },
    );
  }

  const pool = removeOne(session.pool, chosen.name);
  if (!pool) return session;
  return withHistory(
    session,
    `Set ${chosen.name} from the candidate pool aside; ${other.name} remains in the main deck.`,
    {
      main: cloneEntries(session.main),
      pool,
      setAside: addOne(session.setAside, chosen.name),
    },
  );
}

export function setAsideVersusPair(session, cards = []) {
  if (cards.length !== 2 || cards.some((card) => !hasComparisonCard(session, card))) return session;

  let main = cloneEntries(session.main);
  let pool = cloneEntries(session.pool);
  let setAside = cloneEntries(session.setAside);

  for (const card of cards) {
    const next = card.source === "main" ? removeOne(main, card.name) : removeOne(pool, card.name);
    if (!next) return session;
    if (card.source === "main") main = next;
    else pool = next;
    setAside = addOne(setAside, card.name);
  }

  return withHistory(
    session,
    `Set both draft cards aside: ${cards.map((card) => card.name).join(" and ")}.`,
    { main, pool, setAside },
  );
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
