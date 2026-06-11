"use client";

import { useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";

const SCRYFALL_BATCH_SIZE = 75;
const MIN_SCORE = -10;
const MAX_SCORE = 10;
const TARGET_LANDS_MIN = 36;
const TARGET_LANDS_MAX = 40;
const TARGET_RAMP_MIN = 10;
const TARGET_RAMP_CRIT = 8;
const TARGET_REMOVAL_MIN = 5;
const TARGET_REMOVAL_CRIT = 3;
const TARGET_WIPES_MIN = 3;
const TARGET_WIPES_CRIT = 2;
const TARGET_AVG_CMC = 3.2;
const SPLASH_THRESHOLD = 0.15;

const COLOR_HEX = { W:"#f9f0a0", U:"#6ab0e8", B:"#a78ccc", R:"#f4645f", G:"#5cb87a", C:"#9ca3af" };
const COLOR_LABEL = { W:"White", U:"Blue", B:"Black", R:"Red", G:"Green", C:"Colorless/Generic" };
const BASICS = new Set(["Mountain","Swamp","Island","Forest","Plains","Wastes"]);

// Parse Arena / Moxfield lines like:
//   1 Card Name (SET) 123 *F*
//   1 Card Name (PLST) IKO-73
//   1 Card Name (PDSK) 136p
//   16 Mountain (SOS) 270
function parseLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const qtyMatch = trimmed.match(/^(\d+)\s+(.+)$/);
  if (!qtyMatch) return null;

  const qty = parseInt(qtyMatch[1], 10);
  let rest = qtyMatch[2].replace(/\s*\*F\*?\s*$/i, "").trim();

  // Strip set code + collector number suffixes (incl. PLST cross-set refs, promo variants)
  rest = rest.replace(/\s+\([A-Z0-9]+\)\s+[\w-]+(?:[a-z])?\s*$/i, "");
  rest = rest.replace(/\s+\([A-Z0-9]+\)\s*$/i, "");

  let name = rest.trim();
  if (!name) return null;

  // Moxfield DFC " / " → Scryfall " // "
  name = name.replace(/\s+\/\s+/, " // ");
  return { qty, name };
}

function parseDecklist(raw, commanderName) {
  const lines = raw.split("\n").map(l => l.trim()).filter(Boolean);
  const main = [];
  const sideboard = [];
  let section = "main";

  for (const line of lines) {
    const lower = line.toLowerCase().replace(/\s/g, "");
    if (lower === "sideboard:" || lower === "sb:" || lower === "considering:") { section = "sideboard"; continue; }
    if (lower === "deck:" || lower === "mainboard:" || lower === "main:") { section = "main"; continue; }
    const parsed = parseLine(line);
    if (!parsed) continue;
    if (section === "sideboard") sideboard.push(parsed);
    else main.push(parsed);
  }

  const commander = commanderName?.trim()
    || main[0]?.name
    || "";

  const norm = (n) => n.toLowerCase().replace(/\s+/g, " ");
  const mainFiltered = commander
    ? main.filter(e => norm(e.name) !== norm(commander))
    : main;

  const cardCount = mainFiltered.reduce((s, e) => s + e.qty, 0);

  return { main: mainFiltered, sideboard, commander, cardCount };
}

function parsePips(manaCost) {
  if (!manaCost) return { W:0, U:0, B:0, R:0, G:0, C:0 };
  const pips = { W:0, U:0, B:0, R:0, G:0, C:0 };
  for (const [, t] of manaCost.matchAll(/\{([^}]+)\}/g)) {
    if (["W","U","B","R","G"].includes(t)) pips[t]++;
    else if (t.includes("/")) {
      for (const p of t.split("/")) {
        if (["W","U","B","R","G"].includes(p)) pips[p] += 0.5;
        else pips.C += 0.5;
      }
    } else {
      const n = parseInt(t);
      pips.C += isNaN(n) ? 1 : n;
    }
  }
  return pips;
}

function getMC(card) {
  if (!card) return null;
  if (card.mana_cost) return card.mana_cost;
  return card.card_faces?.[0]?.mana_cost ?? null;
}

function isLand(card) {
  return !!card?.type_line?.toLowerCase().includes("land");
}

async function fetchScryfall(names, onProgress) {
  const unique = [...new Set(names.filter(n => !BASICS.has(n)))];
  const results = {};
  for (const name of names) {
    if (BASICS.has(name)) {
      results[name] = {
        name,
        cmc: 0,
        mana_cost: "",
        oracle_text: "",
        type_line: "Basic Land",
      };
    }
  }
  const notFound = [];
  const batchSize = 20;
  const total = Math.ceil(unique.length / batchSize);

  for (let i = 0; i < unique.length; i += batchSize) {
    const batch = unique.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    onProgress(`Fetching card data from Scryfall… batch ${batchNum} of ${total} (${batch.length} cards)`);

    try {
      const res = await fetch("https://api.scryfall.com/cards/collection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifiers: batch.map(name => ({ name })) })
      });
      const data = await res.json();
      for (const card of (data.data || [])) {
        results[card.name] = card;
        // Also index by the name we searched (handles DFC name mismatches)
        const searched = batch.find(n =>
          card.name.toLowerCase().startsWith(n.toLowerCase().split(" // ")[0]) ||
          n.toLowerCase() === card.name.toLowerCase()
        );
        if (searched && searched !== card.name) results[searched] = card;
      }
      for (const nf of (data.not_found || [])) notFound.push(nf.name);
    } catch (e) {
      console.warn("Scryfall batch failed:", e);
    }
  }
  return { results, notFound };
}

function extractJSON(text) {
  const stripped = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    return JSON.parse(stripped);
  } catch {
    const start = stripped.indexOf("{");
    const end = stripped.lastIndexOf("}");
    if (start >= 0 && end > start) {
      const slice = stripped.slice(start, end + 1);
      try {
        return JSON.parse(slice);
      } catch {
        const lastBrace = slice.lastIndexOf("}");
        if (lastBrace > 0) return JSON.parse(slice.slice(0, lastBrace + 1) + "}");
      }
    }
    throw new Error("Could not parse analysis response.");
  }
}

async function runRemoteAnalysis(prompt) {
  try {
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    const data = await res.json();
    if (data.skipped) return null;
    if (!res.ok || data.error) throw new Error(data.error?.message || "Analysis API error");
    const text = (data.content || []).map(b => b.type === "text" ? b.text : "").join("");
    if (!text) throw new Error("Empty analysis response.");
    return extractJSON(text);
  } catch (e) {
    console.warn("Remote analysis unavailable; using local analysis.", e);
    return null;
  }
}

function buildAnalysisPrompt(commanderName, deck, cardMap) {
  const cmdCard = cardMap[commanderName];
  const cmdCmc = cmdCard?.cmc ?? 0;

  const cardInfo = (name) => {
    // Try exact match, then front-face match
    const c = cardMap[name] || cardMap[name.split(" // ")[0]];
    if (!c) return `${name}: [data not found]`;
    const mc = getMC(c) || "none";
    const text = (c.oracle_text || c.card_faces?.[0]?.oracle_text || "").replace(/\n/g," ").slice(0,180);
    return `${name}: CMC=${c.cmc} MC=${mc} Type="${c.type_line}" Text="${text}"`;
  };

  const nonLand = deck.main.filter(e => !isLand(cardMap[e.name] || cardMap[e.name.split(" // ")[0]]));
  const lands = deck.main.filter(e => isLand(cardMap[e.name] || cardMap[e.name.split(" // ")[0]]));
  const landCount = lands.reduce((s, e) => s + e.qty, 0);

  return `You are an expert MTG Commander analyst. Use ONLY the card data below — no outside knowledge of stats or costs.

COMMANDER: ${commanderName} (CMC ${cmdCmc})
${cardInfo(commanderName)}

MAIN DECK — non-land (${nonLand.length} cards):
${nonLand.map(e => cardInfo(e.name)).join("\n")}

LANDS: ${landCount} total (${lands.map(e => `${e.qty}x ${e.name}`).join(", ")})

SIDEBOARD / CONSIDERING (player wants to add these — analyze separately):
${deck.sideboard.map(e => cardInfo(e.name)).join("\n")}

Produce a complete deck analysis as JSON. Be specific. Name real cards. Be direct. No fluff.

SCORING RULES (integers -10 to +10, clamp):
+3 Core synergy piece enabling win condition or cluster
+2 Strong standalone value in these colors OR fills critical gap (ramp/removal/draw)
+2 Enables multiple synergy clusters
+1 Efficient CMC for its role; instant-speed interaction; grants evasion/haste
-2 CMC equals commander CMC (${cmdCmc}) — curve conflict at most important mana value
-2 CMC 5+ creature/artifact with no synergy or ramp justification (verify from data)
-2 Low strategy synergy — generic filler not advancing the game plan
-2 Win-more (only good when already winning)
-1 Sorcery-speed interaction; slow value generation; narrow/conditional effect
Include ALL non-land main deck cards in scores[].

Return ONLY this JSON (no markdown, no explanation):
{
  "strategy": "2-3 sentence game plan",
  "stats": { "landCount": N, "rampCount": N, "avgCmc": N.NN, "boardWipeCount": N, "removalCount": N },
  "colorPips": { "W": N, "U": N, "B": N, "R": N, "G": N, "C": N },
  "splashNote": "splash color analysis or 'No splash detected'",
  "consistencyFlags": [ { "ok": bool, "text": "description" } ],
  "synergyClusters": [ { "name": "name", "cards": ["c1","c2"], "desc": "one sentence" } ],
  "weaknesses": [ { "severity": "critical|warning|minor", "label": "short label", "desc": "explanation" } ],
  "scores": [ { "name": "card name", "score": N, "note": "required if score<=-3 or >=6, else omit" } ],
  "sideboardAnalysis": [ { "name": "card name", "recommendation": "add|maybe|skip", "reason": "one sentence including what to cut if adding" } ],
  "upgrades": [ { "cut": "name", "cutScore": N, "add": "name", "reason": "one sentence", "expensive": bool } ]
}`;
}

function findCard(cardMap, name) {
  if (!name) return null;
  const frontName = name.split(" // ")[0];
  return cardMap[name] || cardMap[frontName] || null;
}

function getCardText(card) {
  if (!card) return "";
  const faceText = (card.card_faces || []).map(face => face.oracle_text || "").join(" ");
  return [card.oracle_text, faceText].filter(Boolean).join(" ").toLowerCase();
}

function getTypeLine(card) {
  return (card?.type_line || "").toLowerCase();
}

function hasAny(text, patterns) {
  return patterns.some(pattern => pattern.test(text));
}

function isLandCard(name, card) {
  return BASICS.has(name) || isLand(card);
}

const ROLE_PATTERNS = {
  ramp: [
    /add \{?[wubrgc]/,
    /treasure token/,
    /search your library.*land/,
    /put .*land card.*battlefield/,
  ],
  draw: [
    /draw (a|one|two|three|four|\d+|x) cards?/,
    /draw cards equal/,
    /investigate/,
    /clue token/,
    /impulse draw/,
  ],
  removal: [
    /destroy target/,
    /exile target/,
    /counter target/,
    /deals? \d+ damage to (any target|target)/,
    /return target .*owner's hand/,
    /target .* gets -\d/,
    /target player sacrifices/,
    /target opponent sacrifices/,
  ],
  boardWipe: [
    /destroy all/,
    /exile all/,
    /all creatures/,
    /each creature/,
    /each opponent sacrifices a creature/,
    /deals? \d+ damage to each/,
  ],
  protection: [
    /indestructible/,
    /hexproof/,
    /protection from/,
    /phase out/,
    /can't be countered/,
  ],
  tutor: [
    /search your library for .*card/,
    /search your library for .*put .*into your hand/,
  ],
};

const SIGNALS = [
  {
    key: "spells",
    name: "Spells and Copy Effects",
    desc: "These cards reward casting, copying, or recurring instants and sorceries.",
    test: (card) => {
      const text = getCardText(card);
      const type = getTypeLine(card);
      return type.includes("instant") || type.includes("sorcery") || /instant|sorcery|copy|cast/.test(text);
    },
  },
  {
    key: "tokens",
    name: "Token Pressure",
    desc: "These cards create, multiply, or benefit from token bodies and token artifacts.",
    test: (card) => /token|create/.test(getCardText(card)),
  },
  {
    key: "artifacts",
    name: "Artifact Engine",
    desc: "These cards either are artifacts or directly care about artifact resources.",
    test: (card) => getTypeLine(card).includes("artifact") || /artifact|treasure|clue|food/.test(getCardText(card)),
  },
  {
    key: "graveyard",
    name: "Graveyard Value",
    desc: "These cards use the graveyard as a resource for recursion, casting, or payoff loops.",
    test: (card) => /graveyard|return .*from your graveyard|escape|flashback|unearth|reanimate/.test(getCardText(card)),
  },
  {
    key: "counters",
    name: "Counters and Scaling",
    desc: "These cards add counters or convert counters into larger threats and board growth.",
    test: (card) => /counter on|counters on|\+1\/\+1 counter|proliferate/.test(getCardText(card)),
  },
  {
    key: "sacrifice",
    name: "Sacrifice Payoffs",
    desc: "These cards turn sacrifice triggers and expendable permanents into pressure or value.",
    test: (card) => /sacrifice|dies|whenever .* dies/.test(getCardText(card)),
  },
  {
    key: "combat",
    name: "Combat Pressure",
    desc: "These cards improve attacks through evasion, extra combat value, haste, or combat damage triggers.",
    test: (card) => /attacks|combat damage|haste|flying|trample|menace|double strike/.test(getCardText(card)),
  },
];

function getRoles(card) {
  const text = getCardText(card);
  const type = getTypeLine(card);
  const boardWipe = hasAny(text, ROLE_PATTERNS.boardWipe);
  return {
    ramp: hasAny(text, ROLE_PATTERNS.ramp) || (type.includes("artifact") && /add \{?[wubrgc]/.test(text)),
    draw: hasAny(text, ROLE_PATTERNS.draw),
    removal: !boardWipe && hasAny(text, ROLE_PATTERNS.removal),
    boardWipe,
    protection: hasAny(text, ROLE_PATTERNS.protection),
    tutor: hasAny(text, ROLE_PATTERNS.tutor),
  };
}

function getNonLandEntries(deck, cardMap) {
  return deck.main.filter(entry => !isLandCard(entry.name, findCard(cardMap, entry.name)));
}

function getLandEntries(deck, cardMap) {
  return deck.main.filter(entry => isLandCard(entry.name, findCard(cardMap, entry.name)));
}

function getSharedSignals(card, commanderCard) {
  if (!card || !commanderCard) return [];
  const cardSignals = SIGNALS.filter(signal => signal.test(card)).map(signal => signal.key);
  const commanderSignals = SIGNALS.filter(signal => signal.test(commanderCard)).map(signal => signal.key);
  return cardSignals.filter(signal => commanderSignals.includes(signal));
}

function clampScore(score) {
  return Math.max(-10, Math.min(10, Math.round(score)));
}

function scoreEntry(entry, cardMap, commanderCard, stats) {
  const card = findCard(cardMap, entry.name);
  const roles = getRoles(card);
  const type = getTypeLine(card);
  const cmc = card?.cmc ?? 0;
  const commanderCmc = commanderCard?.cmc ?? null;
  const sharedSignals = getSharedSignals(card, commanderCard);
  const reasons = [];
  let score = 0;

  if (roles.ramp) {
    score += stats.rampCount < 10 ? 3 : 2;
    reasons.push("ramp");
  }
  if (roles.draw || roles.tutor) {
    score += 2;
    reasons.push(roles.tutor ? "selection" : "card flow");
  }
  if (roles.removal) {
    score += stats.removalCount < 5 ? 3 : 2;
    reasons.push("interaction");
  }
  if (roles.boardWipe) {
    score += stats.boardWipeCount < 3 ? 3 : 2;
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
  if (cmc <= 2 && (roles.ramp || roles.removal || roles.draw || roles.protection)) {
    score += 1;
    reasons.push("efficient");
  }
  if (type.includes("instant") && roles.removal) {
    score += 1;
    reasons.push("instant-speed");
  }
  if (commanderCmc !== null && cmc === commanderCmc) {
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
  const result = { name: entry.name, score: finalScore };
  if (finalScore <= -3 || finalScore >= 6 || reasons.length) {
    result.note = reasons.slice(0, 3).join(", ");
  }
  return result;
}

function countRole(entries, cardMap, role) {
  return entries.reduce((sum, entry) => {
    const card = findCard(cardMap, entry.name);
    return sum + (getRoles(card)[role] ? entry.qty : 0);
  }, 0);
}

function buildColorPips(entries, cardMap) {
  const pips = { W:0, U:0, B:0, R:0, G:0, C:0 };
  for (const entry of entries) {
    const card = findCard(cardMap, entry.name);
    const cardPips = parsePips(getMC(card));
    for (const key of Object.keys(pips)) pips[key] += cardPips[key] * entry.qty;
  }
  return pips;
}

function buildSplashNote(colorPips) {
  const colored = ["W","U","B","R","G"]
    .map(key => ({ key, count: colorPips[key] || 0 }))
    .filter(item => item.count > 0)
    .sort((a, b) => b.count - a.count);
  const total = colored.reduce((sum, item) => sum + item.count, 0);

  if (!total) return "No colored pips detected from the available card data.";
  if (colored.length === 1) return `This is a focused ${COLOR_LABEL[colored[0].key]} deck with no splash pressure in the visible mana costs.`;

  const smallest = colored[colored.length - 1];
  const share = smallest.count / total;
  if (share < 0.15) {
    return `${COLOR_LABEL[smallest.key]} looks like a light splash at ${Math.round(share * 100)}% of colored pips; make sure the mana base can support early plays in the main colors first.`;
  }
  return "No obvious splash detected; colored requirements look reasonably distributed from the visible mana costs.";
}

function buildSynergyClusters(nonLandEntries, cardMap) {
  const clusters = [];
  for (const signal of SIGNALS) {
    const cards = nonLandEntries
      .filter(entry => signal.test(findCard(cardMap, entry.name)))
      .map(entry => entry.name)
      .slice(0, 6);
    if (cards.length >= 2) clusters.push({ name: signal.name, cards, desc: signal.desc });
  }
  if (!clusters.length) {
    const roleCards = nonLandEntries
      .filter(entry => {
        const roles = getRoles(findCard(cardMap, entry.name));
        return roles.ramp || roles.draw || roles.removal;
      })
      .map(entry => entry.name)
      .slice(0, 6);
    if (roleCards.length) {
      clusters.push({
        name: "Role Coverage",
        cards: roleCards,
        desc: "These cards cover the deck's basic ramp, card flow, and interaction needs.",
      });
    }
  }
  return clusters.slice(0, 4);
}

function buildConsistencyFlags(stats) {
  return [
    { ok: stats.landCount >= 36 && stats.landCount <= 40, text: `${stats.landCount} lands measured against a 36-38 Commander baseline.` },
    { ok: stats.rampCount >= 8, text: `${stats.rampCount} ramp pieces found; 10-12 is a comfortable target for many decks.` },
    { ok: stats.avgCmc <= 3.2, text: `Average mana value is ${stats.avgCmc}; lower curves recover faster after disruption.` },
    { ok: stats.boardWipeCount >= 2, text: `${stats.boardWipeCount} board wipes found; most Commander decks want at least 2.` },
    { ok: stats.removalCount >= 3, text: `${stats.removalCount} targeted interaction pieces found; 3-5 is a healthy starting range.` },
  ];
}

function buildWeaknesses(stats) {
  const weaknesses = [];
  if (stats.landCount < 36) weaknesses.push({ severity:"critical", label:"Low land count", desc:"The deck may miss land drops before its engine comes online." });
  if (stats.landCount > 40) weaknesses.push({ severity:"warning", label:"High land count", desc:"The deck may flood unless the commander or land package converts lands into value." });
  if (stats.rampCount < 8) weaknesses.push({ severity:"critical", label:"Needs more ramp", desc:"The ramp count is below the usual Commander floor, which can make expensive hands stumble." });
  if (stats.avgCmc > 3.2) weaknesses.push({ severity:"warning", label:"Heavy curve", desc:"The average mana value is above the target, so early turns may be slower than the table." });
  if (stats.removalCount < 3) weaknesses.push({ severity:"warning", label:"Thin interaction", desc:"The deck may struggle to answer must-kill engines or combo pieces on time." });
  if (stats.boardWipeCount < 2) weaknesses.push({ severity:"minor", label:"Few reset buttons", desc:"The deck has limited ways to catch up when opponents build a wider board." });
  if (!weaknesses.length) weaknesses.push({ severity:"minor", label:"No major structural gap", desc:"The core land, ramp, curve, wipe, and interaction counts are within normal Commander ranges." });
  return weaknesses;
}

function buildSideboardAnalysis(deck, cardMap, commanderCard, stats, scores) {
  const lowest = [...scores].sort((a, b) => a.score - b.score)[0];
  return deck.sideboard.map(entry => {
    const scored = scoreEntry(entry, cardMap, commanderCard, stats);
    const card = findCard(cardMap, entry.name);
    const roles = getRoles(card);
    let recommendation = "maybe";
    if ((roles.ramp && stats.rampCount < 10) || (roles.removal && stats.removalCount < 5) || (roles.boardWipe && stats.boardWipeCount < 3) || scored.score >= 4) {
      recommendation = "add";
    } else if (scored.score <= 0) {
      recommendation = "skip";
    }
    const cutText = lowest ? ` Consider testing it over ${lowest.name}.` : "";
    return {
      name: entry.name,
      recommendation,
      reason: recommendation === "add"
        ? `It fills a visible deck need or overlaps with the commander plan.${cutText}`
        : recommendation === "skip"
          ? "It does not clearly solve a measured weakness from the available card data."
          : `It is plausible, but the local pass does not see it as mandatory.${cutText}`,
    };
  });
}

function buildUpgrades(stats, scores, sideboardAnalysis) {
  const cuts = [...scores].sort((a, b) => a.score - b.score).slice(0, 4);
  const adds = sideboardAnalysis.filter(item => item.recommendation !== "skip");

  if (adds.length) {
    return adds.slice(0, 4).map((add, index) => {
      const cut = cuts[index] || cuts[0] || { name:"Lowest-impact slot", score:0 };
      return {
        cut: cut.name,
        cutScore: cut.score,
        add: add.name,
        reason: add.reason,
        expensive: false,
      };
    });
  }

  const suggestedAdd = stats.rampCount < 8
    ? "Additional two-mana ramp"
    : stats.removalCount < 3
      ? "Flexible targeted removal"
      : stats.boardWipeCount < 2
        ? "Additional board wipe"
        : "High-synergy engine piece";

  return cuts.slice(0, 3).map(cut => ({
    cut: cut.name,
    cutScore: cut.score,
    add: suggestedAdd,
    reason: "Use this slot to shore up the clearest measured gap from the local analysis.",
    expensive: false,
  }));
}

function buildLocalAnalysis(commanderName, deck, cardMap) {
  const commanderCard = findCard(cardMap, commanderName);
  const nonLandEntries = getNonLandEntries(deck, cardMap);
  const landEntries = getLandEntries(deck, cardMap);
  const nonLandQty = nonLandEntries.reduce((sum, entry) => sum + entry.qty, 0);
  const avgCmc = nonLandQty
    ? nonLandEntries.reduce((sum, entry) => sum + ((findCard(cardMap, entry.name)?.cmc ?? 0) * entry.qty), 0) / nonLandQty
    : 0;
  const stats = {
    landCount: landEntries.reduce((sum, entry) => sum + entry.qty, 0),
    rampCount: countRole(nonLandEntries, cardMap, "ramp"),
    avgCmc: Math.round(avgCmc * 100) / 100,
    boardWipeCount: countRole(nonLandEntries, cardMap, "boardWipe"),
    removalCount: countRole(nonLandEntries, cardMap, "removal"),
  };
  const colorPips = buildColorPips([{ qty:1, name:commanderName }, ...nonLandEntries], cardMap);
  const synergyClusters = buildSynergyClusters(nonLandEntries, cardMap);
  const scores = nonLandEntries.map(entry => scoreEntry(entry, cardMap, commanderCard, stats));
  const sideboardAnalysis = buildSideboardAnalysis(deck, cardMap, commanderCard, stats, scores);
  const clusterText = synergyClusters.length
    ? synergyClusters.slice(0, 2).map(cluster => cluster.name.toLowerCase()).join(" and ")
    : "role coverage and curve discipline";

  return {
    strategy: `This deck appears to lean on ${clusterText}. The local pass prioritizes cards that share commander-facing themes, keep the curve efficient, and cover ramp, interaction, card flow, and reset-button roles.`,
    stats,
    colorPips,
    splashNote: buildSplashNote(colorPips),
    consistencyFlags: buildConsistencyFlags(stats),
    synergyClusters,
    weaknesses: buildWeaknesses(stats),
    scores,
    sideboardAnalysis,
    upgrades: buildUpgrades(stats, scores, sideboardAnalysis),
  };
}

function mergeAnalysis(remoteAnalysis, localAnalysis) {
  if (!remoteAnalysis || typeof remoteAnalysis !== "object") return localAnalysis;
  return {
    ...localAnalysis,
    ...remoteAnalysis,
    stats: { ...localAnalysis.stats, ...(remoteAnalysis.stats || {}) },
    colorPips: { ...localAnalysis.colorPips, ...(remoteAnalysis.colorPips || {}) },
    consistencyFlags: Array.isArray(remoteAnalysis.consistencyFlags) ? remoteAnalysis.consistencyFlags : localAnalysis.consistencyFlags,
    synergyClusters: Array.isArray(remoteAnalysis.synergyClusters) ? remoteAnalysis.synergyClusters : localAnalysis.synergyClusters,
    weaknesses: Array.isArray(remoteAnalysis.weaknesses) ? remoteAnalysis.weaknesses : localAnalysis.weaknesses,
    scores: Array.isArray(remoteAnalysis.scores) ? remoteAnalysis.scores : localAnalysis.scores,
    sideboardAnalysis: Array.isArray(remoteAnalysis.sideboardAnalysis) ? remoteAnalysis.sideboardAnalysis : localAnalysis.sideboardAnalysis,
    upgrades: Array.isArray(remoteAnalysis.upgrades) ? remoteAnalysis.upgrades : localAnalysis.upgrades,
  };
}

export default function App() {
  const [cmdInput, setCmdInput] = useState("");
  const [deckInput, setDeckInput] = useState("");
  const [moxfieldUrl, setMoxfieldUrl] = useState("");
  const [analysis, setAnalysis] = useState(null);
  const [cardMap, setCardMap] = useState({});
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [sortCol, setSortCol] = useState("score");
  const [sortDir, setSortDir] = useState("asc");
  const [debugMode, setDebugMode] = useState(false);

  async function handleMoxfieldImport() {
    if (!moxfieldUrl) return;
    setLoading(true); setError(null);
    try {
        const match = moxfieldUrl.match(/moxfield\.com\/decks\/([a-zA-Z0-9_-]+)/);
        if (!match) throw new Error("Invalid Moxfield URL. Must contain /decks/ID");
        setProgress("Fetching from Moxfield API...");
        
        const res = await fetch(`https://api2.moxfield.com/v3/decks/all/${match[1]}`);
        if (!res.ok) throw new Error("Moxfield API Error");
        const data = await res.json();
        
        let importedList = "";
        const cmds = Object.values(data.boards?.commanders?.cards || {});
        if (cmds.length > 0) setCmdInput(cmds[0].card.name);
        
        const processBoard = (board) => {
            return Object.values(board || {}).map(c => `${c.quantity} ${c.card.name}`).join("\n");
        };

        importedList += processBoard(data.boards?.mainboard?.cards);
        
        const sb = processBoard(data.boards?.sideboard?.cards);
        if (sb) importedList += "\n\nSIDEBOARD:\n" + sb;
        
        setDeckInput(importedList);
    } catch (e) {
        setError(e.message);
    } finally {
        setLoading(false);
        setProgress("");
    }
  }

  async function runAnalysis() {
    if (!deckInput.trim()) { setError("Please paste your decklist."); return; }
    setLoading(true); setError(null); setAnalysis(null);

    try {
      const deck = parseDecklist(deckInput, cmdInput.trim());
      const commanderName = deck.commander;
      if (!commanderName) throw new Error("Could not determine commander. Enter a name or put the commander as the first line.");
      if (deck.main.length === 0) throw new Error("No cards parsed from decklist. Check the format and try again.");

      const allNames = [commanderName,
        ...deck.main.map(e => e.name),
        ...deck.sideboard.map(e => e.name)
      ].filter((n,i,a) => a.indexOf(n) === i);

      const { results, notFound } = await fetchScryfall(allNames, setProgress);
      setCardMap(results);

      if (notFound.length) console.warn("Not found on Scryfall:", notFound);

      setProgress(`Running deck analysis… (${deck.cardCount} mainboard cards, ${deck.sideboard.length} considering)`);

      const localAnalysis = buildLocalAnalysis(commanderName, deck, results);
      const prompt = buildAnalysisPrompt(commanderName, deck, results);
      const remoteAnalysis = await runRemoteAnalysis(prompt);
      const parsed = mergeAnalysis(remoteAnalysis, localAnalysis);

      setAnalysis({ ...parsed, notFound, commanderName });
      setActiveTab("overview");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false); setProgress("");
    }
  }

  function scoreColor(s) {
    if (s >= 7) return "text-green-400 font-bold";
    if (s >= 4) return "text-green-300";
    if (s >= 1) return "text-gray-300";
    if (s === 0) return "text-gray-500";
    if (s >= -2) return "text-orange-300";
    if (s >= -5) return "text-red-400";
    return "text-red-500 font-bold";
  }

  function toggleSort(col) {
    if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir("asc"); }
  }

  const tabs = [
    { id:"overview", label:"🧙 Overview" },
    { id:"colors",   label:"🎨 Colors" },
    { id:"curve",    label:"📈 Curve" },
    { id:"synergies",label:"⚔️ Synergies" },
    { id:"weaknesses",label:"🛡️ Weaknesses" },
    { id:"scores",   label:"🃏 Scores" },
    { id:"sideboard",label:"🔄 Considering" },
    { id:"upgrades", label:"✨ Upgrades" },
  ];

  const a = analysis;

  const sortedScores = a ? [...(a.scores||[])].sort((x,y) => {
    if (sortCol==="score") return sortDir==="asc" ? x.score-y.score : y.score-x.score;
    if (sortCol==="name")  return sortDir==="asc" ? x.name.localeCompare(y.name) : y.name.localeCompare(x.name);
    return 0;
  }) : [];

  const pipData = a ? Object.entries(a.colorPips||{})
    .filter(([,v])=>v>0)
    .map(([k,v])=>{
      const tot = Object.values(a.colorPips).reduce((s,n)=>s+n,0);
      return { key:k, label:COLOR_LABEL[k]||k, count:Math.round(v*10)/10, pct:Math.round(v/tot*1000)/10, hex:COLOR_HEX[k]||"#888" };
    }) : [];

  const cmcBuckets = a ? (() => {
    const b = {};
    let maxCmc = 0;
    const cardCmcs = (a.scores || []).map(s => {
      const c = cardMap[s.name] || cardMap[s.name?.split(" // ")[0]];
      return Math.floor(c?.cmc ?? 0);
    });
    maxCmc = Math.max(0, ...cardCmcs);
    for (let i = 0; i <= maxCmc; i++) b[i.toString()] = 0;
    for (const c of cardCmcs) b[c.toString()]++;
    return Object.entries(b).map(([k, v]) => ({ cmc: k, count: v }));
  })() : [];

  // Input screen
  if (!a && !loading) return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
      <div className="bg-gradient-to-r from-red-950 via-gray-900 to-purple-950 border-b border-gray-800 px-6 py-5">
        <div className="text-xs text-red-400 uppercase tracking-widest mb-1">MTG Commander</div>
        <h1 className="text-2xl font-bold text-white">Deck Analyzer</h1>
        <p className="text-gray-400 text-sm mt-1">Mana, curve, synergy, and upgrade review</p>
      </div>
      <div className="flex-1 p-6 max-w-3xl mx-auto w-full flex flex-col gap-4">
        {/* Moxfield Import Section */}
        <div className="flex gap-2">
            <input 
                value={moxfieldUrl} 
                onChange={e => setMoxfieldUrl(e.target.value)} 
                placeholder="https://www.moxfield.com/decks/..." 
                className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-4 py-2.5 text-gray-100 text-sm focus:border-red-600"
            />
            <button onClick={handleMoxfieldImport} className="bg-gray-800 hover:bg-gray-700 text-white font-semibold py-2.5 px-4 rounded-lg border border-gray-700">Import (currently non-functional)</button>
        </div>
        <div>
          <label className="text-xs text-gray-400 uppercase tracking-widest block mb-1">
            Commander&nbsp;<span className="text-gray-600 normal-case">— optional if listed first in decklist</span>
          </label>
          <input
            value={cmdInput}
            onChange={e => setCmdInput(e.target.value)}
            placeholder="Magar of the Magic Strings"
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2.5 text-gray-100 text-sm focus:outline-none focus:border-red-600 placeholder-gray-600"
          />
        </div>
        <div className="flex-1 flex flex-col">
          <label className="text-xs text-gray-400 uppercase tracking-widest block mb-1">
            Decklist&nbsp;<span className="text-gray-600 normal-case">— paste Arena / Moxfield export. SIDEBOARD: = cards you're considering.</span>
          </label>
          <textarea
            value={deckInput}
            onChange={e => setDeckInput(e.target.value)}
            placeholder={"1 Magar of the Magic Strings (UNF) 457 *F*\n1 Arcane Signet (DSC) 92\n16 Mountain (SOS) 270\n...\nSIDEBOARD:\n1 Lightning Greaves (CMR) 234"}
            className="flex-1 min-h-80 bg-gray-900 border border-gray-700 rounded-xl p-4 text-sm text-gray-200 font-mono resize-y focus:outline-none focus:border-red-600 placeholder-gray-600"
            spellCheck={false}
          />
        </div>
        {error && <div className="text-red-400 text-sm bg-red-950 bg-opacity-50 border border-red-800 rounded-lg p-3">{error}</div>}
        <button onClick={runAnalysis}
          className="bg-red-700 hover:bg-red-600 active:bg-red-800 text-white font-bold py-3 px-8 rounded-xl transition-colors text-base">
          Analyze Deck →
        </button>
      </div>
    </div>
  );

  // Loading screen
  if (loading) return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center gap-5 text-center px-6">
      <div className="text-4xl animate-pulse">🃏</div>
      <div className="text-lg font-semibold text-red-400 max-w-sm">{progress || "Starting…"}</div>
      <div className="w-64 h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div className="h-full bg-red-500 rounded-full animate-pulse" style={{width:"60%"}}></div>
      </div>
      <div className="text-gray-600 text-xs">Powered by Scryfall</div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <div className="bg-gradient-to-r from-red-950 via-gray-900 to-purple-950 border-b border-gray-800 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-start justify-between gap-4">
          <div>
            <div className="text-xs text-red-400 uppercase tracking-widest mb-0.5">Commander Analysis</div>
            <h1 className="text-xl font-bold text-white">{a.commanderName}</h1>
            <div className="text-gray-400 text-sm mt-0.5">
              Avg CMC {a.stats?.avgCmc} · {a.stats?.landCount} lands · {a.stats?.rampCount} ramp
              {a.notFound?.length > 0 && <span className="text-yellow-400 ml-2">⚠️ {a.notFound.length} card(s) not found on Scryfall</span>}
            </div>
          </div>
          <button onClick={()=>{setAnalysis(null);setError(null);}} className="text-xs text-gray-500 hover:text-gray-300 border border-gray-700 rounded px-3 py-1.5 flex-shrink-0">← New Deck</button>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-800 bg-gray-900 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto flex overflow-x-auto">
          {tabs.map(t=>(
            <button key={t.id} onClick={()=>setActiveTab(t.id)}
              className={`px-4 py-3 text-sm whitespace-nowrap border-b-2 transition-colors ${activeTab===t.id?"border-red-500 text-red-400 font-semibold":"border-transparent text-gray-500 hover:text-gray-300"}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8">

        {/* OVERVIEW */}
        {activeTab==="overview" && (
          <div className="space-y-5">
            <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
              <div className="text-xs text-red-400 uppercase tracking-widest mb-2">Strategy</div>
              <p className="text-gray-300 leading-relaxed">{a.strategy}</p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {[
                {label:"Lands",       val:a.stats?.landCount,      flag:a.stats?.landCount<36||a.stats?.landCount>40, target:"36–38"},
                {label:"Ramp",        val:a.stats?.rampCount,      flag:a.stats?.rampCount<8,                         target:"10–12"},
                {label:"Avg CMC",     val:a.stats?.avgCmc,         flag:a.stats?.avgCmc>3.2,                          target:"≤ 3.2"},
                {label:"Board Wipes", val:a.stats?.boardWipeCount, flag:a.stats?.boardWipeCount<2,                    target:"2–3"},
                {label:"Removal",     val:a.stats?.removalCount,   flag:a.stats?.removalCount<3,                      target:"3–5"},
              ].map(s=>(
                <div key={s.label} className={`rounded-xl p-4 border text-center ${s.flag?"bg-red-950 border-red-800":"bg-gray-900 border-gray-800"}`}>
                  <div className="text-2xl font-bold text-white">{s.val??"-"}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{s.label}</div>
                  <div className={`text-xs mt-0.5 ${s.flag?"text-red-400":"text-gray-600"}`}>{s.target}</div>
                </div>
              ))}
            </div>
            <div className="space-y-2">
              {(a.consistencyFlags||[]).map((f,i)=>(
                <div key={i} className={`flex gap-2 text-sm rounded-lg p-3 ${f.ok?"text-green-400 bg-green-950 bg-opacity-30":"text-red-400 bg-red-950 bg-opacity-30"}`}>
                  <span>{f.ok?"✅":"⚠️"}</span><span>{f.text}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* COLORS */}
        {activeTab==="colors" && (
          <div className="space-y-5">
            <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
              <div className="text-xs text-red-400 uppercase tracking-widest mb-1">Mana Pip Distribution</div>
              <p className="text-xs text-gray-500 mb-4">All pips including generic/colorless. Colored pips will sum to less than 100% of total.</p>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={pipData} margin={{top:4,right:16,bottom:4,left:0}}>
                  <XAxis dataKey="label" tick={{fill:"#9ca3af",fontSize:11}}/>
                  <YAxis tick={{fill:"#9ca3af",fontSize:11}}/>
                  <Tooltip contentStyle={{background:"#111827",border:"1px solid #374151",borderRadius:8}}
                    formatter={(v,n,p)=>[`${p.payload.count} pips (${p.payload.pct}%)`,""]}/>
                  <Bar dataKey="count" radius={[4,4,0,0]}>
                    {pipData.map((d,i)=><Cell key={i} fill={d.hex}/>)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div className="mt-4 space-y-2">
                {pipData.map(d=>(
                  <div key={d.key} className="flex items-center gap-3">
                    <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{background:d.hex}}/>
                    <div className="text-sm text-gray-300 w-32">{d.label}</div>
                    <div className="flex-1 bg-gray-800 rounded h-1.5 overflow-hidden">
                      <div className="h-full rounded" style={{width:`${d.pct}%`,background:d.hex}}/>
                    </div>
                    <div className="text-sm text-gray-400 w-28 text-right">{d.count} ({d.pct}%)</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-gray-900 rounded-xl p-5 border border-gray-800">
              <div className="text-xs text-red-400 uppercase tracking-widest mb-2">Splash Analysis</div>
              <p className="text-gray-300 text-sm">{a.splashNote}</p>
            </div>
          </div>
        )}

        {/* CURVE */}
        {activeTab==="curve" && (
          <div className="space-y-5">
            <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
              <div className="text-xs text-red-400 uppercase tracking-widest mb-1">Mana Curve (Non-Land Cards)</div>
              <p className="text-sm text-gray-400 mb-4">
                Avg CMC: <span className={a.stats?.avgCmc>3.2?"text-red-400 font-bold":"text-green-400 font-bold"}>{a.stats?.avgCmc}</span>
                <span className="text-gray-600 ml-2">(target ≤ 3.2)</span>
              </p>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={cmcBuckets} margin={{top:4,right:16,bottom:4,left:0}}>
                  <XAxis dataKey="cmc" tick={{fill:"#9ca3af"}}/>
                  <YAxis tick={{fill:"#9ca3af"}}/>
                  <Tooltip contentStyle={{background:"#111827",border:"1px solid #374151",borderRadius:8}}/>
                  <Bar dataKey="count" fill="#ef4444" radius={[4,4,0,0]}/>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-2">
              {(a.consistencyFlags||[]).map((f,i)=>(
                <div key={i} className={`flex gap-2 text-sm rounded-lg p-3 ${f.ok?"text-green-400 bg-green-950 bg-opacity-30":"text-red-400 bg-red-950 bg-opacity-30"}`}>
                  <span>{f.ok?"✅":"⚠️"}</span><span>{f.text}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* SYNERGIES */}
        {activeTab==="synergies" && (
          <div className="space-y-3">
            {(a.synergyClusters||[]).map(c=>(
              <div key={c.name} className="bg-gray-900 rounded-xl p-5 border border-gray-800">
                <div className="font-bold text-red-400 mb-2">{c.name}</div>
                <div className="flex flex-wrap gap-1 mb-2">
                  {(c.cards||[]).map(card=>(
                    <span key={card} className="text-xs bg-gray-800 text-gray-300 px-2 py-0.5 rounded">{card}</span>
                  ))}
                </div>
                <p className="text-sm text-gray-400">{c.desc}</p>
              </div>
            ))}
          </div>
        )}

        {/* WEAKNESSES */}
        {activeTab==="weaknesses" && (
          <div className="space-y-3">
            {(a.weaknesses||[]).map((w,i)=>(
              <div key={i} className={`rounded-xl p-5 border ${w.severity==="critical"?"bg-red-950 border-red-800":w.severity==="warning"?"bg-yellow-950 border-yellow-800":"bg-gray-900 border-gray-800"}`}>
                <div className={`font-bold text-sm mb-1 ${w.severity==="critical"?"text-red-400":w.severity==="warning"?"text-yellow-400":"text-gray-400"}`}>
                  {w.severity==="critical"?"🔴 Critical":w.severity==="warning"?"🟡 Warning":"🔵 Minor"} — {w.label}
                </div>
                <p className="text-sm text-gray-300">{w.desc}</p>
              </div>
            ))}
          </div>
        )}

        {/* SCORES */}
        {activeTab==="scores" && (
          <div className="space-y-3">
            <p className="text-sm text-gray-500">Click headers to sort. -10 = cut immediately · +10 = core piece.</p>
            <div className="overflow-x-auto rounded-xl border border-gray-800">
              <table className="w-full text-sm">
                <thead className="bg-gray-900">
                  <tr>
                    {[["name","Card"],["score","Score"]].map(([col,lbl])=>(
                      <th key={col} onClick={()=>toggleSort(col)}
                        className="px-4 py-3 text-left text-gray-400 font-semibold cursor-pointer hover:text-white select-none">
                        {lbl} {sortCol===col?(sortDir==="asc"?"↑":"↓"):""}
                      </th>
                    ))}
                    <th className="px-4 py-3 text-left text-gray-400 font-semibold">CMC</th>
                    <th className="px-4 py-3 text-left text-gray-400 font-semibold">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedScores.map((card,i)=>{
                    const c = cardMap[card.name] || cardMap[card.name?.split(" // ")[0]];
                    return (
                      <tr key={card.name} className={`border-t border-gray-800 ${i%2===0?"bg-gray-950":"bg-gray-900"}`}>
                        <td className="px-4 py-2 text-gray-200">{card.name}</td>
                        <td className={`px-4 py-2 font-mono font-bold ${scoreColor(card.score)}`}>{card.score>0?"+":""}{card.score}</td>
                        <td className="px-4 py-2 text-gray-500 text-xs">{c?.cmc??"-"}</td>
                        <td className="px-4 py-2 text-gray-500 text-xs">{card.note||""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* SIDEBOARD / CONSIDERING */}
        {activeTab==="sideboard" && (
          <div className="space-y-3">
            <p className="text-sm text-gray-500">Cards you're actively considering adding — analyzed against current deck needs.</p>
            {(a.sideboardAnalysis||[]).length === 0 && <p className="text-gray-600 text-sm">No sideboard cards provided.</p>}
            {(a.sideboardAnalysis||[]).map((s,i)=>(
              <div key={i} className={`rounded-xl p-4 border flex gap-3 items-start ${s.recommendation==="add"?"bg-green-950 border-green-800":s.recommendation==="skip"?"bg-gray-900 border-gray-700":"bg-yellow-950 border-yellow-800"}`}>
                <div className={`text-xs font-bold uppercase px-2 py-0.5 rounded flex-shrink-0 mt-0.5 ${s.recommendation==="add"?"bg-green-700 text-green-100":s.recommendation==="skip"?"bg-gray-700 text-gray-300":"bg-yellow-700 text-yellow-100"}`}>
                  {s.recommendation}
                </div>
                <div>
                  <div className="text-sm font-semibold text-gray-200 mb-0.5">{s.name}</div>
                  <p className="text-sm text-gray-400">{s.reason}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* UPGRADES */}
        {activeTab==="upgrades" && (
          <div className="space-y-3">
            <p className="text-sm text-gray-500 mb-1">💸 = typically over ~$20.</p>
            {(a.upgrades||[]).map((u,i)=>(
              <div key={i} className="bg-gray-900 rounded-xl p-4 border border-gray-800 flex flex-col sm:flex-row gap-3 items-start sm:items-center">
                <div className="flex gap-3 items-center flex-shrink-0">
                  <div className="text-center" style={{minWidth:"96px"}}>
                    <div className="text-xs text-gray-500 mb-0.5">Cut</div>
                    <div className="text-sm text-red-400 font-semibold leading-tight">{u.cut}</div>
                    <div className={`text-xs font-mono mt-0.5 ${scoreColor(u.cutScore)}`}>{u.cutScore>0?"+":""}{u.cutScore}</div>
                  </div>
                  <div className="text-gray-600 text-xl">→</div>
                  <div className="text-center" style={{minWidth:"96px"}}>
                    <div className="text-xs text-gray-500 mb-0.5">Add {u.expensive?"💸":""}</div>
                    <div className="text-sm text-green-400 font-semibold leading-tight">{u.add}</div>
                  </div>
                </div>
                <p className="text-sm text-gray-400 sm:ml-2">{u.reason}</p>
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  );
}
