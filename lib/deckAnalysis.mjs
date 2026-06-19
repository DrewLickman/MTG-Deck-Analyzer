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
  getManaCost,
  getRoleKeys,
  getRoles,
  getSharedSignals,
  getTypeLine,
  isLandCard,
  parsePips,
  SIGNALS,
} from "./cardUtils.mjs";
import { analyzeBracket, isGameChangerName } from "./commanderBrackets.mjs";

function getCommanderCards(deck, cardMap) {
  return deck.commanders.map((entry) => findCard(cardMap, entry.name)).filter(Boolean);
}

function getNonLandEntries(deck, cardMap) {
  return deck.main.filter((entry) => !isLandCard(entry.name, findCard(cardMap, entry.name)));
}

function getLandEntries(deck, cardMap) {
  return deck.main.filter((entry) => isLandCard(entry.name, findCard(cardMap, entry.name)));
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

function scoreEntry(entry, cardMap, commanderCards, stats) {
  const card = findCard(cardMap, entry.name);
  const roles = getRoles(card);
  const roleKeys = getRoleKeys(card);
  const type = getTypeLine(card);
  const cmc = card?.cmc ?? 0;
  const commanderCmcs = commanderCards.map((commander) => commander.cmc).filter((cmcValue) => cmcValue !== undefined);
  const sharedSignals = getSharedSignals(card, commanderCards);
  const reasons = [];
  let score = 0;

  if (roles.ramp) {
    score += stats.rampCount < TARGET_RAMP_MIN ? 3 : 2;
    reasons.push("ramp");
  }
  if (roles.draw || roles.tutor) {
    score += 2;
    reasons.push(roles.tutor ? "selection" : "card flow");
  }
  if (roles.removal) {
    score += stats.removalCount < TARGET_REMOVAL_MIN ? 3 : 2;
    reasons.push("interaction");
  }
  if (roles.boardWipe) {
    score += stats.boardWipeCount < TARGET_WIPES_MIN ? 3 : 2;
    reasons.push("reset button");
  }
  if (roles.protection) {
    score += 1;
    reasons.push("protection");
  }
  if (sharedSignals.length) {
    score += Math.min(3, sharedSignals.length + 1);
    reasons.push("commander overlap");
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

function buildConsistencyFlags(stats, deck) {
  const deckSizeOk = stats.cardCount === deck.expectedMainCount;
  return [
    { ok: deckSizeOk, text: `${stats.cardCount}/${deck.expectedMainCount} main-deck cards after command-zone cards.` },
    { ok: stats.landCount >= TARGET_LANDS_MIN && stats.landCount <= TARGET_LANDS_MAX, text: `${stats.landCount} lands measured against a ${TARGET_LANDS_MIN}-${TARGET_LANDS_MAX} Commander baseline.` },
    { ok: stats.rampCount >= TARGET_RAMP_CRIT, text: `${stats.rampCount} ramp pieces found; ${TARGET_RAMP_MIN}-12 is a comfortable target for many decks.` },
    { ok: stats.avgCmc <= TARGET_AVG_CMC, text: `Average mana value is ${stats.avgCmc}; lower curves recover faster after disruption.` },
    { ok: stats.boardWipeCount >= TARGET_WIPES_CRIT, text: `${stats.boardWipeCount} board wipes found; ${TARGET_WIPES_CRIT}-${TARGET_WIPES_MIN} is a useful range.` },
    { ok: stats.removalCount >= TARGET_REMOVAL_CRIT, text: `${stats.removalCount} targeted interaction pieces found; ${TARGET_REMOVAL_CRIT}-${TARGET_REMOVAL_MIN} is a healthy starting range.` },
  ];
}

function buildWeaknesses(stats) {
  const weaknesses = [];
  if (stats.cardCount !== stats.expectedMainCount) weaknesses.push({ severity: "warning", label: "Deck size mismatch", desc: "Card count does not match the expected Commander deck size after command-zone cards." });
  if (stats.landCount < TARGET_LANDS_MIN) weaknesses.push({ severity: "critical", label: "Low land count", desc: "The deck may miss land drops before its engine comes online." });
  if (stats.landCount > TARGET_LANDS_MAX) weaknesses.push({ severity: "warning", label: "High land count", desc: "The deck may flood unless the commander or land package converts lands into value." });
  if (stats.rampCount < TARGET_RAMP_CRIT) weaknesses.push({ severity: "critical", label: "Needs more ramp", desc: "Ramp count is below the usual Commander floor." });
  if (stats.avgCmc > TARGET_AVG_CMC) weaknesses.push({ severity: "warning", label: "Heavy curve", desc: "Early turns may be slower than the table." });
  if (stats.removalCount < TARGET_REMOVAL_CRIT) weaknesses.push({ severity: "warning", label: "Thin interaction", desc: "The deck may struggle to answer must-kill engines or combo pieces on time." });
  if (stats.boardWipeCount < TARGET_WIPES_CRIT) weaknesses.push({ severity: "minor", label: "Few reset buttons", desc: "The deck has limited ways to catch up when opponents build a wider board." });
  if (!weaknesses.length) weaknesses.push({ severity: "minor", label: "No major structural gap", desc: "Core land, ramp, curve, wipe, and interaction counts are within normal Commander ranges." });
  return weaknesses;
}

function analyzeCandidateCards(entries, cardMap, commanderCards, stats, scores) {
  const lowest = [...scores].sort((a, b) => a.score - b.score)[0];
  return entries.map((entry) => {
    const scored = scoreEntry(entry, cardMap, commanderCards, stats);
    const card = findCard(cardMap, entry.name);
    const roles = getRoles(card);
    let recommendation = "maybe";
    if ((roles.ramp && stats.rampCount < TARGET_RAMP_MIN) || (roles.removal && stats.removalCount < TARGET_REMOVAL_MIN) || (roles.boardWipe && stats.boardWipeCount < TARGET_WIPES_MIN) || scored.score >= 4) {
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

function buildUpgrades(stats, scores, sideboardAnalysis, consideringAnalysis) {
  const cuts = [...scores].sort((a, b) => a.score - b.score).slice(0, 5);
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

  const suggestedAdd = stats.rampCount < TARGET_RAMP_CRIT
    ? "Additional two-mana ramp"
    : stats.removalCount < TARGET_REMOVAL_CRIT
      ? "Flexible targeted removal"
      : stats.boardWipeCount < TARGET_WIPES_CRIT
        ? "Additional board wipe"
        : "High-synergy engine piece";

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

export function buildLocalAnalysis(deck, cardMap) {
  const commanderCards = getCommanderCards(deck, cardMap);
  const nonLandEntries = getNonLandEntries(deck, cardMap);
  const landEntries = getLandEntries(deck, cardMap);
  const nonLandQty = nonLandEntries.reduce((sum, entry) => sum + entry.qty, 0);
  const avgCmc = nonLandQty
    ? nonLandEntries.reduce((sum, entry) => sum + ((findCard(cardMap, entry.name)?.cmc ?? 0) * entry.qty), 0) / nonLandQty
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
  const scores = nonLandEntries.map((entry) => scoreEntry(entry, cardMap, commanderCards, stats));
  const sideboardAnalysis = analyzeCandidateCards(deck.sideboard, cardMap, commanderCards, stats, scores);
  const consideringAnalysis = analyzeCandidateCards(deck.considering, cardMap, commanderCards, stats, scores);
  const bracket = analyzeBracket(deck, cardMap, stats);
  const clusterText = synergyClusters.length
    ? synergyClusters.slice(0, 2).map((cluster) => cluster.name.toLowerCase()).join(" and ")
    : "role coverage and curve discipline";

  return {
    strategy: `This deck appears to lean on ${clusterText}. The local pass prioritizes cards that share command-zone themes, keep the curve efficient, and cover ramp, interaction, card flow, and reset-button roles.`,
    stats,
    colorPips,
    splashNote: buildSplashNote(colorPips),
    consistencyFlags: buildConsistencyFlags(stats, deck),
    synergyClusters,
    weaknesses: buildWeaknesses(stats),
    scores,
    sideboardAnalysis,
    consideringAnalysis,
    upgrades: buildUpgrades(stats, scores, sideboardAnalysis, consideringAnalysis),
    bracket,
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
  };
}
