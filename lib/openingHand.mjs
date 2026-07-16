import { findCard, getRoleKeys, isLandCard, normalizeName } from "./cardUtils.mjs";

const FLOW_ROLES = new Set(["draw", "cardSelection", "tutor"]);
const EARLY_ROLES = new Set(["ramp", "draw", "cardSelection", "tutor", "costReducer", "manaFixing", "engine"]);

function expandMainDeck(deck = {}) {
  return (deck.main || []).flatMap((entry) =>
    Array.from({ length: Math.max(0, Number(entry.qty) || 0) }, (_, copyIndex) => ({
      name: entry.name,
      copyIndex,
    })),
  );
}

export function drawOpeningHand(deck, random = Math.random, handSize = 7) {
  const library = expandMainDeck(deck);
  for (let index = library.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [library[index], library[swapIndex]] = [library[swapIndex], library[index]];
  }
  return library.slice(0, Math.min(handSize, library.length));
}

function cardFacts(entry, cardMap) {
  const card = findCard(cardMap, entry.name);
  const land = isLandCard(entry.name, card);
  const roles = land ? ["land"] : getRoleKeys(card);
  return {
    ...entry,
    card,
    land,
    roles,
    cmc: land ? 0 : Number.isFinite(Number(card?.cmc)) ? Number(card.cmc) : 99,
  };
}

function summarizeHand(hand, cardMap, coreCards = []) {
  const coreNames = new Set(coreCards.map(normalizeName));
  const cards = hand.map((entry) => cardFacts(entry, cardMap));
  const spells = cards.filter((card) => !card.land);
  const hasRole = (card, roles) => card.roles.some((role) => roles.has(role));
  const lands = cards.filter((card) => card.land);
  const earlyCards = spells.filter((card) => card.cmc <= 2 || card.roles.includes("fastMana") || (card.cmc <= 3 && hasRole(card, EARLY_ROLES)));
  const flowCards = spells.filter((card) => hasRole(card, FLOW_ROLES));
  const rampCards = spells.filter((card) => card.roles.includes("ramp") || card.roles.includes("fastMana"));
  const interactionCards = spells.filter((card) => card.roles.includes("removal") || card.roles.includes("boardWipe"));
  const engineCards = spells.filter((card) => card.roles.includes("engine") || coreNames.has(normalizeName(card.name)));
  const averageSpellCmc = spells.length ? spells.reduce((sum, card) => sum + card.cmc, 0) / spells.length : 0;
  const earlyCastable = spells.filter((card) => card.cmc <= Math.max(2, lands.length)).length;

  return {
    cards,
    spells,
    lands,
    landCount: lands.length,
    earlyCards,
    flowCards,
    rampCards,
    interactionCards,
    engineCards,
    averageSpellCmc,
    earlyCastable,
  };
}

function landScore(landCount) {
  return [-45, -28, 14, 22, 13, -8, -25, -40][landCount] ?? -40;
}

function evaluateHand(hand, cardMap, coreCards = []) {
  const summary = summarizeHand(hand, cardMap, coreCards);
  let score = 45 + landScore(summary.landCount);
  score += Math.min(15, summary.earlyCards.length * 6);
  if (summary.earlyCards.length === 0) score -= 12;
  score += Math.min(10, summary.rampCards.length * (summary.landCount <= 2 ? 5 : 3));
  score += Math.min(8, summary.flowCards.length * 4);
  score += Math.min(8, summary.engineCards.length * 4);
  score += Math.min(4, summary.interactionCards.length * 2);
  score += Math.min(6, summary.earlyCastable * 2);
  if (summary.spells.length && summary.averageSpellCmc <= 3.5) score += 5;
  if (summary.averageSpellCmc > 4.5) score -= 8;
  score = Math.max(0, Math.min(100, Math.round(score)));

  const verdict = score >= 78
    ? { label: "Strong keep", status: "good" }
    : score >= 62
      ? { label: "Keepable", status: "good" }
      : score >= 45
        ? { label: "Risky keep", status: "warn" }
        : { label: "Mulligan", status: "bad" };

  const strengths = [];
  const concerns = [];
  if (summary.landCount >= 2 && summary.landCount <= 4) strengths.push(`${summary.landCount} lands gives the hand a functional mana base.`);
  if (summary.earlyCards.length >= 2) strengths.push(`${summary.earlyCards.length} early plays provide useful opening turns.`);
  if (summary.flowCards.length) strengths.push(`${summary.flowCards.length} draw or selection piece${summary.flowCards.length === 1 ? "" : "s"} can smooth later draws.`);
  if (summary.rampCards.length) strengths.push(`${summary.rampCards.length} acceleration piece${summary.rampCards.length === 1 ? "" : "s"} can move the game plan forward.`);
  if (summary.engineCards.length) strengths.push("The hand already touches a core or engine card.");
  if (summary.landCount < 2) concerns.push(`Only ${summary.landCount} land${summary.landCount === 1 ? "" : "s"}; the hand is unlikely to develop reliably.`);
  if (summary.landCount > 4) concerns.push(`${summary.landCount} lands leaves too little action.`);
  if (summary.earlyCards.length === 0) concerns.push("No cheap play or early setup piece was detected.");
  if (summary.flowCards.length === 0) concerns.push("No draw, tutor, or card selection can repair an awkward sequence.");
  if (summary.averageSpellCmc > 4.5) concerns.push(`The nonland cards average ${summary.averageSpellCmc.toFixed(1)} mana, making the hand slow.`);
  if (summary.engineCards.length === 0) concerns.push("The hand does not yet connect to a selected core card or visible engine.");

  return { score, verdict, summary, strengths, concerns };
}

function remainingLibrary(deck, hand) {
  const remaining = expandMainDeck(deck);
  for (const held of hand) {
    const index = remaining.findIndex((entry) => normalizeName(entry.name) === normalizeName(held.name));
    if (index >= 0) remaining.splice(index, 1);
  }
  return remaining;
}

function glueReason(candidate, baseline, replacement) {
  const roles = candidate.roles;
  if (baseline.summary.landCount < 2 && candidate.land) return "Adds the missing mana source this hand needs to function.";
  if (baseline.summary.landCount > 4 && !candidate.land && (candidate.cmc <= 2 || roles.some((role) => EARLY_ROLES.has(role)))) return "Turns excess mana into an early play that advances the deck.";
  if (!baseline.summary.flowCards.length && roles.some((role) => FLOW_ROLES.has(role))) return "Adds draw or selection that can connect this hand to its next needed piece.";
  if (!baseline.summary.rampCards.length && (roles.includes("ramp") || roles.includes("fastMana"))) return "Adds acceleration so the hand reaches its engine and commander sooner.";
  if (!baseline.summary.engineCards.length && (roles.includes("engine") || candidate.core)) return "Connects the opening hand directly to the deck's core engine.";
  if (!baseline.summary.earlyCards.length && candidate.cmc <= 2) return "Adds a meaningful play for the first two turns.";
  return `Improves the hand's mana, curve, or strategic coverage in place of ${replacement.name}.`;
}

function findGlueCards({ deck, hand, cardMap, analysis, coreCards, baseline }) {
  const scoreByName = new Map((analysis?.scores || []).map((item) => [normalizeName(item.name), item.score || 0]));
  const coreNames = new Set(coreCards.map(normalizeName));
  const candidates = [];
  const seen = new Set();

  for (const entry of remainingLibrary(deck, hand)) {
    const key = normalizeName(entry.name);
    if (seen.has(key)) continue;
    seen.add(key);
    const facts = { ...cardFacts(entry, cardMap), core: coreNames.has(key) };
    let best = null;
    for (let index = 0; index < hand.length; index += 1) {
      const nextHand = hand.map((held, heldIndex) => heldIndex === index ? entry : held);
      const result = evaluateHand(nextHand, cardMap, coreCards);
      const improvement = result.score - baseline.score;
      if (!best || improvement > best.improvement) {
        best = { improvement, replacement: hand[index], resultingScore: result.score };
      }
    }
    if (!best || best.improvement <= 0) continue;
    candidates.push({
      name: entry.name,
      roles: facts.roles,
      improvement: best.improvement,
      resultingScore: best.resultingScore,
      replaces: best.replacement.name,
      strategyScore: scoreByName.get(key) || 0,
      reason: glueReason(facts, baseline, best.replacement),
    });
  }

  return candidates
    .sort((left, right) => right.improvement - left.improvement || right.strategyScore - left.strategyScore || left.name.localeCompare(right.name))
    .slice(0, 3);
}

export function analyzeOpeningHand({ deck, hand, cardMap = {}, analysis = {}, coreCards = [] }) {
  const baseline = evaluateHand(hand, cardMap, coreCards);
  const glueCards = findGlueCards({ deck, hand, cardMap, analysis, coreCards, baseline });
  return {
    score: baseline.score,
    verdict: baseline.verdict,
    strengths: baseline.strengths,
    concerns: baseline.concerns,
    metrics: {
      lands: baseline.summary.landCount,
      earlyPlays: baseline.summary.earlyCards.length,
      ramp: baseline.summary.rampCards.length,
      cardFlow: baseline.summary.flowCards.length,
      interaction: baseline.summary.interactionCards.length,
      engineAccess: baseline.summary.engineCards.length,
      averageSpellCmc: Math.round(baseline.summary.averageSpellCmc * 10) / 10,
    },
    cards: baseline.summary.cards,
    glueCards,
    glueSummary: glueCards.length
      ? `${glueCards.map((card) => card.name).join(", ")} would most improve this exact seven.`
      : "This hand is already cohesive enough that no single swap creates a meaningful measured improvement.",
  };
}
