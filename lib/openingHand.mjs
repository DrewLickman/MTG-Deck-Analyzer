import { BASIC_LAND_MANA, findCard, getCardText, getManaCost, getRoleKeys, isLandCard, normalizeName } from "./cardUtils.mjs";

const COLORS = ["W", "U", "B", "R", "G"];
const FLOW_ROLES = new Set(["draw", "cardSelection", "tutor"]);
const EARLY_ROLES = new Set(["ramp", "draw", "cardSelection", "tutor", "costReducer", "manaFixing", "engine"]);
const PROACTIVE_ROLES = new Set(["ramp", "draw", "cardSelection", "engine", "payoff", "tokenMaker", "fastMana", "costReducer", "manaFixing"]);

function expandMainDeck(deck = {}) {
  return (deck.main || []).flatMap((entry) =>
    Array.from({ length: Math.max(0, Number(entry.qty) || 0) }, (_, copyIndex) => ({ name: entry.name, copyIndex })),
  );
}

function shuffleEntries(entries, random = Math.random) {
  const library = [...entries];
  for (let index = library.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [library[index], library[swapIndex]] = [library[swapIndex], library[index]];
  }
  return library;
}

export function drawOpeningSample(deck, random = Math.random, handSize = 7, futureDrawCount = 3) {
  const library = shuffleEntries(expandMainDeck(deck), random);
  const openingCount = Math.min(handSize, library.length);
  return {
    hand: library.slice(0, openingCount),
    futureDraws: library.slice(openingCount, openingCount + Math.max(0, futureDrawCount)),
  };
}

export function drawOpeningHand(deck, random = Math.random, handSize = 7) {
  return drawOpeningSample(deck, random, handSize, 0).hand;
}

export function addCardToOpeningHand(deck, hand, name, handSize = 7) {
  if (hand.length >= handSize) return hand;
  const deckEntry = (deck.main || []).find((entry) => normalizeName(entry.name) === normalizeName(name));
  if (!deckEntry) return hand;

  const quantity = Math.max(0, Number(deckEntry.qty) || 0);
  const selectedCopies = hand.filter((entry) => normalizeName(entry.name) === normalizeName(deckEntry.name));
  if (selectedCopies.length >= quantity) return hand;

  const usedIndexes = new Set(selectedCopies.map((entry) => entry.copyIndex));
  let copyIndex = 0;
  while (usedIndexes.has(copyIndex)) copyIndex += 1;
  return [...hand, { name: deckEntry.name, copyIndex }];
}

export function removeCardFromOpeningHand(hand, index) {
  return hand.filter((_, cardIndex) => cardIndex !== index);
}

export function bottomCardsForLondonMulligan(hand, indexes, mulliganCount) {
  const count = Number(mulliganCount);
  const selected = [...new Set((indexes || []).map(Number))].sort((left, right) => left - right);
  if (hand.length !== 7) throw new Error("A London mulligan starts by drawing seven cards.");
  if (!Number.isInteger(count) || count < 0 || count > 2) throw new Error("This lab supports final hand sizes from seven to five cards.");
  if (selected.length !== count || selected.some((index) => !Number.isInteger(index) || index < 0 || index >= hand.length)) {
    throw new Error(`Choose exactly ${count} card${count === 1 ? "" : "s"} to put on the bottom.`);
  }
  const bottomed = new Set(selected);
  return hand.filter((_, index) => !bottomed.has(index));
}

function remainingLibrary(deck, hand) {
  const remaining = expandMainDeck(deck);
  for (const held of hand) {
    const index = remaining.findIndex((entry) => normalizeName(entry.name) === normalizeName(held.name));
    if (index >= 0) remaining.splice(index, 1);
  }
  return remaining;
}

export function drawFutureCards(deck, excluded = [], random = Math.random, drawCount = 3) {
  return shuffleEntries(remainingLibrary(deck, excluded), random).slice(0, Math.max(0, drawCount));
}

function producedManaSymbols(entry, card) {
  const basicMana = BASIC_LAND_MANA[entry.name];
  const metadata = Array.isArray(card?.produced_mana) ? card.produced_mana : [];
  return [...new Set([...metadata, basicMana].filter((symbol) => ["W", "U", "B", "R", "G", "C"].includes(symbol)))];
}

function manaOptionsFor(card, manaSymbols) {
  const text = getCardText(card);
  const explicit = [...text.matchAll(/\badd\s+([^\.\n]+)/gi)]
    .flatMap((match) => {
      const tokens = [...match[1].matchAll(/\{([wubrgc])\}/gi)].map((item) => item[1].toUpperCase());
      if (!tokens.length) return [];
      return /,|\bor\b/.test(match[1]) ? tokens.map((symbol) => [symbol]) : [tokens];
    });
  if (explicit.length) return explicit;
  return manaSymbols.map((symbol) => [symbol]);
}

function parseManaCost(card) {
  const cost = getManaCost(card);
  const result = { generic: 0, colored: {}, colorless: 0, hybrid: [], unsupported: false };
  if (!cost) return result;
  for (const match of String(cost).matchAll(/\{([^}]+)\}/g)) {
    const token = match[1].toUpperCase();
    if (/^\d+$/.test(token)) result.generic += Number(token);
    else if (COLORS.includes(token)) result.colored[token] = (result.colored[token] || 0) + 1;
    else if (token === "C") result.colorless += 1;
    else if (/^[WUBRG]\/[WUBRG]$/.test(token)) result.hybrid.push(token.split("/"));
    else result.unsupported = true;
  }
  return result;
}

function isUnconditionallyTappedLand(card) {
  return /enters the battlefield tapped(?:\.|$)/.test(getCardText(card));
}

function cardFacts(entry, cardMap, coreNames = new Set(), zone = "hand") {
  const card = findCard(cardMap, entry.name);
  const land = isLandCard(entry.name, card);
  const roles = land ? ["land"] : getRoleKeys(card);
  const manaSymbols = producedManaSymbols(entry, card);
  const type = String(card?.type_line || "").toLowerCase();
  const manaOptions = manaOptionsFor(card, manaSymbols);
  const manaSource = land && manaSymbols.length > 0;
  const colorlessOnly = manaSource && manaSymbols.includes("C") && !manaSymbols.some((symbol) => COLORS.includes(symbol));
  return {
    ...entry,
    key: `${zone}-${normalizeName(entry.name)}-${entry.copyIndex ?? "command"}`,
    card,
    zone,
    land,
    manaSymbols,
    manaOptions,
    manaSource,
    colorlessOnly,
    nonManaLand: land && !manaSource,
    entersTapped: land && isUnconditionallyTappedLand(card),
    roles,
    core: coreNames.has(normalizeName(entry.name)),
    type,
    cmc: land ? 0 : Number.isFinite(Number(card?.cmc)) ? Number(card.cmc) : 99,
    manaCost: parseManaCost(card),
  };
}

function compareOpeningHandCards(left, right) {
  if (left.land !== right.land) return left.land ? -1 : 1;
  if (!left.land && left.cmc !== right.cmc) return left.cmc - right.cmc;
  return left.name.localeCompare(right.name);
}

function colorsInCost(cost) {
  return [...Object.keys(cost.colored || {}), ...(cost.hybrid || []).flat()].filter((color) => COLORS.includes(color));
}

function deckColorsFor(analysis, cards = []) {
  const fromAnalysis = COLORS.filter((color) => Number(analysis?.colorPips?.[color]) > 0);
  if (fromAnalysis.length) return fromAnalysis;
  return [...new Set(cards.flatMap((card) => colorsInCost(card.manaCost)))];
}

function summarizeHand(hand, cardMap, coreCards = [], analysis = {}) {
  const coreNames = new Set(coreCards.map(normalizeName));
  const cards = hand.map((entry, index) => cardFacts({ ...entry, copyIndex: entry.copyIndex ?? index }, cardMap, coreNames)).sort(compareOpeningHandCards);
  const spells = cards.filter((card) => !card.land);
  const lands = cards.filter((card) => card.land);
  const manaLands = lands.filter((card) => card.manaSource);
  const colorlessLands = manaLands.filter((card) => card.colorlessOnly);
  const nonManaLands = lands.filter((card) => card.nonManaLand);
  const hasRole = (card, roles) => card.roles.some((role) => roles.has(role));
  const earlyCandidates = spells.filter((card) => card.cmc <= 2 || card.roles.includes("fastMana") || (card.cmc <= 3 && hasRole(card, EARLY_ROLES)));
  const flowCards = spells.filter((card) => hasRole(card, FLOW_ROLES));
  const rampCards = spells.filter((card) => card.roles.includes("ramp") || card.roles.includes("fastMana"));
  const interactionCards = spells.filter((card) => card.roles.includes("removal") || card.roles.includes("boardWipe"));
  const engineCards = spells.filter((card) => card.roles.includes("engine") || card.core);
  const averageSpellCmc = spells.length ? spells.reduce((sum, card) => sum + card.cmc, 0) / spells.length : 0;
  const deckColors = deckColorsFor(analysis, cards);
  const coveredColors = deckColors.filter((color) => manaLands.some((land) => land.manaSymbols.includes(color)));
  const missingColors = deckColors.filter((color) => !coveredColors.includes(color));
  const earlyColorDemand = [...new Set(earlyCandidates.flatMap((card) => colorsInCost(card.manaCost)))];
  const earlyMissingColors = earlyColorDemand.filter((color) => !manaLands.some((land) => land.manaSymbols.includes(color)));
  return {
    cards,
    spells,
    lands,
    manaLands,
    colorlessLands,
    nonManaLands,
    landCount: lands.length,
    manaSourceCount: manaLands.length,
    colorlessSourceCount: colorlessLands.length,
    nonManaLandCount: nonManaLands.length,
    coloredSourceCount: manaLands.filter((card) => card.manaSymbols.some((symbol) => COLORS.includes(symbol))).length,
    deckColors,
    coveredColors,
    missingColors,
    earlyColorDemand,
    earlyMissingColors,
    earlyCandidates,
    flowCards,
    rampCards,
    interactionCards,
    engineCards,
    averageSpellCmc,
  };
}

function payMana(cost, manaPool) {
  const remaining = [...manaPool];
  const spend = (symbol) => {
    const index = remaining.indexOf(symbol);
    if (index < 0) return false;
    remaining.splice(index, 1);
    return true;
  };
  for (const color of COLORS) for (let count = 0; count < (cost.colored?.[color] || 0); count += 1) if (!spend(color)) return null;
  for (let count = 0; count < (cost.colorless || 0); count += 1) if (!spend("C")) return null;
  for (const choices of cost.hybrid || []) {
    const match = choices.find((color) => remaining.includes(color));
    if (!match || !spend(match)) return null;
  }
  if (remaining.length < (cost.generic || 0)) return null;
  for (let count = 0; count < (cost.generic || 0); count += 1) {
    const preferred = remaining.findIndex((symbol) => symbol === "C");
    remaining.splice(preferred >= 0 ? preferred : 0, 1);
  }
  return remaining;
}

function findPaymentPlan(cost, manaPool, sources, turn) {
  if (cost.unsupported) return null;
  const readySources = sources.filter((source) => !source.tapped && source.availableTurn <= turn && source.manaOptions.length);
  let best = null;
  const consider = (tokens, tappedIds) => {
    const remainingPool = payMana(cost, tokens);
    if (!remainingPool) return;
    const candidate = { remainingPool, tappedIds };
    if (!best || candidate.tappedIds.length < best.tappedIds.length || (candidate.tappedIds.length === best.tappedIds.length && candidate.remainingPool.length > best.remainingPool.length)) best = candidate;
  };
  const visit = (index, tokens, tappedIds) => {
    if (index === readySources.length) return consider(tokens, tappedIds);
    visit(index + 1, tokens, tappedIds);
    const source = readySources[index];
    const seen = new Set();
    for (const option of source.manaOptions) {
      const signature = option.join(",");
      if (seen.has(signature)) continue;
      seen.add(signature);
      visit(index + 1, [...tokens, ...option], [...tappedIds, source.id]);
    }
  };
  visit(0, manaPool, []);
  return best;
}

function sourceFor(card, turn, sourceIndex) {
  const creatureManaSource = !card.land && card.type.includes("creature");
  return {
    id: `${card.key}-source-${sourceIndex}`,
    manaOptions: card.manaOptions,
    availableTurn: card.entersTapped || creatureManaSource ? turn + 1 : turn,
    tapped: false,
  };
}

function isManaPermanent(card) {
  return !card.land && !/(instant|sorcery)/.test(card.type) && card.manaOptions.length > 0;
}

function isPurelyReactive(card) {
  const reactive = card.roles.some((role) => ["removal", "boardWipe", "protection"].includes(role));
  return reactive && !card.roles.some((role) => PROACTIVE_ROLES.has(role));
}

function canRecommendCard(card) {
  if (card.land || card.manaCost.unsupported || isPurelyReactive(card)) return false;
  if (/(instant|sorcery)/.test(card.type)) return card.roles.some((role) => PROACTIVE_ROLES.has(role));
  return true;
}

function playValue(card, analysisScores, turn) {
  const strategyScore = analysisScores.get(normalizeName(card.name)) || 0;
  let value = strategyScore;
  if (card.roles.includes("fastMana") || card.roles.includes("ramp")) value += 100;
  if (card.roles.includes("draw") || card.roles.includes("cardSelection")) value += 82;
  if (card.zone === "command") value += 74;
  if (card.core || card.roles.includes("engine")) value += 62;
  if (card.roles.includes("payoff") || card.roles.includes("tokenMaker")) value += 48;
  if (!/(instant|sorcery)/.test(card.type)) value += 28;
  return value - Math.max(0, card.cmc - turn) * 2;
}

function landValue(card, deckColors, analysisScores) {
  const coverage = card.manaSymbols.filter((symbol) => deckColors.includes(symbol)).length;
  return coverage * 30 + card.manaSymbols.filter((symbol) => COLORS.includes(symbol)).length * 6 + (card.manaSymbols.includes("C") ? 3 : 0) + (card.entersTapped ? 0 : 8) + (analysisScores.get(normalizeName(card.name)) || 0) / 100;
}

function briefCard(card) {
  return { name: card.name, card: card.card, roles: card.roles, zone: card.zone, cmc: card.cmc, manaCost: getManaCost(card.card) };
}

export function buildGoldfishPlan({ hand = [], futureDraws = [], cardMap = {}, analysis = {}, coreCards = [], commanders = [], turnCount = 3 }) {
  const coreNames = new Set(coreCards.map(normalizeName));
  const handCards = hand.map((entry, index) => cardFacts({ ...entry, copyIndex: entry.copyIndex ?? index }, cardMap, coreNames));
  const commandCards = commanders.map((entry, index) => cardFacts({ ...entry, copyIndex: entry.copyIndex ?? index }, cardMap, coreNames, "command"));
  const deckColors = deckColorsFor(analysis, [...handCards, ...commandCards]);
  const analysisScores = new Map((analysis?.scores || []).map((item) => [normalizeName(item.name), Number(item.score) || 0]));
  const state = { hand: [...handCards], commanders: [...commandCards], sources: [], manaPool: [], sourceIndex: 0 };
  const turns = [];

  for (let turn = 1; turn <= turnCount; turn += 1) {
    state.manaPool = [];
    for (const source of state.sources) source.tapped = false;
    const drawnEntry = futureDraws[turn - 1];
    const drawnCard = drawnEntry ? cardFacts({ ...drawnEntry, copyIndex: drawnEntry.copyIndex ?? `draw-${turn}` }, cardMap, coreNames) : null;
    if (drawnCard) state.hand.push(drawnCard);
    const land = state.hand.filter((card) => card.land).sort((left, right) => landValue(right, deckColors, analysisScores) - landValue(left, deckColors, analysisScores) || left.name.localeCompare(right.name))[0] || null;
    if (land) {
      state.hand = state.hand.filter((card) => card.key !== land.key);
      if (land.manaSource) state.sources.push(sourceFor(land, turn, state.sourceIndex++));
    }
    const plays = [];
    while (true) {
      const candidates = [...state.hand, ...state.commanders]
        .filter(canRecommendCard)
        .map((card) => ({ card, payment: findPaymentPlan(card.manaCost, state.manaPool, state.sources, turn) }))
        .filter((candidate) => candidate.payment)
        .sort((left, right) => playValue(right.card, analysisScores, turn) - playValue(left.card, analysisScores, turn) || left.card.name.localeCompare(right.card.name));
      const chosen = candidates[0];
      if (!chosen) break;
      state.manaPool = chosen.payment.remainingPool;
      const tapped = new Set(chosen.payment.tappedIds);
      for (const source of state.sources) if (tapped.has(source.id)) source.tapped = true;
      if (chosen.card.zone === "command") state.commanders = state.commanders.filter((card) => card.key !== chosen.card.key);
      else state.hand = state.hand.filter((card) => card.key !== chosen.card.key);
      if (isManaPermanent(chosen.card)) state.sources.push(sourceFor(chosen.card, turn, state.sourceIndex++));
      plays.push(briefCard(chosen.card));
    }
    turns.push({
      turn,
      draw: drawnCard ? briefCard(drawnCard) : null,
      land: land ? briefCard(land) : null,
      plays,
      held: state.hand.filter(isPurelyReactive).slice(0, 3).map(briefCard),
    });
  }
  return {
    assumptions: "Assumes multiplayer Commander draws, no opponents, and one proactive line rather than alternative branches.",
    turns,
  };
}

function landScore(landCount) {
  return [-45, -28, 14, 22, 13, -8, -25, -40][landCount] ?? -40;
}

function castableRoles(plan, roleSet) {
  return plan.turns.flatMap((turn) => turn.plays).filter((card) => card.roles.some((role) => roleSet.has(role)));
}

function rescueStatus(summary, openingPlan) {
  const turnOne = openingPlan.turns[0]?.plays || [];
  const turnTwo = openingPlan.turns.slice(0, 2).flatMap((turn) => turn.plays);
  if (summary.landCount === 1) return turnOne.some((card) => card.roles.some((role) => ["ramp", "fastMana", "draw", "cardSelection"].includes(role)));
  if (summary.landCount === 6) return turnTwo.some((card) => card.roles.some((role) => ["draw", "cardSelection"].includes(role)));
  return false;
}

function applyLandPolicy(score, summary, openingPlan) {
  const penalty = ({ 0: 25, 1: 18, 6: 18, 7: 25 })[summary.landCount] || 0;
  const rescued = rescueStatus(summary, openingPlan);
  let adjusted = score - penalty;
  if ([0, 7].includes(summary.landCount)) adjusted = Math.min(adjusted, 44);
  if ([1, 6].includes(summary.landCount)) adjusted = Math.min(adjusted, rescued ? 61 : 44);
  return { score: Math.max(0, Math.min(100, Math.round(adjusted))), rescued };
}

function evaluateHand({ deck, hand, cardMap, coreCards = [], analysis = {} }) {
  const summary = summarizeHand(hand, cardMap, coreCards, analysis);
  const openingPlan = buildGoldfishPlan({ hand, cardMap, analysis, coreCards, turnCount: 3 });
  const handSize = Math.max(1, summary.cards.length);
  const densityScale = 7 / handSize;
  const castableCards = openingPlan.turns.flatMap((turn) => turn.plays).filter((card) => card.zone === "hand");
  const castableEarly = castableCards.filter((card) => card.cmc <= 3 || card.roles.some((role) => EARLY_ROLES.has(role))).length;
  const castableRamp = castableRoles(openingPlan, new Set(["ramp", "fastMana"])).length;
  const castableFlow = castableRoles(openingPlan, FLOW_ROLES).length;
  const castableEngine = castableRoles(openingPlan, new Set(["engine"])).length;
  let score = 45 + landScore(summary.landCount);
  score -= summary.nonManaLandCount * 12;
  if (summary.manaSourceCount === 0 && summary.landCount > 0) score -= 18;
  else if (summary.manaSourceCount === 1 && summary.landCount >= 2) score -= 10;
  score -= summary.earlyMissingColors.length * 10;
  score += Math.min(15, castableEarly * 6 * densityScale);
  if (castableEarly === 0) score -= 12;
  score += Math.min(10, castableRamp * (summary.manaSourceCount <= 2 ? 5 : 3) * densityScale);
  score += Math.min(8, castableFlow * 4 * densityScale);
  score += Math.min(8, castableEngine * 4 * densityScale);
  score += Math.min(4, summary.interactionCards.length * 2 * densityScale);
  if (summary.spells.length && summary.averageSpellCmc <= 3.5) score += 5;
  if (summary.averageSpellCmc > 4.5) score -= 8;
  score -= Math.max(0, 7 - handSize) * 4;
  const policy = applyLandPolicy(score, summary, openingPlan);
  score = policy.score;
  const verdict = score >= 78
    ? { label: "Strong keep", status: "good" }
    : score >= 62
      ? { label: "Keepable", status: "good" }
      : score >= 45
        ? { label: "Risky keep", status: "warn" }
        : { label: "Mulligan", status: "bad" };

  const strengths = [];
  const concerns = [];
  if (summary.manaSourceCount >= 2 && summary.manaSourceCount <= 4 && summary.earlyMissingColors.length === 0) {
    const coverage = summary.deckColors.length ? ` cover${summary.deckColors.length === 1 ? "s" : ""} ${summary.coveredColors.length}/${summary.deckColors.length} deck color${summary.deckColors.length === 1 ? "" : "s"}` : " support the deck's colorless mana needs";
    strengths.push(`${summary.manaSourceCount} mana-producing land${summary.manaSourceCount === 1 ? "" : "s"}${coverage}.`);
  }
  if (summary.colorlessSourceCount && summary.coveredColors.length === summary.deckColors.length && summary.deckColors.length) strengths.push(`${summary.colorlessSourceCount} land${summary.colorlessSourceCount === 1 ? "" : "s"} produces only colorless mana but the hand already covers every deck color.`);
  if (castableEarly >= 2) strengths.push(`${castableEarly} castable early play${castableEarly === 1 ? "" : "s"} advance the first three turns.`);
  if (castableFlow) strengths.push(`${castableFlow} castable draw or selection piece${castableFlow === 1 ? "" : "s"} can smooth later draws.`);
  if (castableRamp) strengths.push(`${castableRamp} castable acceleration piece${castableRamp === 1 ? "" : "s"} can move the game plan forward.`);
  if (castableEngine || summary.engineCards.some((card) => card.cmc <= 3)) strengths.push("The hand already touches a castable core or engine card.");
  if (summary.manaSourceCount < 2) concerns.push(`Only ${summary.manaSourceCount} mana-producing land source${summary.manaSourceCount === 1 ? "" : "s"}; the hand is unlikely to cast its plan reliably.`);
  if (summary.nonManaLandCount) concerns.push(`${summary.nonManaLandCount} land${summary.nonManaLandCount === 1 ? "" : "s"} cannot produce mana and ${summary.nonManaLandCount === 1 ? "does" : "do"} not help pay for spells.`);
  if (summary.earlyMissingColors.length) concerns.push(`This hand cannot currently produce ${summary.earlyMissingColors.map((color) => ({ W: "white", U: "blue", B: "black", R: "red", G: "green" })[color]).join(" or ")} mana needed by its early spells.`);
  if ([0, 7].includes(summary.landCount)) concerns.push(`${summary.landCount} lands is an extreme opening hand and should be mulliganed.`);
  if ([1, 6].includes(summary.landCount) && !policy.rescued) concerns.push(`${summary.landCount} lands has no immediately castable mana or card-flow rescue line.`);
  if (castableEarly === 0) concerns.push("No castable early play was detected from the cards already in this hand.");
  if (summary.flowCards.length === 0) concerns.push("No draw, tutor, or card selection can repair an awkward sequence.");
  if (summary.averageSpellCmc > 4.5) concerns.push(`The nonland cards average ${summary.averageSpellCmc.toFixed(1)} mana, making the hand slow.`);
  if (summary.engineCards.length === 0) concerns.push("The hand does not yet connect to a selected core card or visible engine.");
  return { score, verdict, summary: { ...summary, earlyCastable: castableEarly }, openingPlan, strengths, concerns, rescued: policy.rescued };
}

function isEarlyDevelopment(candidate) {
  return !candidate.land && (candidate.cmc <= 2 || candidate.roles.includes("fastMana") || (candidate.cmc <= 3 && candidate.roles.some((role) => EARLY_ROLES.has(role))));
}

function scoreGlueCandidates({ deck, hand, cardMap, analysis, coreCards, baseline }) {
  const scoreByName = new Map((analysis?.scores || []).map((item) => [normalizeName(item.name), item.score || 0]));
  const coreNames = new Set(coreCards.map(normalizeName));
  const candidates = [];
  const seen = new Set();
  for (const entry of remainingLibrary(deck, hand)) {
    const key = normalizeName(entry.name);
    if (seen.has(key)) continue;
    seen.add(key);
    const facts = cardFacts(entry, cardMap, coreNames);
    let best = null;
    for (let index = 0; index < hand.length; index += 1) {
      const nextHand = hand.map((held, heldIndex) => heldIndex === index ? entry : held);
      const result = evaluateHand({ deck, hand: nextHand, cardMap, coreCards, analysis });
      const improvement = result.score - baseline.score;
      if (!best || improvement > best.improvement) best = { improvement, replacement: hand[index], resultingScore: result.score };
    }
    if (!best) continue;
    candidates.push({ name: entry.name, card: facts.card, land: facts.land, manaSource: facts.manaSource, manaSymbols: facts.manaSymbols, cmc: facts.cmc, core: facts.core, roles: facts.roles, improvement: best.improvement, resultingScore: best.resultingScore, replaces: best.replacement.name, strategyScore: scoreByName.get(key) || 0 });
  }
  return candidates.sort((left, right) => right.improvement - left.improvement || right.strategyScore - left.strategyScore || left.name.localeCompare(right.name));
}

function glueNeedDefinitions(summary) {
  const actionLandCeiling = Math.ceil(summary.cards.length * 4 / 7);
  const neededColors = new Set(summary.earlyMissingColors);
  return [
    {
      key: "manaSources",
      label: "Mana Sources",
      priority: 100,
      active: summary.manaSourceCount < 2 || neededColors.size > 0,
      detail: neededColors.size ? `Add a mana source that can produce ${[...neededColors].join(" or ")} so the hand can cast its early spells.` : `Add ${2 - summary.manaSourceCount} more mana-producing land source${2 - summary.manaSourceCount === 1 ? "" : "s"} so the hand can reliably start casting spells.`,
      matches: (candidate) => neededColors.size ? candidate.manaSymbols.some((symbol) => neededColors.has(symbol)) : candidate.manaSource,
    },
    { key: "actionDensity", label: "Cheap Action", priority: 95, active: summary.landCount > actionLandCeiling, detail: "Turn excess mana sources into inexpensive cards that develop or smooth the opening turns.", matches: (candidate) => isEarlyDevelopment(candidate) },
    { key: "earlyDevelopment", label: "Early Development", priority: 85, active: summary.earlyCastable < 2, detail: "Add one- to three-mana setup that the known mana base can actually cast in the opening turns.", matches: (candidate) => isEarlyDevelopment(candidate) },
    { key: "cardFlow", label: "Card Flow", priority: 75, active: summary.flowCards.length === 0, detail: "Add draw, selection, or tutoring so the hand can find its next land or engine piece instead of relying on topdecks.", matches: (candidate) => candidate.roles.some((role) => FLOW_ROLES.has(role)) },
    { key: "acceleration", label: "Mana Acceleration", priority: 65, active: summary.rampCards.length === 0 && summary.manaSourceCount <= 3, detail: "Add cheap ramp or fast mana to reach the commander and core plays on schedule.", matches: (candidate) => candidate.roles.includes("ramp") || candidate.roles.includes("fastMana") },
    { key: "engineAccess", label: "Core Engine Access", priority: 55, active: summary.engineCards.length === 0, detail: "Add a core card or engine piece that makes this opening hand express the deck's actual game plan.", matches: (candidate) => candidate.core || candidate.roles.includes("engine") },
    { key: "interaction", label: "Early Interaction", priority: 40, active: summary.interactionCards.length === 0, detail: "Add a cheap answer so the hand can respond while developing its own plan.", matches: (candidate) => candidate.cmc <= 3 && (candidate.roles.includes("removal") || candidate.roles.includes("boardWipe")) },
  ];
}

function buildGlueNeeds({ deck, hand, cardMap, analysis, coreCards, baseline }) {
  const candidates = scoreGlueCandidates({ deck, hand, cardMap, analysis, coreCards, baseline });
  const rankedNeeds = glueNeedDefinitions(baseline.summary)
    .filter((need) => need.active)
    .map((need) => ({ ...need, candidates: candidates.filter((candidate) => candidate.improvement > 0 && need.matches(candidate)) }))
    .filter((need) => need.candidates.length > 0)
    .sort((left, right) => right.priority - left.priority || right.candidates[0].improvement - left.candidates[0].improvement);
  const usedExamples = new Set();
  const needs = [];
  for (const need of rankedNeeds) {
    const examples = need.candidates.filter((candidate) => !usedExamples.has(normalizeName(candidate.name))).slice(0, 3);
    if (!examples.length) continue;
    for (const example of examples) usedExamples.add(normalizeName(example.name));
    needs.push({ key: need.key, label: need.label, detail: need.detail, improvement: examples[0].improvement, examples });
    if (needs.length === 3) break;
  }
  return needs;
}

function reconcileVerdict(baseline, glueNeeds) {
  const majorNeeds = glueNeeds.filter((need) => ["manaSources", "actionDensity", "earlyDevelopment"].includes(need.key));
  if (baseline.verdict.label === "Strong keep" && majorNeeds.length >= 2) return { label: "Keepable", status: "good" };
  return baseline.verdict;
}

export function analyzeOpeningHand({ deck, hand, cardMap = {}, analysis = {}, coreCards = [], futureDraws = [] }) {
  const baseline = evaluateHand({ deck, hand, cardMap, coreCards, analysis });
  const glueNeeds = buildGlueNeeds({ deck, hand, cardMap, analysis, coreCards, baseline });
  const verdict = reconcileVerdict(baseline, glueNeeds);
  const concerns = [...baseline.concerns];
  if (verdict.label !== baseline.verdict.label) concerns.push("This hand has several major repairs available, so it is better treated as keepable rather than a strong keep.");
  const goldfish = buildGoldfishPlan({ hand, futureDraws, cardMap, analysis, coreCards, commanders: deck.commanders || [], turnCount: 3 });
  return {
    score: baseline.score,
    verdict,
    strengths: baseline.strengths,
    concerns,
    metrics: {
      lands: baseline.summary.landCount,
      handSize: baseline.summary.cards.length,
      manaSources: baseline.summary.manaSourceCount,
      coloredSources: baseline.summary.coloredSourceCount,
      colorlessSources: baseline.summary.colorlessSourceCount,
      nonManaLands: baseline.summary.nonManaLandCount,
      deckColors: baseline.summary.deckColors,
      coveredColors: baseline.summary.coveredColors,
      missingColors: baseline.summary.missingColors,
      earlyPlays: baseline.summary.earlyCastable,
      ramp: baseline.summary.rampCards.length,
      cardFlow: baseline.summary.flowCards.length,
      interaction: baseline.summary.interactionCards.length,
      engineAccess: baseline.summary.engineCards.length,
      averageSpellCmc: Math.round(baseline.summary.averageSpellCmc * 10) / 10,
      rescued: baseline.rescued,
    },
    cards: baseline.summary.cards,
    glueNeeds,
    goldfish,
    glueSummary: glueNeeds.length ? `${glueNeeds.map((need) => need.label).join(", ")} are the most useful missing categories for this ${baseline.summary.cards.length}-card hand.` : "This hand is already cohesive enough that no missing category creates a meaningful measured improvement.",
  };
}
