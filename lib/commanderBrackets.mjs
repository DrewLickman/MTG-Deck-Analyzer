import { findCard, getCardText, getRoles, normalizeName } from "./cardUtils.mjs";
import { GAME_CHANGER_METADATA, GAME_CHANGER_SET, GAME_CHANGERS } from "./gameChangers.mjs";

export const GAME_CHANGERS_VERSION = `${GAME_CHANGER_METADATA.generatedAt} ${GAME_CHANGER_METADATA.sourceQuery}`;

const FAST_MANA = new Set([
  "ancient tomb",
  "chrome mox",
  "grim monolith",
  "jeweled lotus",
  "lion's eye diamond",
  "lotus petal",
  "mana crypt",
  "mana vault",
  "mox amber",
  "mox diamond",
  "mox opal",
]);

const KNOWN_COMBOS = [
  {
    name: "Thassa's Oracle package",
    cards: ["Thassa's Oracle", "Demonic Consultation", "Tainted Pact"],
    minMatches: 2,
    severity: "critical",
  },
  {
    name: "Underworld Breach loop",
    cards: ["Underworld Breach", "Brain Freeze", "Lion's Eye Diamond"],
    minMatches: 2,
    severity: "critical",
  },
  {
    name: "Isochron Scepter engine",
    cards: ["Isochron Scepter", "Dramatic Reversal"],
    minMatches: 2,
    severity: "warning",
  },
  {
    name: "Kiki-Jiki combo",
    cards: ["Kiki-Jiki, Mirror Breaker", "Zealous Conscripts", "Pestermite", "Deceiver Exarch"],
    minMatches: 2,
    severity: "warning",
  },
  {
    name: "Food Chain package",
    cards: ["Food Chain", "Misthollow Griffin", "Squee, the Immortal", "Eternal Scourge"],
    minMatches: 2,
    severity: "warning",
  },
];

export function isGameChangerName(name) {
  const normalized = normalizeName(name);
  const frontFace = normalizeName(String(name || "").split(" // ")[0]);
  return GAME_CHANGER_SET.has(normalized) || GAME_CHANGER_SET.has(frontFace);
}

function bracketDeckEntries(deck) {
  return [
    ...deck.commanders,
    ...deck.companions,
    ...deck.main,
  ];
}

function namesInDeck(deck) {
  return new Set(bracketDeckEntries(deck).map((entry) => normalizeName(entry.name)));
}

function findGameChangers(deck) {
  return bracketDeckEntries(deck)
    .filter((entry) => isGameChangerName(entry.name))
    .map((entry) => entry.name);
}

function findFastMana(deck) {
  return deck.main
    .filter((entry) => FAST_MANA.has(normalizeName(entry.name)))
    .map((entry) => entry.name);
}

function findCompactCombos(deck) {
  const nameSet = namesInDeck(deck);
  return KNOWN_COMBOS.map((combo) => {
    const matches = combo.cards.filter((name) => nameSet.has(normalizeName(name)));
    return matches.length >= combo.minMatches ? { ...combo, matches } : null;
  }).filter(Boolean);
}

function countTutors(deck, cardMap) {
  return deck.main.reduce((sum, entry) => {
    const roles = getRoles(findCard(cardMap, entry.name));
    return sum + (roles.tutor ? entry.qty : 0);
  }, 0);
}

function findBanned(deck, cardMap) {
  return bracketDeckEntries(deck)
    .filter((entry) => findCard(cardMap, entry.name)?.legalities?.commander === "banned")
    .map((entry) => entry.name);
}

function estimateWinTurn({ stats, gameChangerCount, fastManaCount, comboSignals, tutorCount }) {
  let turn = 9;
  if (stats.avgCmc <= 3.2 && stats.rampCount >= 8) turn = 8;
  if (gameChangerCount >= 1 || fastManaCount >= 2 || tutorCount >= 3) turn = Math.min(turn, 7);
  if (gameChangerCount >= 3 || fastManaCount >= 3 || comboSignals.length) turn = Math.min(turn, 6);
  if (comboSignals.some((combo) => combo.severity === "critical") && (fastManaCount >= 2 || tutorCount >= 3)) turn = Math.min(turn, 5);
  if (fastManaCount >= 5 && tutorCount >= 4) turn = Math.min(turn, 4);
  return turn;
}

function bracketFromSignals({ expectedWinTurn, gameChangerCount, fastManaCount, comboSignals, bannedCards }) {
  if (bannedCards.length) return 5;
  if (expectedWinTurn <= 4 || (comboSignals.some((combo) => combo.severity === "critical") && fastManaCount >= 3)) return 5;
  if (expectedWinTurn <= 6 || gameChangerCount >= 4 || fastManaCount >= 4 || comboSignals.length >= 2) return 4;
  if (expectedWinTurn <= 7 || gameChangerCount >= 1 || fastManaCount >= 2 || comboSignals.length === 1) return 3;
  if (expectedWinTurn <= 9) return 2;
  return 1;
}

function confidenceForSignals({ gameChangerCount, fastManaCount, comboSignals, tutorCount, warnings }) {
  let confidence = 0.58;
  if (gameChangerCount || fastManaCount || comboSignals.length || tutorCount) confidence += 0.18;
  if (gameChangerCount >= 3 || fastManaCount >= 3 || comboSignals.length) confidence += 0.12;
  if (warnings?.length) confidence -= 0.08;
  return Math.max(0.35, Math.min(0.92, confidence));
}

function bracketLabel(bracket) {
  return [
    "",
    "Exhibition",
    "Core",
    "Upgraded",
    "Optimized",
    "cEDH-style",
  ][bracket] || "Unknown";
}

function buildReasons({ bracket, expectedWinTurn, gameChangers, fastMana, comboSignals, tutorCount, bannedCards }) {
  const reasons = [];
  if (bannedCards.length) reasons.push(`Commander-banned card detected: ${bannedCards.join(", ")}.`);
  if (gameChangers.length) reasons.push(`${gameChangers.length} local Game Changer match(es): ${gameChangers.join(", ")}.`);
  if (fastMana.length) reasons.push(`${fastMana.length} fast-mana card(s) detected: ${fastMana.join(", ")}.`);
  if (comboSignals.length) reasons.push(`Compact combo package detected: ${comboSignals.map((combo) => combo.name).join(", ")}.`);
  if (tutorCount >= 3) reasons.push(`${tutorCount} tutor-like effects increase consistency, but tutors are context rather than an automatic bracket bump.`);
  reasons.push(`Estimated earliest consistent win pressure: around turn ${expectedWinTurn}.`);
  if (bracket <= 2 && reasons.length === 1) reasons.push("No compact combo, fast-mana cluster, or local Game Changer pressure was detected.");
  return reasons;
}

function upgradeSuggestions(bracket, stats, comboSignals) {
  const suggestions = [];
  if (bracket >= 4) suggestions.push("For lower-power pods, remove compact combo packages or reduce fast mana first.");
  if (comboSignals.length) suggestions.push("Flag known combo packages in the pregame conversation.");
  if (stats.rampCount < 8) suggestions.push("Add more ramp before increasing threat density.");
  if (stats.removalCount < 3) suggestions.push("Add flexible interaction before adding more engines.");
  if (!suggestions.length) suggestions.push("Power signals are coherent; tune by matchup expectations rather than raw speed.");
  return suggestions;
}

function indicator(kind, text, cards = []) {
  return { kind, text, cards: [...new Set(cards)].filter(Boolean) };
}

function buildBracketDimensions({ bracket, expectedWinTurn, gameChangers, fastMana, comboSignals, tutorCount, bannedCards, stats }) {
  const comboCards = comboSignals.flatMap((combo) => combo.matches || []);
  return {
    power: {
      score: bracket,
      positive: [
        gameChangers.length ? indicator("raises", `${gameChangers.length} Game Changer card(s) increase raw power expectations.`, gameChangers) : null,
        comboSignals.length ? indicator("raises", `${comboSignals.length} compact combo package(s) can end games abruptly.`, comboCards) : null,
        bannedCards.length ? indicator("raises", `${bannedCards.length} Commander-banned card(s) require a Rule 0 conversation.`, bannedCards) : null,
      ].filter(Boolean),
      negative: [
        !gameChangers.length ? indicator("lowers", "No Game Changer cards were detected in commander, companion, or main deck.") : null,
        !comboSignals.length ? indicator("lowers", "No known compact combo package was detected.") : null,
      ].filter(Boolean),
    },
    consistency: {
      score: tutorCount >= 3 ? "high" : tutorCount ? "medium" : "low",
      positive: [
        tutorCount ? indicator("raises", `${tutorCount} tutor-like effect(s) improve access to key cards.`) : null,
        stats.rampCount >= 8 ? indicator("raises", `${stats.rampCount} ramp pieces support repeatable setup.`) : null,
      ].filter(Boolean),
      negative: [
        tutorCount < 3 ? indicator("lowers", `${tutorCount} tutor-like effect(s); fewer redundant search effects lowers consistency pressure.`) : null,
        stats.rampCount < 8 ? indicator("lowers", `${stats.rampCount} ramp pieces; fewer than 8 slows repeatable setup.`) : null,
      ].filter(Boolean),
    },
    speed: {
      score: expectedWinTurn,
      positive: [
        fastMana.length ? indicator("raises", `${fastMana.length} fast-mana card(s) can accelerate early turns.`, fastMana) : null,
        expectedWinTurn <= 7 ? indicator("raises", `Expected pressure around turn ${expectedWinTurn}.`) : null,
      ].filter(Boolean),
      negative: [
        expectedWinTurn >= 8 ? indicator("lowers", `Expected pressure around turn ${expectedWinTurn}, which is below optimized speed pressure.`) : null,
        fastMana.length < 2 ? indicator("lowers", `${fastMana.length} fast-mana card(s); no fast-mana cluster detected.`, fastMana) : null,
      ].filter(Boolean),
    },
    salt: {
      score: gameChangers.length + comboSignals.length + bannedCards.length,
      positive: [
        gameChangers.length ? indicator("raises", "Game Changer cards can create pregame expectation or salt concerns.", gameChangers) : null,
        comboSignals.length ? indicator("raises", "Compact combos should be disclosed before play.", comboCards) : null,
      ].filter(Boolean),
      negative: [
        !gameChangers.length && !comboSignals.length ? indicator("lowers", "No local Game Changer or compact combo salt signal was detected.") : null,
      ].filter(Boolean),
    },
  };
}

export function analyzeBracket(deck, cardMap, stats) {
  const gameChangers = findGameChangers(deck);
  const fastMana = findFastMana(deck);
  const comboSignals = findCompactCombos(deck);
  const tutorCount = countTutors(deck, cardMap);
  const bannedCards = findBanned(deck, cardMap);
  const expectedWinTurn = estimateWinTurn({
    stats,
    gameChangerCount: gameChangers.length,
    fastManaCount: fastMana.length,
    comboSignals,
    tutorCount,
  });
  const bracket = bracketFromSignals({
    expectedWinTurn,
    gameChangerCount: gameChangers.length,
    fastManaCount: fastMana.length,
    comboSignals,
    bannedCards,
  });
  const confidence = confidenceForSignals({
    gameChangerCount: gameChangers.length,
    fastManaCount: fastMana.length,
    comboSignals,
    tutorCount,
    warnings: deck.inferenceWarnings,
  });
  const rangeLabel = confidence < 0.65 && bracket < 5
    ? `Bracket ${bracket}, possibly ${bracket + 1}`
    : `Bracket ${bracket}`;

  return {
    bracket,
    label: bracketLabel(bracket),
    rangeLabel,
    confidence,
    expectedWinTurn,
    gameChangers,
    gameChangerVersion: GAME_CHANGERS_VERSION,
    speedSignals: [
      ...fastMana.map((name) => ({ type: "fast mana", name })),
      ...(tutorCount ? [{ type: "tutors", name: `${tutorCount} tutor-like effects` }] : []),
    ],
    comboSignals,
    bannedCards,
    reasons: buildReasons({
      bracket,
      expectedWinTurn,
      gameChangers,
      fastMana,
      comboSignals,
      tutorCount,
      bannedCards,
    }),
    upgradeSuggestions: upgradeSuggestions(bracket, stats, comboSignals),
    dimensions: buildBracketDimensions({
      bracket,
      expectedWinTurn,
      gameChangers,
      fastMana,
      comboSignals,
      tutorCount,
      bannedCards,
      stats,
    }),
    gameChangerMetadata: GAME_CHANGER_METADATA,
  };
}

export function cardHasBracketText(card) {
  const text = getCardText(card);
  return /win the game|can't lose the game|extra turn|skip.*turn|cast .*without paying/.test(text);
}
