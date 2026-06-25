import {
  COLOR_LABEL,
  SPLASH_THRESHOLD,
  TARGET_AVG_CMC,
  TARGET_LANDS_MAX,
  TARGET_LANDS_MIN,
  TARGET_RAMP_CRIT,
  TARGET_RAMP_MIN,
  TARGET_REMOVAL_CRIT,
  TARGET_REMOVAL_MIN,
  TARGET_WIPES_CRIT,
  TARGET_WIPES_MIN,
  clampScore,
  findCard,
  getCardText,
  getManaColorBucket,
  getManaCost,
  getRoleKeys,
  getRoles,
  getSharedSignals,
  getTypeLine,
  isLandCard,
  normalizeName,
  parsePips,
  MANA_CURVE_COLOR_ORDER,
  SIGNALS,
} from "./cardUtils.mjs";
import { analyzeBracket, isGameChangerName } from "./commanderBrackets.mjs";

export const DEFAULT_ANALYSIS_SETTINGS = {
  landsMin: TARGET_LANDS_MIN,
  landsMax: TARGET_LANDS_MAX,
  rampTarget: TARGET_RAMP_MIN,
  drawTarget: 8,
  removalTarget: TARGET_REMOVAL_MIN,
  wipesTarget: TARGET_WIPES_MIN,
  resilienceTarget: 5,
  avgManaValueTarget: TARGET_AVG_CMC,
  expectedWinTurnTarget: 8,
  tutorSensitivity: 3,
  fastManaSensitivity: 2,
  gameChangerSensitivity: 1,
  synergySensitivity: 6,
};

export function resolveAnalysisSettings(settings = {}) {
  return { ...DEFAULT_ANALYSIS_SETTINGS, ...(settings || {}) };
}

function getCommanderCards(deck, cardMap) {
  return deck.commanders.map((entry) => findCard(cardMap, entry.name)).filter(Boolean);
}

function getCoreEntries(deck, coreCards = []) {
  const coreSet = new Set((coreCards || []).map(normalizeName));
  return deck.main.filter((entry) => coreSet.has(normalizeName(entry.name)));
}

function getCoreCards(deck, cardMap, coreCards = []) {
  return getCoreEntries(deck, coreCards).map((entry) => findCard(cardMap, entry.name)).filter(Boolean);
}

function isCoreName(name, coreCards = []) {
  const coreSet = new Set((coreCards || []).map(normalizeName));
  return coreSet.has(normalizeName(name));
}

function getNonLandEntries(deck, cardMap) {
  return deck.main.filter((entry) => !isLandCard(entry.name, findCard(cardMap, entry.name)));
}

function getLandEntries(deck, cardMap) {
  return deck.main.filter((entry) => isLandCard(entry.name, findCard(cardMap, entry.name)));
}

function getManaValueEntries(deck, cardMap) {
  return [...deck.commanders, ...deck.main].filter((entry) => !isLandCard(entry.name, findCard(cardMap, entry.name)));
}

function countRole(entries, cardMap, role) {
  return entries.reduce((sum, entry) => {
    const card = findCard(cardMap, entry.name);
    return sum + (getRoles(card)[role] ? entry.qty : 0);
  }, 0);
}

function buildColorPips(entries, cardMap) {
  const pips = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  for (const entry of entries) {
    const card = findCard(cardMap, entry.name);
    const cardPips = parsePips(getManaCost(card));
    for (const key of Object.keys(pips)) pips[key] += cardPips[key] * entry.qty;
  }
  return pips;
}

function buildSplashNote(colorPips) {
  const colored = ["W", "U", "B", "R", "G"]
    .map((key) => ({ key, count: colorPips[key] || 0 }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count);
  const total = colored.reduce((sum, item) => sum + item.count, 0);

  if (!total) return "No colored pips detected from the available card data.";
  if (colored.length === 1) return `Focused ${COLOR_LABEL[colored[0].key]} requirements with no splash pressure in visible mana costs.`;

  const smallest = colored[colored.length - 1];
  const share = smallest.count / total;
  if (share < SPLASH_THRESHOLD) {
    return `${COLOR_LABEL[smallest.key]} is a light splash at ${Math.round(share * 100)}% of colored pips.`;
  }
  return "Colored requirements are reasonably distributed from the visible mana costs.";
}

function scoreEntry(entry, cardMap, identityCards, stats, options = {}) {
  const { coreCards = [], settings = DEFAULT_ANALYSIS_SETTINGS } = options;
  const card = findCard(cardMap, entry.name);
  const roles = getRoles(card);
  const roleKeys = getRoleKeys(card);
  const type = getTypeLine(card);
  const cmc = card?.cmc ?? 0;
  const commanderCmcs = identityCards.map((identityCard) => identityCard.cmc).filter((cmcValue) => cmcValue !== undefined);
  const sharedSignals = getSharedSignals(card, identityCards);
  const core = isCoreName(entry.name, coreCards);
  const reasons = [];
  let score = 0;

  if (roles.ramp) {
    score += stats.rampCount < settings.rampTarget ? 3 : 2;
    reasons.push("ramp");
  }
  if (roles.draw || roles.tutor) {
    score += 2;
    reasons.push(roles.tutor ? "selection" : "card flow");
  }
  if (roles.cardSelection) {
    score += 1;
    reasons.push("selection");
  }
  if (roles.removal) {
    score += stats.removalCount < settings.removalTarget ? 3 : 2;
    reasons.push("interaction");
  }
  if (roles.boardWipe) {
    score += stats.boardWipeCount < settings.wipesTarget ? 3 : 2;
    reasons.push("reset button");
  }
  if (roles.protection) {
    score += 1;
    reasons.push("protection");
  }
  if (roles.recursion) {
    score += 1;
    reasons.push("recursion");
  }
  if (roles.engine) {
    score += 1;
    reasons.push("engine");
  }
  if (roles.payoff) {
    score += 1;
    reasons.push("payoff");
  }
  if (roles.tokenMaker || roles.costReducer || roles.manaFixing) {
    score += 1;
    reasons.push("support");
  }
  if (roles.stax || roles.graveyardHate) {
    score += 1;
    reasons.push("metagame tool");
  }
  if (roles.finisher) {
    score += 2;
    reasons.push("finisher");
  }
  if (sharedSignals.length) {
    score += Math.min(4, sharedSignals.length + 1);
    reasons.push("identity overlap");
  }
  if (core) {
    score += 2;
    roleKeys.push("core");
    reasons.push("core identity");
  }
  if (isGameChangerName(entry.name)) {
    score += 2;
    roleKeys.push("gameChanger");
    reasons.push("high-impact bracket card");
  }
  if (cmc <= 2 && (roles.ramp || roles.removal || roles.draw || roles.protection)) {
    score += 1;
    reasons.push("efficient");
  }
  if (type.includes("instant") && roles.removal) {
    score += 1;
    reasons.push("instant-speed");
  }
  if (commanderCmcs.includes(cmc)) {
    score -= 2;
    reasons.push("competes with commander turn");
  }
  if (cmc >= 5 && !roles.ramp && !roles.draw && !roles.removal && !roles.boardWipe && sharedSignals.length === 0) {
    score -= 2;
    reasons.push("expensive low-synergy slot");
  }
  if (!card) {
    score -= 1;
    reasons.push("card data missing");
  }

  const finalScore = clampScore(score);
  return {
    name: entry.name,
    score: finalScore,
    roles: [...new Set(roleKeys)],
    note: reasons.slice(0, 4).join(", "),
    protected: core,
  };
}

function buildSynergyClusters(nonLandEntries, cardMap) {
  const clusters = [];
  for (const signal of SIGNALS) {
    const cards = nonLandEntries
      .filter((entry) => signal.test(findCard(cardMap, entry.name)))
      .map((entry) => entry.name)
      .slice(0, 7);
    if (cards.length >= 2) clusters.push({ name: signal.name, cards, desc: signal.desc });
  }

  if (!clusters.length) {
    const roleCards = nonLandEntries
      .filter((entry) => {
        const roles = getRoles(findCard(cardMap, entry.name));
        return roles.ramp || roles.draw || roles.removal;
      })
      .map((entry) => entry.name)
      .slice(0, 7);
    if (roleCards.length) {
      clusters.push({
        name: "Role Coverage",
        cards: roleCards,
        desc: "These cards cover basic ramp, card flow, and interaction needs.",
      });
    }
  }
  return clusters.slice(0, 5);
}

function buildConsistencyFlags(stats, deck, settings) {
  const deckSizeOk = stats.cardCount === deck.expectedMainCount;
  return [
    { ok: deckSizeOk, text: `${stats.cardCount}/${deck.expectedMainCount} main-deck cards after command-zone cards.` },
    { ok: stats.landCount >= settings.landsMin && stats.landCount <= settings.landsMax, text: `${stats.landCount} lands measured against your ${settings.landsMin}-${settings.landsMax} target.` },
    { ok: stats.rampCount >= Math.max(0, settings.rampTarget - 2), text: `${stats.rampCount} ramp pieces found; current target is ${settings.rampTarget}.` },
    { ok: stats.avgCmc <= settings.avgManaValueTarget, text: `Average mana value is ${stats.avgCmc}; current target is ${settings.avgManaValueTarget}.` },
    { ok: stats.boardWipeCount >= Math.max(0, settings.wipesTarget - 1), text: `${stats.boardWipeCount} board wipes found; current target is ${settings.wipesTarget}.` },
    { ok: stats.removalCount >= Math.max(0, settings.removalTarget - 2), text: `${stats.removalCount} targeted interaction pieces found; current target is ${settings.removalTarget}.` },
  ];
}

function buildWeaknesses(stats, settings) {
  const weaknesses = [];
  if (stats.cardCount !== stats.expectedMainCount) weaknesses.push({ severity: "warning", label: "Deck size mismatch", desc: "Card count does not match the expected Commander deck size after command-zone cards." });
  if (stats.landCount < settings.landsMin) weaknesses.push({ severity: "critical", label: "Low land count", desc: "The deck may miss land drops before its engine comes online." });
  if (stats.landCount > settings.landsMax) weaknesses.push({ severity: "warning", label: "High land count", desc: "The deck may flood unless the commander or land package converts lands into value." });
  if (stats.rampCount < Math.max(0, settings.rampTarget - 2)) weaknesses.push({ severity: "critical", label: "Needs more ramp", desc: "Ramp count is below your current target." });
  if (stats.avgCmc > settings.avgManaValueTarget) weaknesses.push({ severity: "warning", label: "Heavy curve", desc: "Early turns may be slower than the table." });
  if (stats.removalCount < Math.max(0, settings.removalTarget - 2)) weaknesses.push({ severity: "warning", label: "Thin interaction", desc: "The deck may struggle to answer must-kill engines or combo pieces on time." });
  if (stats.boardWipeCount < Math.max(0, settings.wipesTarget - 1)) weaknesses.push({ severity: "minor", label: "Few reset buttons", desc: "The deck has limited ways to catch up when opponents build a wider board." });
  if (!weaknesses.length) weaknesses.push({ severity: "minor", label: "No major structural gap", desc: "Core land, ramp, curve, wipe, and interaction counts are within normal Commander ranges." });
  return weaknesses;
}

function roleExamples(entries, cardMap, role, limit = 5) {
  return entries
    .filter((entry) => {
      if (role === "gameChanger") return isGameChangerName(entry.name);
      return getRoles(findCard(cardMap, entry.name))[role];
    })
    .map((entry) => entry.name)
    .slice(0, limit);
}

function roleStatus(count, warnAt, goodAt) {
  if (count >= goodAt) return "good";
  if (count >= warnAt) return "warn";
  return "bad";
}

function buildRoleBalance(nonLandEntries, cardMap, settings) {
  const roleCount = (role) => nonLandEntries.reduce((sum, entry) => {
    if (role === "gameChanger") return sum + (isGameChangerName(entry.name) ? entry.qty : 0);
    return sum + (getRoles(findCard(cardMap, entry.name))[role] ? entry.qty : 0);
  }, 0);

  const specs = [
    { key: "ramp", label: "Mana Development", target: String(settings.rampTarget), warnAt: Math.max(0, settings.rampTarget - 2), goodAt: settings.rampTarget, detail: "Gets the deck to its commander and midgame engines on time." },
    { key: "draw", label: "Card Flow", target: String(settings.drawTarget), warnAt: Math.max(0, settings.drawTarget - 3), goodAt: settings.drawTarget, detail: "Keeps hands full after committing threats and interaction." },
    { key: "removal", label: "Spot Interaction", target: String(settings.removalTarget), warnAt: Math.max(0, settings.removalTarget - 2), goodAt: settings.removalTarget, detail: "Answers engines, commanders, and combo pieces before they snowball." },
    { key: "boardWipe", label: "Reset Buttons", target: String(settings.wipesTarget), warnAt: Math.max(0, settings.wipesTarget - 1), goodAt: settings.wipesTarget, detail: "Lets the deck recover when opponents get wider or faster." },
    { key: "protection", label: "Protection", target: "2-4", warnAt: 1, goodAt: 3, detail: "Protects the commander, core engines, or a winning board state." },
    { key: "recursion", label: "Recursion", target: "2-4", warnAt: 1, goodAt: 3, detail: "Rebuilds after removal and makes trades less punishing." },
    { key: "engine", label: "Engines", target: "4+", warnAt: 2, goodAt: 4, detail: "Repeatable value sources that define the deck's long-game plan." },
    { key: "payoff", label: "Payoffs", target: "3+", warnAt: 1, goodAt: 3, detail: "Cards that convert the deck's setup into pressure or advantage." },
    { key: "finisher", label: "Finishers", target: "2-4", warnAt: 1, goodAt: 2, detail: "Cards that can actually close games once the deck is ahead." },
  ];

  return specs.map((spec) => {
    const count = roleCount(spec.key);
    return {
      ...spec,
      count,
      status: roleStatus(count, spec.warnAt, spec.goodAt),
      examples: roleExamples(nonLandEntries, cardMap, spec.key),
    };
  });
}

function typeCategory(card) {
  const type = getTypeLine(card);
  if (type.includes("land")) return "Land";
  if (type.includes("creature")) return "Creature";
  if (type.includes("instant")) return "Instant";
  if (type.includes("sorcery")) return "Sorcery";
  if (type.includes("artifact")) return "Artifact";
  if (type.includes("enchantment")) return "Enchantment";
  if (type.includes("planeswalker")) return "Planeswalker";
  if (type.includes("battle")) return "Battle";
  return "Other";
}

function buildTypeMix(deck, cardMap) {
  const counts = {};
  for (const entry of deck.main) {
    const category = typeCategory(findCard(cardMap, entry.name));
    counts[category] = (counts[category] || 0) + entry.qty;
  }
  const total = deck.cardCount || 1;
  return Object.entries(counts)
    .map(([type, count]) => ({ type, count, pct: Math.round((count / total) * 100) }))
    .sort((a, b) => b.count - a.count);
}

function curveBandFor(cmc) {
  if (cmc <= 1) return "0-1";
  if (cmc === 2) return "2";
  if (cmc === 3) return "3";
  if (cmc === 4) return "4";
  return "5+";
}

function buildCurveBands(nonLandEntries, cardMap) {
  const labels = {
    "0-1": "Setup",
    2: "Early",
    3: "Bridge",
    4: "Commander Turn",
    "5+": "Top End",
  };
  const counts = { "0-1": 0, 2: 0, 3: 0, 4: 0, "5+": 0 };

  for (const entry of nonLandEntries) {
    const cmc = Math.floor(findCard(cardMap, entry.name)?.cmc ?? 0);
    counts[curveBandFor(cmc)] += entry.qty;
  }

  return Object.entries(counts).map(([key, count]) => ({
    key,
    label: labels[key],
    count,
    detail: key === "5+" ? "Expensive spells that need ramp or high impact." : "Cards available before or near the commander turn.",
  }));
}

function buildManaCurve(manaValueEntries, cardMap) {
  const buckets = {};
  for (const entry of manaValueEntries) {
    const card = findCard(cardMap, entry.name);
    const cmc = Math.floor(card?.cmc ?? 0);
    const color = getManaColorBucket(card);
    const key = String(cmc);
    if (!buckets[key]) {
      buckets[key] = { cmc: key, total: 0 };
      for (const colorKey of MANA_CURVE_COLOR_ORDER) buckets[key][colorKey] = 0;
    }
    buckets[key][color] += entry.qty;
    buckets[key].total += entry.qty;
  }

  const maxCmc = Math.max(0, ...Object.keys(buckets).map((key) => Number(key)));
  for (let cmc = 0; cmc <= maxCmc; cmc++) {
    const key = String(cmc);
    if (!buckets[key]) {
      buckets[key] = { cmc: key, total: 0 };
      for (const colorKey of MANA_CURVE_COLOR_ORDER) buckets[key][colorKey] = 0;
    }
  }
  return Object.values(buckets).sort((a, b) => Number(a.cmc) - Number(b.cmc));
}

function buildInteractionProfile(nonLandEntries, cardMap) {
  let instantSpeed = 0;
  let sorcerySpeed = 0;
  let permanentBased = 0;
  let stackInteraction = 0;
  const examples = [];

  for (const entry of nonLandEntries) {
    const card = findCard(cardMap, entry.name);
    const roles = getRoles(card);
    if (!roles.removal && !roles.boardWipe) continue;

    const type = getTypeLine(card);
    const text = getCardText(card);
    if (type.includes("instant") || /flash/.test(text)) instantSpeed += entry.qty;
    else if (type.includes("creature") || type.includes("artifact") || type.includes("enchantment") || type.includes("planeswalker")) permanentBased += entry.qty;
    else sorcerySpeed += entry.qty;
    if (/counter target/.test(text)) stackInteraction += entry.qty;
    if (examples.length < 5) examples.push(entry.name);
  }

  const total = instantSpeed + sorcerySpeed + permanentBased;
  return {
    total,
    instantSpeed,
    sorcerySpeed,
    permanentBased,
    stackInteraction,
    examples,
    status: total >= 5 && instantSpeed >= 2 ? "good" : total >= 3 ? "warn" : "bad",
    note: total >= 5
      ? "The deck has a usable interaction suite; check whether enough of it works at instant speed."
      : "The deck may not have enough answers to stop opposing engines or combos.",
  };
}

function buildResilienceProfile(nonLandEntries, cardMap, stats, settings) {
  const protection = countRole(nonLandEntries, cardMap, "protection");
  const recursion = countRole(nonLandEntries, cardMap, "recursion");
  const total = protection + recursion + stats.boardWipeCount;

  return {
    protection,
    recursion,
    boardWipes: stats.boardWipeCount,
    total,
    status: total >= settings.resilienceTarget ? "good" : total >= Math.max(1, settings.resilienceTarget - 2) ? "warn" : "bad",
    note: total >= settings.resilienceTarget
      ? "The deck has several ways to protect, rebuild, or reset."
      : "The deck may struggle to recover after removal-heavy games.",
  };
}

function buildCardFlowProfile(nonLandEntries, cardMap, settings) {
  const draw = countRole(nonLandEntries, cardMap, "draw");
  const tutors = countRole(nonLandEntries, cardMap, "tutor");
  const engines = countRole(nonLandEntries, cardMap, "engine");
  const selection = countRole(nonLandEntries, cardMap, "cardSelection");
  const total = draw + tutors + selection + Math.min(engines, 6);

  return {
    draw,
    tutors,
    selection,
    engines,
    total,
    status: total >= settings.drawTarget ? "good" : total >= Math.max(1, settings.drawTarget - 3) ? "warn" : "bad",
    note: total >= settings.drawTarget
      ? "The deck should see enough cards to find its engines and answers."
      : "The deck may run out of material if the first wave is answered.",
  };
}

function buildWinPlan(nonLandEntries, cardMap, synergyClusters) {
  const finishers = roleExamples(nonLandEntries, cardMap, "finisher", 6);
  const engines = roleExamples(nonLandEntries, cardMap, "engine", 6);
  const payoffs = roleExamples(nonLandEntries, cardMap, "payoff", 6);
  const primaryCluster = synergyClusters[0]?.name || "Role Coverage";
  const status = finishers.length >= 2 && (engines.length >= 3 || payoffs.length >= 3)
    ? "good"
    : finishers.length || payoffs.length
      ? "warn"
      : "bad";

  return {
    primary: primaryCluster,
    finishers,
    engines,
    payoffs,
    status,
    note: status === "good"
      ? "The deck has visible setup pieces and ways to convert them into a win."
      : status === "warn"
        ? "The deck has some payoff pressure, but the closing plan may need more redundancy."
        : "The local pass does not see enough cards that clearly close the game.",
  };
}

function buildPriorityFindings(stats, roleBalance, interactionProfile, resilienceProfile, cardFlowProfile, winPlan, bracket, scorecard = []) {
  const findings = [];
  const role = (key) => roleBalance.find((item) => item.key === key);

  if (stats.cardCount !== stats.expectedMainCount) {
    findings.push({ severity: "warning", label: "Deck size mismatch", detail: `${stats.cardCount}/${stats.expectedMainCount} main-deck cards detected.`, action: "Fix card count before trusting power or consistency results." });
  }
  if (role("ramp")?.status === "bad") {
    findings.push({ severity: "critical", label: "Ramp floor is low", detail: `${stats.rampCount} ramp pieces found.`, action: "Add cheap ramp before adding more top-end threats." });
  }
  if (cardFlowProfile.status === "bad") {
    findings.push({ severity: "warning", label: "Card flow is thin", detail: `${cardFlowProfile.draw} draw, ${cardFlowProfile.tutors} tutors, ${cardFlowProfile.engines} engines detected.`, action: "Add repeatable draw or selection that fits the commander plan." });
  }
  if (interactionProfile.status === "bad") {
    findings.push({ severity: "warning", label: "Interaction suite is light", detail: `${interactionProfile.total} answer cards detected.`, action: "Add flexible instant-speed removal or stack interaction." });
  }
  if (resilienceProfile.status === "bad") {
    findings.push({ severity: "minor", label: "Low recovery density", detail: `${resilienceProfile.total} protection, recursion, or reset effects detected.`, action: "Add protection or recursion if the deck depends on a few engines." });
  }
  if (winPlan.status === "bad") {
    findings.push({ severity: "warning", label: "Closing plan is unclear", detail: "Few finishers or payoff cards were identified.", action: "Add redundant payoffs or finishers tied to the deck's primary engine." });
  }
  if (bracket.bracket >= 4) {
    findings.push({ severity: "notice", label: "Pregame power disclosure", detail: `${bracket.rangeLabel} with ${bracket.gameChangers.length} Game Changer match(es).`, action: "Mention bracket drivers before the game starts." });
  }
  const coreSynergy = scorecard.find((item) => item.key === "synergy");
  if (coreSynergy?.status === "bad") {
    findings.push({ severity: "warning", label: "Core support is thin", detail: coreSynergy.summary, action: "Add cards that overlap with commander or core-card themes before cutting identity pieces." });
  }
  if (!findings.length) {
    findings.push({ severity: "notice", label: "No urgent structural issue", detail: "Core counts and visible game-plan pieces are coherent.", action: "Tune from actual games and matchup needs." });
  }
  return findings.slice(0, 6);
}

function analyzeCandidateCards(entries, cardMap, identityCards, stats, scores, options) {
  const lowest = [...scores].sort((a, b) => a.score - b.score)[0];
  return entries.map((entry) => {
    const scored = scoreEntry(entry, cardMap, identityCards, stats, options);
    const card = findCard(cardMap, entry.name);
    const roles = getRoles(card);
    let recommendation = "maybe";
    const settings = options.settings;
    if ((roles.ramp && stats.rampCount < settings.rampTarget) || (roles.removal && stats.removalCount < settings.removalTarget) || (roles.boardWipe && stats.boardWipeCount < settings.wipesTarget) || scored.score >= 4) {
      recommendation = "add";
    } else if (scored.score <= 0) {
      recommendation = "skip";
    }
    const cutText = lowest ? ` Test over ${lowest.name}.` : "";
    return {
      name: entry.name,
      recommendation,
      reason: recommendation === "add"
        ? `Fills a measured need or overlaps with the commander plan.${cutText}`
        : recommendation === "skip"
          ? "Does not clearly solve a measured weakness from the available card data."
          : `Plausible, but not mandatory from the local pass.${cutText}`,
    };
  });
}

function buildUpgrades(stats, scores, sideboardAnalysis, consideringAnalysis, settings) {
  const cuts = [...scores].filter((score) => !score.protected).sort((a, b) => a.score - b.score).slice(0, 5);
  const adds = [...sideboardAnalysis, ...consideringAnalysis].filter((item) => item.recommendation !== "skip");

  if (adds.length) {
    return adds.slice(0, 5).map((add, index) => {
      const cut = cuts[index] || cuts[0] || { name: "Lowest-impact slot", score: 0 };
      return {
        cut: cut.name,
        cutScore: cut.score,
        add: add.name,
        reason: add.reason,
        expensive: false,
      };
    });
  }

  const suggestedAdd = stats.rampCount < Math.max(0, settings.rampTarget - 2)
    ? "Additional two-mana ramp"
    : stats.removalCount < Math.max(0, settings.removalTarget - 2)
      ? "Flexible targeted removal"
      : stats.boardWipeCount < Math.max(0, settings.wipesTarget - 1)
        ? "Additional board wipe"
        : "High-synergy commander/core support piece";

  return cuts.slice(0, 4).map((cut) => ({
    cut: cut.name,
    cutScore: cut.score,
    add: suggestedAdd,
    reason: "Use this slot to shore up the clearest measured gap.",
    expensive: false,
  }));
}

export function buildAnalysisPrompt(deck, cardMap) {
  const cardInfo = (name) => {
    const card = findCard(cardMap, name);
    if (!card) return `${name}: [data not found]`;
    const cost = getManaCost(card) || "none";
    const text = getCardText(card).replace(/\n/g, " ").slice(0, 180);
    return `${name}: CMC=${card.cmc} MC=${cost} Type="${card.type_line}" Text="${text}"`;
  };

  const nonLand = getNonLandEntries(deck, cardMap);
  const lands = getLandEntries(deck, cardMap);
  const landCount = lands.reduce((sum, entry) => sum + entry.qty, 0);

  return `You are an expert MTG Commander analyst. Use only the supplied card data.

COMMANDERS:
${deck.commanders.map((entry) => cardInfo(entry.name)).join("\n")}

COMPANION:
${deck.companions.map((entry) => cardInfo(entry.name)).join("\n") || "None"}

MAIN DECK non-land cards:
${nonLand.map((entry) => cardInfo(entry.name)).join("\n")}

LANDS: ${landCount} total (${lands.map((entry) => `${entry.qty}x ${entry.name}`).join(", ")})

SIDEBOARD:
${deck.sideboard.map((entry) => cardInfo(entry.name)).join("\n")}

CONSIDERING:
${deck.considering.map((entry) => cardInfo(entry.name)).join("\n")}

Return only JSON matching this shape:
{
  "strategy": "2-3 sentence game plan",
  "stats": { "landCount": 0, "rampCount": 0, "avgCmc": 0, "boardWipeCount": 0, "removalCount": 0 },
  "colorPips": { "W": 0, "U": 0, "B": 0, "R": 0, "G": 0, "C": 0 },
  "splashNote": "text",
  "consistencyFlags": [ { "ok": true, "text": "text" } ],
  "synergyClusters": [ { "name": "name", "cards": ["card"], "desc": "text" } ],
  "weaknesses": [ { "severity": "critical|warning|minor", "label": "label", "desc": "text" } ],
  "scores": [ { "name": "card name", "score": 0, "note": "text" } ],
  "sideboardAnalysis": [ { "name": "card name", "recommendation": "add|maybe|skip", "reason": "text" } ],
  "consideringAnalysis": [ { "name": "card name", "recommendation": "add|maybe|skip", "reason": "text" } ],
  "upgrades": [ { "cut": "name", "cutScore": 0, "add": "name", "reason": "text", "expensive": false } ]
}`;
}

export function extractJSON(text) {
  const stripped = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    return JSON.parse(stripped);
  } catch {
    const start = stripped.indexOf("{");
    const end = stripped.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(stripped.slice(start, end + 1));
    throw new Error("Could not parse analysis response.");
  }
}

function pctScore(value, target) {
  if (target <= 0) return 100;
  return Math.max(0, Math.min(100, Math.round((value / target) * 100)));
}

function rangeScore(value, min, max) {
  if (value >= min && value <= max) return 100;
  if (value < min) return pctScore(value, min);
  const over = value - max;
  return Math.max(35, 100 - (over * 12));
}

function gradeFor(score) {
  if (score >= 85) return "Excellent";
  if (score >= 70) return "Good";
  if (score >= 50) return "Needs Work";
  return "Critical";
}

function statusForScore(score) {
  if (score >= 70) return "good";
  if (score >= 50) return "warn";
  return "bad";
}

function makeScorecardItem(key, label, score, summary, evidence, adjustments, highlightCards = []) {
  const roundedScore = Math.max(0, Math.min(100, Math.round(score)));
  return {
    key,
    label,
    score: roundedScore,
    grade: gradeFor(roundedScore),
    status: statusForScore(roundedScore),
    summary,
    evidence: evidence.filter(Boolean),
    adjustments: adjustments.filter(Boolean),
    highlightCards: [...new Set(highlightCards)].slice(0, 8),
  };
}

function cardsWithRole(entries, cardMap, role, limit = 8) {
  return entries
    .filter((entry) => getRoles(findCard(cardMap, entry.name))[role])
    .map((entry) => entry.name)
    .slice(0, limit);
}

function countIdentitySupport(nonLandEntries, cardMap, identityCards, coreCards) {
  const coreSet = new Set((coreCards || []).map(normalizeName));
  let directSupport = 0;
  const supportCards = [];
  const weakCoreCards = [];

  for (const entry of nonLandEntries) {
    const card = findCard(cardMap, entry.name);
    const sharedSignals = getSharedSignals(card, identityCards);
    if (sharedSignals.length && !coreSet.has(normalizeName(entry.name))) {
      directSupport += entry.qty;
      if (supportCards.length < 8) supportCards.push(entry.name);
    }
    if (coreSet.has(normalizeName(entry.name)) && !sharedSignals.length) weakCoreCards.push(entry.name);
  }

  return { directSupport, supportCards, weakCoreCards };
}

function buildScorecard({ deck, cardMap, nonLandEntries, stats, structure, bracket, settings, coreCards, identityCards }) {
  const role = (key) => structure.roleBalance.find((item) => item.key === key);
  const flow = structure.cardFlowProfile;
  const interaction = structure.interactionProfile;
  const resilience = structure.resilienceProfile;
  const winPlan = structure.winPlan;
  const identitySupport = countIdentitySupport(nonLandEntries, cardMap, identityCards, coreCards);
  const synergyScore = Math.min(100, Math.round(((identitySupport.directSupport + coreCards.length) / Math.max(1, settings.synergySensitivity)) * 100));
  const curveScore = stats.avgCmc <= settings.avgManaValueTarget
    ? 100
    : Math.max(35, 100 - Math.round((stats.avgCmc - settings.avgManaValueTarget) * 28));
  const powerPressure = Math.max(
    bracket.expectedWinTurn <= settings.expectedWinTurnTarget ? 15 : 0,
    Math.max(0, bracket.gameChangers.length - settings.gameChangerSensitivity + 1) * 14,
    Math.max(0, bracket.speedSignals.filter((signal) => signal.type === "fast mana").length - settings.fastManaSensitivity + 1) * 12,
  );
  const powerScore = Math.max(25, 100 - powerPressure);

  return [
    makeScorecardItem(
      "mana",
      "Mana Base",
      rangeScore(stats.landCount, settings.landsMin, settings.landsMax),
      `${stats.landCount} lands against a ${settings.landsMin}-${settings.landsMax} target.`,
      [buildSplashNote(buildColorPips([...deck.commanders, ...nonLandEntries], cardMap)), `${stats.cardCount}/${deck.expectedMainCount} main-deck cards.`],
      stats.landCount < settings.landsMin ? ["Add lands or MDFC/utility lands before adding more top end."] : stats.landCount > settings.landsMax ? ["Trim lands only if ramp and card flow can absorb the loss."] : ["Mana quantity is within the selected target."],
      deck.main.filter((entry) => isLandCard(entry.name, findCard(cardMap, entry.name))).map((entry) => entry.name),
    ),
    makeScorecardItem(
      "ramp",
      "Ramp",
      pctScore(stats.rampCount, settings.rampTarget),
      `${stats.rampCount} ramp pieces against a target of ${settings.rampTarget}.`,
      [`Role status: ${role("ramp")?.status || "unknown"}.`, `Average MV: ${stats.avgCmc}.`],
      stats.rampCount < settings.rampTarget ? ["Prioritize cheap ramp that helps cast commander/core cards earlier."] : ["Ramp density meets the selected target."],
      cardsWithRole(nonLandEntries, cardMap, "ramp"),
    ),
    makeScorecardItem(
      "flow",
      "Card Flow",
      pctScore(flow.total, settings.drawTarget),
      `${flow.total} draw/tutor/selection/engine signals against a target of ${settings.drawTarget}.`,
      [`Draw: ${flow.draw}.`, `Tutors: ${flow.tutors}.`, `Selection: ${flow.selection}.`, `Engines: ${flow.engines}.`],
      flow.total < settings.drawTarget ? ["Add repeatable draw or filtering that supports the commander/core plan."] : ["Card-flow density meets the selected target."],
      [...cardsWithRole(nonLandEntries, cardMap, "draw"), ...cardsWithRole(nonLandEntries, cardMap, "cardSelection"), ...cardsWithRole(nonLandEntries, cardMap, "engine")],
    ),
    makeScorecardItem(
      "interaction",
      "Interaction",
      pctScore(stats.removalCount, settings.removalTarget),
      `${stats.removalCount} spot interaction pieces against a target of ${settings.removalTarget}.`,
      [`Instant-speed answers: ${interaction.instantSpeed}.`, `Stack interaction: ${interaction.stackInteraction}.`],
      stats.removalCount < settings.removalTarget ? ["Add flexible answers before more narrow synergy pieces."] : ["Spot interaction meets the selected target."],
      cardsWithRole(nonLandEntries, cardMap, "removal"),
    ),
    makeScorecardItem(
      "boardControl",
      "Board Control",
      pctScore(stats.boardWipeCount, settings.wipesTarget),
      `${stats.boardWipeCount} reset buttons against a target of ${settings.wipesTarget}.`,
      [`Permanent-based answers: ${interaction.permanentBased}.`, `Sorcery-speed answers: ${interaction.sorcerySpeed}.`],
      stats.boardWipeCount < settings.wipesTarget ? ["Add at least one reset that fits your board plan."] : ["Board-control density meets the selected target."],
      cardsWithRole(nonLandEntries, cardMap, "boardWipe"),
    ),
    makeScorecardItem(
      "resilience",
      "Resilience",
      pctScore(resilience.total, settings.resilienceTarget),
      `${resilience.total} protection, recursion, or reset effects against a target of ${settings.resilienceTarget}.`,
      [`Protection: ${resilience.protection}.`, `Recursion: ${resilience.recursion}.`, `Wipes: ${resilience.boardWipes}.`],
      resilience.total < settings.resilienceTarget ? ["Add ways to protect or rebuild around commander/core cards."] : ["Recovery tools meet the selected target."],
      [...cardsWithRole(nonLandEntries, cardMap, "protection"), ...cardsWithRole(nonLandEntries, cardMap, "recursion")],
    ),
    makeScorecardItem(
      "winPlan",
      "Win Plan",
      winPlan.status === "good" ? 85 : winPlan.status === "warn" ? 62 : 38,
      winPlan.note,
      [`Primary cluster: ${winPlan.primary}.`, `Finishers: ${winPlan.finishers.length}.`, `Payoffs: ${winPlan.payoffs.length}.`],
      winPlan.status === "bad" ? ["Add redundant finishers or payoffs tied to the deck identity."] : ["Win plan is visible; tune redundancy from playtest results."],
      [...winPlan.finishers, ...winPlan.payoffs],
    ),
    makeScorecardItem(
      "synergy",
      "Commander/Core Synergy",
      synergyScore,
      `${identitySupport.directSupport} non-core cards visibly support commander/core themes.`,
      [`Core cards: ${coreCards.length || 0}.`, identitySupport.weakCoreCards.length ? `Core cards needing more support: ${identitySupport.weakCoreCards.join(", ")}.` : "No unsupported core-card warning from local text signals."],
      synergyScore < 70 ? ["Add cards that overlap with commander/core themes before replacing core identity cards."] : ["Support density around commander/core identity is coherent."],
      [...coreCards, ...identitySupport.supportCards],
    ),
    makeScorecardItem(
      "curve",
      "Curve",
      curveScore,
      `Average mana value is ${stats.avgCmc} against a target of ${settings.avgManaValueTarget}.`,
      (structure.curveBands || []).map((band) => `${band.label}: ${band.count}`),
      curveScore < 70 ? ["Lower the curve or add more early ramp/card selection."] : ["Curve is within the selected target."],
      nonLandEntries.filter((entry) => (findCard(cardMap, entry.name)?.cmc ?? 0) <= 2).map((entry) => entry.name),
    ),
    makeScorecardItem(
      "power",
      "Power/Bracket",
      powerScore,
      `${bracket.rangeLabel} ${bracket.label ? `(${bracket.label})` : ""}.`,
      bracket.reasons,
      bracket.expectedWinTurn <= settings.expectedWinTurnTarget ? ["Disclose speed, compact combos, and Game Changer cards before play."] : ["Power signals are within the selected expectation."],
      [...bracket.gameChangers, ...bracket.comboSignals.flatMap((combo) => combo.matches || [])],
    ),
  ];
}

function buildHighlights(scorecard) {
  const sorted = [...scorecard].sort((a, b) => a.score - b.score);
  return {
    needsAttention: sorted.slice(0, 3),
    strengths: sorted.slice(-3).reverse(),
  };
}

export function buildLocalAnalysis(deck, cardMap, options = {}) {
  const settings = resolveAnalysisSettings(options.analysisSettings || options.settings);
  const coreCards = (options.coreCards || []).filter(Boolean);
  const commanderCards = getCommanderCards(deck, cardMap);
  const coreCardData = getCoreCards(deck, cardMap, coreCards);
  const identityCards = [...commanderCards, ...coreCardData];
  const nonLandEntries = getNonLandEntries(deck, cardMap);
  const manaValueEntries = getManaValueEntries(deck, cardMap);
  const landEntries = getLandEntries(deck, cardMap);
  const manaValueQty = manaValueEntries.reduce((sum, entry) => sum + entry.qty, 0);
  const avgCmc = manaValueQty
    ? manaValueEntries.reduce((sum, entry) => sum + ((findCard(cardMap, entry.name)?.cmc ?? 0) * entry.qty), 0) / manaValueQty
    : 0;
  const stats = {
    cardCount: deck.cardCount,
    expectedMainCount: deck.expectedMainCount,
    landCount: landEntries.reduce((sum, entry) => sum + entry.qty, 0),
    rampCount: countRole(nonLandEntries, cardMap, "ramp"),
    avgCmc: Math.round(avgCmc * 100) / 100,
    boardWipeCount: countRole(nonLandEntries, cardMap, "boardWipe"),
    removalCount: countRole(nonLandEntries, cardMap, "removal"),
  };
  const colorPips = buildColorPips([...deck.commanders, ...nonLandEntries], cardMap);
  const synergyClusters = buildSynergyClusters(nonLandEntries, cardMap);
  const scoreOptions = { coreCards, settings };
  const scores = nonLandEntries.map((entry) => scoreEntry(entry, cardMap, identityCards, stats, scoreOptions));
  const sideboardAnalysis = analyzeCandidateCards(deck.sideboard, cardMap, identityCards, stats, scores, scoreOptions);
  const consideringAnalysis = analyzeCandidateCards(deck.considering, cardMap, identityCards, stats, scores, scoreOptions);
  const bracket = analyzeBracket(deck, cardMap, stats);
  const roleBalance = buildRoleBalance(nonLandEntries, cardMap, settings);
  const interactionProfile = buildInteractionProfile(nonLandEntries, cardMap);
  const resilienceProfile = buildResilienceProfile(nonLandEntries, cardMap, stats, settings);
  const cardFlowProfile = buildCardFlowProfile(nonLandEntries, cardMap, settings);
  const winPlan = buildWinPlan(nonLandEntries, cardMap, synergyClusters);
  const structure = {
    roleBalance,
    typeMix: buildTypeMix(deck, cardMap),
    curveBands: buildCurveBands(nonLandEntries, cardMap),
    manaCurve: buildManaCurve(manaValueEntries, cardMap),
    interactionProfile,
    resilienceProfile,
    cardFlowProfile,
    winPlan,
  };
  const scorecard = buildScorecard({
    deck,
    cardMap,
    nonLandEntries,
    stats,
    structure,
    bracket,
    settings,
    coreCards,
    identityCards,
  });
  const highlights = buildHighlights(scorecard);
  const priorityFindings = buildPriorityFindings(stats, roleBalance, interactionProfile, resilienceProfile, cardFlowProfile, winPlan, bracket, scorecard);
  const clusterText = synergyClusters.length
    ? synergyClusters.slice(0, 2).map((cluster) => cluster.name.toLowerCase()).join(" and ")
    : "role coverage and curve discipline";
  const overallScore = Math.round(scorecard.reduce((sum, item) => sum + item.score, 0) / Math.max(1, scorecard.length));

  return {
    strategy: `This deck appears to lean on ${clusterText}. The local pass prioritizes cards that share command-zone themes, keep the curve efficient, and cover ramp, interaction, card flow, and reset-button roles.`,
    stats,
    colorPips,
    splashNote: buildSplashNote(colorPips),
    consistencyFlags: buildConsistencyFlags(stats, deck, settings),
    synergyClusters,
    weaknesses: buildWeaknesses(stats, settings),
    scores,
    sideboardAnalysis,
    consideringAnalysis,
    upgrades: buildUpgrades(stats, scores, sideboardAnalysis, consideringAnalysis, settings),
    bracket,
    structure,
    priorityFindings,
    scorecard,
    highlights,
    overallScore,
    settings,
    coreCards,
  };
}

export function mergeAnalysis(remoteAnalysis, localAnalysis) {
  if (!remoteAnalysis || typeof remoteAnalysis !== "object") return localAnalysis;
  return {
    ...localAnalysis,
    ...remoteAnalysis,
    stats: { ...localAnalysis.stats, ...(remoteAnalysis.stats || {}) },
    colorPips: { ...localAnalysis.colorPips, ...(remoteAnalysis.colorPips || {}) },
    consistencyFlags: Array.isArray(remoteAnalysis.consistencyFlags) ? remoteAnalysis.consistencyFlags : localAnalysis.consistencyFlags,
    synergyClusters: Array.isArray(remoteAnalysis.synergyClusters) ? remoteAnalysis.synergyClusters : localAnalysis.synergyClusters,
    weaknesses: Array.isArray(remoteAnalysis.weaknesses) ? remoteAnalysis.weaknesses : localAnalysis.weaknesses,
    scores: Array.isArray(remoteAnalysis.scores)
      ? remoteAnalysis.scores.map((score) => {
        const localScore = localAnalysis.scores.find((item) => item.name === score.name);
        return { ...localScore, ...score, roles: localScore?.roles || score.roles || [] };
      })
      : localAnalysis.scores,
    sideboardAnalysis: Array.isArray(remoteAnalysis.sideboardAnalysis) ? remoteAnalysis.sideboardAnalysis : localAnalysis.sideboardAnalysis,
    consideringAnalysis: Array.isArray(remoteAnalysis.consideringAnalysis) ? remoteAnalysis.consideringAnalysis : localAnalysis.consideringAnalysis,
    upgrades: Array.isArray(remoteAnalysis.upgrades) ? remoteAnalysis.upgrades : localAnalysis.upgrades,
    bracket: localAnalysis.bracket,
    structure: localAnalysis.structure,
    priorityFindings: localAnalysis.priorityFindings,
    scorecard: localAnalysis.scorecard,
    highlights: localAnalysis.highlights,
    overallScore: localAnalysis.overallScore,
    settings: localAnalysis.settings,
    coreCards: localAnalysis.coreCards,
  };
}
