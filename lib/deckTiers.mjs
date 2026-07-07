import { findCard, getRoleKeys, normalizeName } from "./cardUtils.mjs";

export const TIER_ORDER = ["S", "A", "B", "C", "D", "F"];

const SMALL_POOL_LIMIT = 12;

function normalizedDecision(cutDecisions = {}, name) {
  const key = normalizeName(name);
  return cutDecisions[key] || cutDecisions[name] || null;
}

export function adjustedTierScore(item) {
  const score = Number.isFinite(item.score) ? item.score : 0;
  const candidate = item.cutCandidate;
  const rank = Number.isFinite(candidate?.rank) ? candidate.rank : 0;

  if (candidate?.sizeCutRecommended) return score - 8;
  if (candidate?.confidence === "high" || rank >= 6) return score - 4;
  if (candidate?.confidence === "medium" || rank >= 3) return score - 2;
  return score;
}

function scoreBandTier(item) {
  const adjustedScore = item.adjustedScore ?? adjustedTierScore(item);
  if (adjustedScore >= 7) return "S";
  if (adjustedScore >= 5) return "A";
  if (adjustedScore >= 2) return "B";
  if (adjustedScore >= 0) return "C";
  if (adjustedScore >= -3) return "D";
  return "F";
}

function percentileTier(index, total) {
  const sCut = Math.ceil(total * 0.08);
  const aCut = Math.ceil(total * 0.25);
  const bCut = Math.ceil(total * 0.60);
  const cCut = Math.ceil(total * 0.85);
  const dCut = Math.ceil(total * 0.95);

  if (index < sCut) return "S";
  if (index < aCut) return "A";
  if (index < bCut) return "B";
  if (index < cCut) return "C";
  if (index < dCut) return "D";
  return "F";
}

function keepAtLeastC(tier, decision) {
  if (decision !== "keep") return tier;
  return tier === "D" || tier === "F" ? "C" : tier;
}

export function tierForCard(item, context = {}) {
  const decision = context.decision ?? item.decision;
  if (decision === "cut" || item.cutCandidate?.sizeCutRecommended) return "F";
  if (item.protected || item.zone === "commanders") return "S";

  const baseTier = context.totalCards >= SMALL_POOL_LIMIT && Number.isInteger(context.index)
    ? percentileTier(context.index, context.totalCards)
    : scoreBandTier(item);

  return keepAtLeastC(baseTier, decision);
}

export function buildTierItems({ analysis = {}, cardMap = {}, cutDecisions = {} }) {
  const cutCandidates = analysis.cutCandidates || [];
  const cutsByName = new Map(cutCandidates.map((candidate) => [normalizeName(candidate.name), candidate]));
  const itemsByName = new Map();

  for (const score of analysis.scores || []) {
    const key = normalizeName(score.name);
    const card = findCard(cardMap, score.name);
    const cutCandidate = cutsByName.get(key);
    itemsByName.set(key, {
      name: score.name,
      score: score.score,
      adjustedScore: 0,
      note: score.note,
      roles: score.roles?.length ? score.roles : getRoleKeys(card),
      protected: Boolean(score.protected),
      zone: score.zone,
      card,
      cutCandidate,
      decision: normalizedDecision(cutDecisions, score.name),
    });
  }

  for (const candidate of cutCandidates) {
    const key = normalizeName(candidate.name);
    if (itemsByName.has(key)) continue;
    const card = findCard(cardMap, candidate.name);
    itemsByName.set(key, {
      name: candidate.name,
      score: candidate.score ?? 0,
      adjustedScore: 0,
      note: candidate.cutReason?.[0] || candidate.reasons?.[0],
      roles: candidate.roles?.length ? candidate.roles : getRoleKeys(card),
      protected: Boolean(candidate.protected),
      zone: "main",
      card,
      cutCandidate: candidate,
      decision: normalizedDecision(cutDecisions, candidate.name),
    });
  }

  return [...itemsByName.values()].map((item) => ({
    ...item,
    adjustedScore: adjustedTierScore(item),
  }));
}

export function buildTierRows({ analysis = {}, cardMap = {}, cutDecisions = {} }) {
  const items = buildTierItems({ analysis, cardMap, cutDecisions });
  const rows = Object.fromEntries(TIER_ORDER.map((tier) => [tier, []]));
  const forcedItems = [];
  const rankedItems = [];

  for (const item of items) {
    if (item.decision === "cut" || item.cutCandidate?.sizeCutRecommended || item.protected || item.zone === "commanders") {
      forcedItems.push(item);
    } else {
      rankedItems.push(item);
    }
  }

  rankedItems.sort((a, b) => b.adjustedScore - a.adjustedScore || b.score - a.score || a.name.localeCompare(b.name));

  for (const item of forcedItems) {
    const tier = tierForCard(item);
    rows[tier].push({ ...item, tier });
  }

  for (const [index, item] of rankedItems.entries()) {
    const tier = tierForCard(item, { index, totalCards: rankedItems.length });
    rows[tier].push({ ...item, tier });
  }

  return TIER_ORDER.map((tier) => ({
    tier,
    cards: rows[tier].sort((a, b) => {
      if (tier === "F" || tier === "D") {
        const aRank = a.cutCandidate?.rank ?? -99;
        const bRank = b.cutCandidate?.rank ?? -99;
        return bRank - aRank || a.adjustedScore - b.adjustedScore || a.name.localeCompare(b.name);
      }
      return b.adjustedScore - a.adjustedScore || b.score - a.score || a.name.localeCompare(b.name);
    }),
  }));
}
