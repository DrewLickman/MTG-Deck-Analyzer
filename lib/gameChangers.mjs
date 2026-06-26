import { normalizeName } from "./cardUtils.mjs";

export const GAME_CHANGER_METADATA = {
  sourceQuery: "is:gamechanger",
  commanderPaperQuery: "(game:paper) legal:commander is:gamechanger",
  generatedAt: "2026-06-26",
  expectedCount: 53,
  cardCount: 53,
  commanderPaperCount: 53,
};

export const GAME_CHANGERS = [
  "Ad Nauseam",
  "Ancient Tomb",
  "Aura Shards",
  "Biorhythm",
  "Bolas's Citadel",
  "Braids, Cabal Minion",
  "Chrome Mox",
  "Coalition Victory",
  "Consecrated Sphinx",
  "Crop Rotation",
  "Cyclonic Rift",
  "Demonic Tutor",
  "Drannith Magistrate",
  "Enlightened Tutor",
  "Farewell",
  "Field of the Dead",
  "Fierce Guardianship",
  "Force of Will",
  "Gaea's Cradle",
  "Gamble",
  "Gifts Ungiven",
  "Glacial Chasm",
  "Grand Arbiter Augustin IV",
  "Grim Monolith",
  "Humility",
  "Imperial Seal",
  "Intuition",
  "Jeska's Will",
  "Lion's Eye Diamond",
  "Mana Vault",
  "Mishra's Workshop",
  "Mox Diamond",
  "Mystical Tutor",
  "Narset, Parter of Veils",
  "Natural Order",
  "Necropotence",
  "Notion Thief",
  "Opposition Agent",
  "Orcish Bowmasters",
  "Panoptic Mirror",
  "Rhystic Study",
  "Seedborn Muse",
  "Serra's Sanctum",
  "Smothering Tithe",
  "Survival of the Fittest",
  "Teferi's Protection",
  "Tergrid, God of Fright // Tergrid's Lantern",
  "Thassa's Oracle",
  "The One Ring",
  "The Tabernacle at Pendrell Vale",
  "Underworld Breach",
  "Vampiric Tutor",
  "Worldly Tutor",
];

export const GAME_CHANGER_SET = new Set(GAME_CHANGERS.map(normalizeName));

export function validateGameChangerStaticData() {
  const unique = new Set(GAME_CHANGERS.map(normalizeName));
  return {
    ok: GAME_CHANGERS.length === GAME_CHANGER_METADATA.expectedCount && unique.size === GAME_CHANGERS.length,
    count: GAME_CHANGERS.length,
    expectedCount: GAME_CHANGER_METADATA.expectedCount,
    duplicateCount: GAME_CHANGERS.length - unique.size,
  };
}
