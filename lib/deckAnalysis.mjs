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
  ANALYSIS_ROLE_KEYS,
  clampScore,
  findCard,
  getCardText,
  getRoleEvidence,
  getManaColorKeys,
  getManaCost,
  getRoleKeys,
  getRoles,
  getSharedSignals,
  getTypeLine,
  isLandCard,
  normalizeName,
  parsePips,
  MANA_CURVE_COLOR_ORDER,
  ROLE_LABELS,
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
  gameChangerSensitivity: 3,
  synergySensitivity: 6,
  ignoredSettings: [],
};

export function resolveAnalysisSettings(settings = {}) {
  const resolved = { ...DEFAULT_ANALYSIS_SETTINGS, ...(settings || {}) };
  resolved.ignoredSettings = Array.isArray(resolved.ignoredSettings) ? resolved.ignoredSettings : [];
  return resolved;
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

function getScoredEntries(deck, cardMap) {
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
  const { coreCards = [], commanderNames = [], settings = DEFAULT_ANALYSIS_SETTINGS } = options;
  const card = findCard(cardMap, entry.name);
  const roles = getRoles(card);
  const roleKeys = getRoleKeys(card);
  const type = getTypeLine(card);
  const cmc = card?.cmc ?? 0;
  const commanderCmcs = identityCards.map((identityCard) => identityCard.cmc).filter((cmcValue) => cmcValue !== undefined);
  const sharedSignals = getSharedSignals(card, identityCards);
  const core = isCoreName(entry.name, coreCards);
  const commander = commanderNames.some((name) => normalizeName(name) === normalizeName(entry.name));
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
  if (commander) {
    score += 3;
    roleKeys.push("commander");
    reasons.push("commander");
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
    protected: core || commander,
    zone: commander ? "commanders" : "main",
  };
}

function buildSynergyClusters(nonLandEntries, cardMap, identityCards = [], coreCards = []) {
  const clusters = [];
  const coreSet = new Set((coreCards || []).map(normalizeName));
  const identitySignals = SIGNALS
    .filter((signal) => identityCards.some((card) => signal.test(card)))
    .map((signal) => signal.key);

  if (coreCards.length || identitySignals.length) {
    const supportCards = nonLandEntries
      .filter((entry) => {
        const card = findCard(cardMap, entry.name);
        return coreSet.has(normalizeName(entry.name)) || getSharedSignals(card, identityCards).length;
      })
      .map((entry) => entry.name);
    if (supportCards.length) {
      clusters.push({
        name: "Commander/Core Identity",
        cards: [...new Set([...coreCards, ...supportCards])],
        desc: "These cards are either selected core identity pieces or visibly overlap with commander/core themes.",
        identity: true,
      });
    }
  }

  for (const signal of SIGNALS) {
    const cards = nonLandEntries
      .filter((entry) => signal.test(findCard(cardMap, entry.name)))
      .map((entry) => entry.name);
    if (cards.length >= 2) {
      const identityOverlap = identitySignals.includes(signal.key) || cards.some((name) => coreSet.has(normalizeName(name)));
      clusters.push({ name: signal.name, cards, desc: signal.desc, identity: identityOverlap });
    }
  }

  if (!clusters.length) {
    const roleCards = nonLandEntries
      .filter((entry) => {
        const roles = getRoles(findCard(cardMap, entry.name));
        return roles.ramp || roles.draw || roles.removal;
      })
      .map((entry) => entry.name);
    if (roleCards.length) {
      clusters.push({
        name: "Role Coverage",
        cards: roleCards,
        desc: "These cards cover basic ramp, card flow, and interaction needs.",
      });
    }
  }
  return clusters
    .sort((a, b) => Number(Boolean(b.identity)) - Number(Boolean(a.identity)))
    .slice(0, 5);
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
  if (stats.cardCount !== stats.expectedMainCount) weaknesses.push({ severity: "warning", label: "Deck size mismatch", desc: `Deck has ${stats.cardCount} main-deck cards; ${stats.expectedMainCount} is expected after command-zone cards.` });
  if (stats.landCount < settings.landsMin) weaknesses.push({ severity: "critical", label: "Low land count", desc: `Deck has ${stats.landCount} lands; ${settings.landsMin}-${settings.landsMax} is the selected norm.` });
  if (stats.landCount > settings.landsMax) weaknesses.push({ severity: "warning", label: "High land count", desc: `Deck has ${stats.landCount} lands; ${settings.landsMin}-${settings.landsMax} is the selected norm.` });
  if (stats.rampCount < Math.max(0, settings.rampTarget - 2)) weaknesses.push({ severity: "critical", label: "Needs more ramp", desc: `Deck has ${stats.rampCount} ramp pieces; ${settings.rampTarget}-${settings.rampTarget + 2} is typical for this target.` });
  if (stats.avgCmc > settings.avgManaValueTarget) weaknesses.push({ severity: "warning", label: "Heavy curve", desc: `Average mana value is ${stats.avgCmc}; ${settings.avgManaValueTarget} or lower is the selected target.` });
  if (stats.removalCount < Math.max(0, settings.removalTarget - 2)) weaknesses.push({ severity: "warning", label: "Thin interaction", desc: `Deck has ${stats.removalCount} spot interaction pieces; ${settings.removalTarget}-${settings.removalTarget + 2} is typical for this target.` });
  if (stats.boardWipeCount < Math.max(0, settings.wipesTarget - 1)) weaknesses.push({ severity: "minor", label: "Few reset buttons", desc: `Deck has ${stats.boardWipeCount} board wipes; ${settings.wipesTarget}-${settings.wipesTarget + 1} is typical for this target.` });
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
  if (type.includes("land")) return "lands";
  if (type.includes("creature")) return "creatures";
  if (type.includes("instant")) return "instants";
  if (type.includes("sorcery")) return "sorceries";
  if (type.includes("artifact")) return "artifacts";
  if (type.includes("enchantment")) return "enchantments";
  if (type.includes("planeswalker")) return "planeswalkers";
  if (type.includes("battle")) return "battles";
  return "other";
}

const TYPE_GROUP_LABELS = {
  creatures: "Creatures",
  instants: "Instants",
  sorceries: "Sorceries",
  artifacts: "Artifacts",
  enchantments: "Enchantments",
  planeswalkers: "Planeswalkers",
  battles: "Battles",
  lands: "Lands",
  other: "Other",
};

function cardImageUrl(card) {
  return card?.image_uris?.normal || card?.card_faces?.find((face) => face.image_uris?.normal)?.image_uris?.normal || null;
}

function cardSummary(entry, card) {
  return {
    name: entry.name,
    qty: entry.qty,
    typeLine: card?.type_line || "Unknown",
    manaCost: getManaCost(card) || "",
    cmc: card?.cmc ?? null,
    imageUrl: cardImageUrl(card),
  };
}

function buildTypeGroups(deck, cardMap) {
  const groups = Object.fromEntries(Object.entries(TYPE_GROUP_LABELS).map(([key, label]) => [key, { key, label, count: 0, cards: [] }]));
  for (const entry of [...deck.commanders, ...deck.main]) {
    const card = findCard(cardMap, entry.name);
    const key = typeCategory(card);
    groups[key].count += entry.qty;
    groups[key].cards.push(cardSummary(entry, card));
  }
  return Object.values(groups).filter((group) => group.count || group.key !== "other");
}

function buildRoleGroups(entries, cardMap) {
  const groups = Object.fromEntries(ANALYSIS_ROLE_KEYS.map((key) => [key, {
    key,
    label: ROLE_LABELS[key] || key,
    count: 0,
    cards: [],
    evidence: [],
  }]));

  for (const entry of entries) {
    const card = findCard(cardMap, entry.name);
    const evidence = getRoleEvidence(card, entry.name);
    for (const item of evidence) {
      if (!groups[item.role]) continue;
      if (!groups[item.role].cards.some((existing) => normalizeName(existing.name) === normalizeName(entry.name))) {
        groups[item.role].cards.push(cardSummary(entry, card));
      }
      groups[item.role].count += entry.qty;
      groups[item.role].evidence.push({ ...item, cardName: entry.name });
    }
  }

  return Object.values(groups);
}

function buildTypeMix(deck, cardMap) {
  const counts = {};
  for (const entry of deck.main) {
    const category = typeCategory(findCard(cardMap, entry.name));
    counts[category] = (counts[category] || 0) + entry.qty;
  }
  const total = deck.cardCount || 1;
  return Object.entries(counts)
    .map(([type, count]) => ({ type: TYPE_GROUP_LABELS[type] || type, key: type, count, pct: Math.round((count / total) * 100) }))
    .sort((a, b) => b.count - a.count);
}

function curveBandFor(cmc) {
  if (cmc <= 1) return "0-1";
  if (cmc === 2) return "2";
  if (cmc === 3) return "3";
  if (cmc === 4) return "4";
  return "5+";
}

function buildCurveBands(nonLandEntries, cardMap, commanderCards = []) {
  const commanderTurns = new Map();
  for (const commander of commanderCards) {
    const key = curveBandFor(Math.floor(commander?.cmc ?? 0));
    const names = commanderTurns.get(key) || [];
    if (commander?.name) names.push(commander.name);
    commanderTurns.set(key, names);
  }

  const labels = {
    "0-1": "Setup",
    2: "Early",
    3: "Bridge",
    4: "Midgame",
    "5+": "Top End",
  };
  const counts = { "0-1": 0, 2: 0, 3: 0, 4: 0, "5+": 0 };

  for (const entry of nonLandEntries) {
    const cmc = Math.floor(findCard(cardMap, entry.name)?.cmc ?? 0);
    counts[curveBandFor(cmc)] += entry.qty;
  }

  return Object.entries(counts).map(([key, count]) => {
    const commanderNames = commanderTurns.get(key) || [];
    const commanderLabel = commanderNames.length
      ? `Commander Turn${commanderNames.length > 1 ? "s" : ""}`
      : labels[key];
    return {
      key,
      label: commanderLabel,
      count,
      commanderNames,
      detail: commanderNames.length
        ? `Shares a mana value band with ${commanderNames.join(" and ")}.`
        : key === "5+" ? "Expensive spells that need ramp or high impact." : "Cards available before or around the deck's setup turns.",
    };
  });
}

function buildManaCurve(manaValueEntries, cardMap) {
  const buckets = {};
  for (const entry of manaValueEntries) {
    const card = findCard(cardMap, entry.name);
    const cmc = Math.floor(card?.cmc ?? 0);
    const colors = getManaColorKeys(card);
    const key = String(cmc);
    if (!buckets[key]) {
      buckets[key] = { cmc: key, total: 0 };
      for (const colorKey of MANA_CURVE_COLOR_ORDER) buckets[key][colorKey] = 0;
    }
    for (const color of colors) {
      buckets[key][color] += entry.qty;
    }
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
  let artifactEnchantmentRemoval = 0;
  let graveyardInteraction = 0;
  const examples = [];

  for (const entry of nonLandEntries) {
    const card = findCard(cardMap, entry.name);
    const roles = getRoles(card);
    const type = getTypeLine(card);
    const text = getCardText(card);
    if (/artifact or enchantment|artifact, enchantment|destroy target artifact|destroy target enchantment|exile target artifact|exile target enchantment/.test(text)) {
      artifactEnchantmentRemoval += entry.qty;
    }
    if (roles.graveyardHate || /exile .* graveyard|graveyards/.test(text)) graveyardInteraction += entry.qty;
    if (!roles.removal && !roles.boardWipe) continue;

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
    artifactEnchantmentRemoval,
    graveyardInteraction,
    examples,
    status: total >= 5 && instantSpeed >= 2 ? "good" : total >= 3 ? "warn" : "bad",
    note: total >= 5
      ? "The deck has a usable interaction suite; check whether enough of it works at instant speed."
      : "The deck may not have enough answers to stop opposing engines or combos.",
  };
}

function buildAnswerGaps(stats, interactionProfile, resilienceProfile) {
  const specs = [
    { key: "singleTargetRemoval", label: "Single-target removal", count: stats.removalCount, expected: "5-7", ok: stats.removalCount >= 5 },
    { key: "boardWipes", label: "Board wipes", count: stats.boardWipeCount, expected: "3-4", ok: stats.boardWipeCount >= 3 },
    { key: "graveyardInteraction", label: "Graveyard interaction", count: interactionProfile.graveyardInteraction, expected: "1-3", ok: interactionProfile.graveyardInteraction >= 1 },
    { key: "artifactEnchantmentRemoval", label: "Artifact/enchantment removal", count: interactionProfile.artifactEnchantmentRemoval, expected: "2-4", ok: interactionProfile.artifactEnchantmentRemoval >= 2 },
    { key: "counterspells", label: "Counterspells / stack interaction", count: interactionProfile.stackInteraction, expected: "1-4 in blue decks", ok: interactionProfile.stackInteraction >= 1 },
    { key: "protection", label: "Protection", count: resilienceProfile.protection, expected: "2-4", ok: resilienceProfile.protection >= 2 },
  ];

  return specs.map((spec) => ({
    ...spec,
    severity: spec.ok ? "covered" : "gap",
    message: spec.ok
      ? `${spec.label}: ${spec.count} found; ${spec.expected} is the normal target.`
      : `${spec.label}: ${spec.count} found; ${spec.expected} is the normal target.`,
  }));
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

function buildPriorityFindings(stats, roleBalance, interactionProfile, resilienceProfile, cardFlowProfile, winPlan, bracket, scorecard = [], answerGaps = []) {
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
    const missing = answerGaps.filter((gap) => gap.severity === "gap").map((gap) => `${gap.label} (${gap.count})`).slice(0, 4);
    findings.push({ severity: "warning", label: "Interaction suite is light", detail: `${interactionProfile.total} answer cards detected. Missing or low categories: ${missing.join(", ") || "none"}.`, action: "Add flexible instant-speed removal or stack interaction." });
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

function makeScorecardItem(key, label, score, summary, evidence, adjustments, highlightCards = [], settingKeys = [], ignoredSettings = []) {
  const roundedScore = Math.max(0, Math.min(100, Math.round(score)));
  const ignored = settingKeys.some((settingKey) => ignoredSettings.includes(settingKey));
  return {
    key,
    label,
    score: roundedScore,
    grade: gradeFor(roundedScore),
    status: statusForScore(roundedScore),
    ignored,
    settingKeys,
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
      ["landsMin", "landsMax"],
      settings.ignoredSettings,
    ),
    makeScorecardItem(
      "ramp",
      "Ramp",
      pctScore(stats.rampCount, settings.rampTarget),
      `${stats.rampCount} ramp pieces against a target of ${settings.rampTarget}.`,
      [`Role status: ${role("ramp")?.status || "unknown"}.`, `Average MV: ${stats.avgCmc}.`],
      stats.rampCount < settings.rampTarget ? ["Prioritize cheap ramp that helps cast commander/core cards earlier."] : ["Ramp density meets the selected target."],
      cardsWithRole(nonLandEntries, cardMap, "ramp"),
      ["rampTarget"],
      settings.ignoredSettings,
    ),
    makeScorecardItem(
      "flow",
      "Card Flow",
      pctScore(flow.total, settings.drawTarget),
      `${flow.total} draw/tutor/selection/engine signals against a target of ${settings.drawTarget}.`,
      [`Draw: ${flow.draw}.`, `Tutors: ${flow.tutors}.`, `Selection: ${flow.selection}.`, `Engines: ${flow.engines}.`],
      flow.total < settings.drawTarget ? ["Add repeatable draw or filtering that supports the commander/core plan."] : ["Card-flow density meets the selected target."],
      [...cardsWithRole(nonLandEntries, cardMap, "draw"), ...cardsWithRole(nonLandEntries, cardMap, "cardSelection"), ...cardsWithRole(nonLandEntries, cardMap, "engine")],
      ["drawTarget"],
      settings.ignoredSettings,
    ),
    makeScorecardItem(
      "interaction",
      "Interaction",
      pctScore(stats.removalCount, settings.removalTarget),
      `${stats.removalCount} spot interaction pieces against a target of ${settings.removalTarget}.`,
      [`Instant-speed answers: ${interaction.instantSpeed}.`, `Stack interaction: ${interaction.stackInteraction}.`],
      stats.removalCount < settings.removalTarget ? ["Add flexible answers before more narrow synergy pieces."] : ["Spot interaction meets the selected target."],
      cardsWithRole(nonLandEntries, cardMap, "removal"),
      ["removalTarget"],
      settings.ignoredSettings,
    ),
    makeScorecardItem(
      "boardControl",
      "Board Control",
      pctScore(stats.boardWipeCount, settings.wipesTarget),
      `${stats.boardWipeCount} reset buttons against a target of ${settings.wipesTarget}.`,
      [`Permanent-based answers: ${interaction.permanentBased}.`, `Sorcery-speed answers: ${interaction.sorcerySpeed}.`],
      stats.boardWipeCount < settings.wipesTarget ? ["Add at least one reset that fits your board plan."] : ["Board-control density meets the selected target."],
      cardsWithRole(nonLandEntries, cardMap, "boardWipe"),
      ["wipesTarget"],
      settings.ignoredSettings,
    ),
    makeScorecardItem(
      "resilience",
      "Resilience",
      pctScore(resilience.total, settings.resilienceTarget),
      `${resilience.total} protection, recursion, or reset effects against a target of ${settings.resilienceTarget}.`,
      [`Protection: ${resilience.protection}.`, `Recursion: ${resilience.recursion}.`, `Wipes: ${resilience.boardWipes}.`],
      resilience.total < settings.resilienceTarget ? ["Add ways to protect or rebuild around commander/core cards."] : ["Recovery tools meet the selected target."],
      [...cardsWithRole(nonLandEntries, cardMap, "protection"), ...cardsWithRole(nonLandEntries, cardMap, "recursion")],
      ["resilienceTarget"],
      settings.ignoredSettings,
    ),
    makeScorecardItem(
      "winPlan",
      "Win Plan",
      winPlan.status === "good" ? 85 : winPlan.status === "warn" ? 62 : 38,
      winPlan.note,
      [`Primary cluster: ${winPlan.primary}.`, `Finishers: ${winPlan.finishers.length}.`, `Payoffs: ${winPlan.payoffs.length}.`],
      winPlan.status === "bad" ? ["Add redundant finishers or payoffs tied to the deck identity."] : ["Win plan is visible; tune redundancy from playtest results."],
      [...winPlan.finishers, ...winPlan.payoffs],
      [],
      settings.ignoredSettings,
    ),
    makeScorecardItem(
      "synergy",
      "Commander/Core Synergy",
      synergyScore,
      `${identitySupport.directSupport} non-core cards visibly support commander/core themes.`,
      [`Core cards: ${coreCards.length || 0}.`, identitySupport.weakCoreCards.length ? `Core cards needing more support: ${identitySupport.weakCoreCards.join(", ")}.` : "No unsupported core-card warning from local text signals."],
      synergyScore < 70 ? ["Add cards that overlap with commander/core themes before replacing core identity cards."] : ["Support density around commander/core identity is coherent."],
      [...coreCards, ...identitySupport.supportCards],
      ["synergySensitivity"],
      settings.ignoredSettings,
    ),
    makeScorecardItem(
      "curve",
      "Curve",
      curveScore,
      `Average mana value is ${stats.avgCmc} against a target of ${settings.avgManaValueTarget}.`,
      (structure.curveBands || []).map((band) => `${band.label}: ${band.count}`),
      curveScore < 70 ? ["Lower the curve or add more early ramp/card selection."] : ["Curve is within the selected target."],
      nonLandEntries.filter((entry) => (findCard(cardMap, entry.name)?.cmc ?? 0) <= 2).map((entry) => entry.name),
      ["avgManaValueTarget"],
      settings.ignoredSettings,
    ),
    makeScorecardItem(
      "power",
      "Power/Bracket",
      powerScore,
      `${bracket.rangeLabel} ${bracket.label ? `(${bracket.label})` : ""}.`,
      bracket.reasons,
      bracket.expectedWinTurn <= settings.expectedWinTurnTarget ? ["Disclose speed, compact combos, and Game Changer cards before play."] : ["Power signals are within the selected expectation."],
      [...bracket.gameChangers, ...bracket.comboSignals.flatMap((combo) => combo.matches || [])],
      ["expectedWinTurnTarget", "tutorSensitivity", "fastManaSensitivity", "gameChangerSensitivity"],
      settings.ignoredSettings,
    ),
  ];
}

function countSharedSupport(entries, cardMap, commanderCard) {
  const cards = [];
  let count = 0;
  for (const entry of entries) {
    const card = findCard(cardMap, entry.name);
    if (getSharedSignals(card, [commanderCard]).length) {
      count += entry.qty;
      if (cards.length < 6) cards.push(entry.name);
    }
  }
  return { count, cards };
}

function pushCommanderSignal(bucket, points, text, cards = []) {
  bucket.score += points;
  bucket.evidence.push({ text, cards: [...new Set(cards)].filter(Boolean) });
}

function classifyCommander(entry, cardMap, nonLandEntries, coreCards, coreCardData) {
  const card = findCard(cardMap, entry.name);
  const text = getCardText(card);
  const roles = getRoles(card);
  const type = getTypeLine(card);
  const sharedSupport = countSharedSupport(nonLandEntries, cardMap, card);
  const coreSupport = coreCardData
    .filter((coreCard) => getSharedSignals(coreCard, [card]).length)
    .map((coreCard) => coreCard.name);
  const staxCards = roleExamples(nonLandEntries, cardMap, "stax", 6);
  const protectionCards = roleExamples(nonLandEntries, cardMap, "protection", 6);
  const categories = {
    Enabler: { score: 0, evidence: [] },
    Linchpin: { score: 0, evidence: [] },
    Intensifier: { score: 0, evidence: [] },
    Counterweight: { score: 0, evidence: [] },
  };

  if (!card) {
    pushCommanderSignal(categories.Intensifier, 1, "Commander metadata is missing, so classification is based on deck context only.");
  }

  if (/becomes? (an? )?.*creature|target .* becomes|animate|crew|vehicle|you may cast|you may play|spells? you cast cost .* less|costs? .* less|add .* mana|mana of any color/.test(text)) {
    pushCommanderSignal(categories.Enabler, 4, "Commander opens access, animation, cost conversion, or mana that enables the plan.");
  }
  if (roles.ramp || roles.manaFixing || roles.costReducer) {
    pushCommanderSignal(categories.Enabler, 2, "Commander has mana development or cost-reduction text.");
  }
  if (/artifact|vehicle|token/.test(text) && sharedSupport.count >= 3) {
    pushCommanderSignal(categories.Enabler, 2, `${sharedSupport.count} deck cards share the commander's enabling theme.`, sharedSupport.cards);
  }

  if (sharedSupport.count >= 6) {
    pushCommanderSignal(categories.Linchpin, 4, `${sharedSupport.count} nonland cards visibly overlap with this commander's text signals.`, sharedSupport.cards);
  } else if (sharedSupport.count >= 3) {
    pushCommanderSignal(categories.Linchpin, 2, `${sharedSupport.count} nonland cards visibly overlap with this commander.`, sharedSupport.cards);
  }
  if (coreSupport.length >= 2) {
    pushCommanderSignal(categories.Linchpin, 3, "Selected core cards share this commander's engine signals.", coreSupport);
  } else if (coreSupport.length === 1) {
    pushCommanderSignal(categories.Linchpin, 1, "A selected core card shares this commander's engine signals.", coreSupport);
  }
  if (/whenever you|whenever .* you control|whenever .* cast|the first time|at the beginning of/.test(text)) {
    pushCommanderSignal(categories.Linchpin, 1, "Commander has repeatable engine text.");
  }

  if (roles.draw || roles.tokenMaker || roles.payoff || roles.engine || roles.finisher || /double|additional|copy|create .* token|draw .* card|counter on|counters on/.test(text)) {
    pushCommanderSignal(categories.Intensifier, 3, "Commander adds value, scaling, pressure, or redundancy to an existing plan.");
  }
  if (sharedSupport.count > 0 && sharedSupport.count < 6) {
    pushCommanderSignal(categories.Intensifier, 2, "Some deck cards share the commander's theme, but the deck is not fully commander-dependent.", sharedSupport.cards);
  }
  if (type.includes("creature") && (card?.cmc ?? 0) >= 5) {
    pushCommanderSignal(categories.Intensifier, 1, "Commander is a higher-cost threat or value piece rather than only setup.");
  }

  if (/opponents? can't|players can't|spells .* cost .* more|prevent|protection from|hexproof|ward|indestructible|sacrifice|skip|doesn't untap|enters? .* tapped/.test(text)) {
    pushCommanderSignal(categories.Counterweight, 4, "Commander offsets pressure, protects the plan, or makes restrictive effects more favorable.");
  }
  if (staxCards.length >= 2) {
    pushCommanderSignal(categories.Counterweight, 3, "Deck includes multiple restrictive pieces that may need asymmetry or compensation.", staxCards);
  }
  if (protectionCards.length >= 3 && sharedSupport.count <= 3) {
    pushCommanderSignal(categories.Counterweight, 1, "Deck has protection density around a constrained or defensive plan.", protectionCards);
  }

  const ranked = Object.entries(categories)
    .map(([category, detail]) => ({ category, ...detail }))
    .sort((a, b) => b.score - a.score || a.category.localeCompare(b.category));
  const best = ranked[0];
  const second = ranked[1];
  const gap = best.score - second.score;
  const confidence = best.score >= 5 && gap >= 3 ? "high" : best.score >= 3 && gap >= 2 ? "medium" : "low";
  const outlier = confidence === "low" || gap <= 1;
  const alternates = ranked
    .filter((item) => item.category !== best.category && item.score > 0 && best.score - item.score <= 2)
    .map((item) => item.category);

  return {
    name: entry.name,
    category: best.category,
    confidence,
    outlier,
    score: best.score,
    alternateCategories: alternates,
    evidence: best.evidence.slice(0, 4),
    explanation: outlier && alternates.length
      ? `${entry.name} is closest to ${best.category}, but ${alternates.join(" and ")} also have evidence.`
      : `${entry.name} is classified as ${best.category} because ${best.evidence[0]?.text?.replace(/\.$/, "") || "the available commander and deck signals point there"}.`,
  };
}

function buildCommanderProfile(deck, cardMap, nonLandEntries, coreCards, coreCardData) {
  const commanders = deck.commanders.map((entry) => classifyCommander(entry, cardMap, nonLandEntries, coreCards, coreCardData));
  const categories = [...new Set(commanders.map((commander) => commander.category))];
  const summary = commanders.length === 0
    ? "No commander was available to classify."
    : commanders.length === 1
      ? `${commanders[0].name} is a ${commanders[0].category}.`
      : categories.length === 1
        ? `Both commanders function as ${categories[0]} pieces.`
        : `The commanders split roles: ${commanders.map((commander) => `${commander.name} is ${commander.category}`).join("; ")}.`;

  return {
    commanders,
    summary,
    hasOutliers: commanders.some((commander) => commander.outlier),
  };
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
  const commanderProfile = buildCommanderProfile(deck, cardMap, nonLandEntries, coreCards, coreCardData);
  const manaValueEntries = getManaValueEntries(deck, cardMap);
  const scoredEntries = getScoredEntries(deck, cardMap);
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
  const synergyClusters = buildSynergyClusters(nonLandEntries, cardMap, identityCards, coreCards);
  const scoreOptions = { coreCards, commanderNames: deck.commanders.map((entry) => entry.name), settings };
  const scores = scoredEntries.map((entry) => scoreEntry(entry, cardMap, identityCards, stats, scoreOptions));
  const sideboardAnalysis = analyzeCandidateCards(deck.sideboard, cardMap, identityCards, stats, scores, scoreOptions);
  const consideringAnalysis = analyzeCandidateCards(deck.considering, cardMap, identityCards, stats, scores, scoreOptions);
  const bracket = analyzeBracket(deck, cardMap, stats);
  const roleBalance = buildRoleBalance(nonLandEntries, cardMap, settings);
  const interactionProfile = buildInteractionProfile(nonLandEntries, cardMap);
  const resilienceProfile = buildResilienceProfile(nonLandEntries, cardMap, stats, settings);
  const answerGaps = buildAnswerGaps(stats, interactionProfile, resilienceProfile);
  const cardFlowProfile = buildCardFlowProfile(nonLandEntries, cardMap, settings);
  const winPlan = buildWinPlan(nonLandEntries, cardMap, synergyClusters);
  const structure = {
    roleBalance,
    typeMix: buildTypeMix(deck, cardMap),
    curveBands: buildCurveBands(nonLandEntries, cardMap, commanderCards),
    manaCurve: buildManaCurve(manaValueEntries, cardMap),
    interactionProfile,
    resilienceProfile,
    answerGaps,
    cardFlowProfile,
    winPlan,
  };
  const cardGroups = {
    typeGroups: buildTypeGroups(deck, cardMap),
    roleGroups: buildRoleGroups(scoredEntries, cardMap),
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
  const priorityFindings = buildPriorityFindings(stats, roleBalance, interactionProfile, resilienceProfile, cardFlowProfile, winPlan, bracket, scorecard, answerGaps);
  const clusterText = synergyClusters.length
    ? synergyClusters.slice(0, 2).map((cluster) => cluster.name.toLowerCase()).join(" and ")
    : "role coverage and curve discipline";
  const scoredScorecard = scorecard.filter((item) => !item.ignored);
  const overallScore = Math.round(scoredScorecard.reduce((sum, item) => sum + item.score, 0) / Math.max(1, scoredScorecard.length));

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
    commanderProfile,
    structure,
    cardGroups,
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
    synergyClusters: localAnalysis.synergyClusters,
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
    commanderProfile: localAnalysis.commanderProfile,
    structure: localAnalysis.structure,
    cardGroups: localAnalysis.cardGroups,
    priorityFindings: localAnalysis.priorityFindings,
    scorecard: localAnalysis.scorecard,
    highlights: localAnalysis.highlights,
    overallScore: localAnalysis.overallScore,
    settings: localAnalysis.settings,
    coreCards: localAnalysis.coreCards,
  };
}
