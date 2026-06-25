export const SCRYFALL_BATCH_SIZE = 75;
export const MIN_SCORE = -10;
export const MAX_SCORE = 10;
export const TARGET_LANDS_MIN = 36;
export const TARGET_LANDS_MAX = 40;
export const TARGET_RAMP_MIN = 10;
export const TARGET_RAMP_CRIT = 8;
export const TARGET_REMOVAL_MIN = 5;
export const TARGET_REMOVAL_CRIT = 3;
export const TARGET_WIPES_MIN = 3;
export const TARGET_WIPES_CRIT = 2;
export const TARGET_AVG_CMC = 3.2;
export const SPLASH_THRESHOLD = 0.15;

export const COLOR_HEX = {
  W: "#f5e7a1",
  U: "#6ab0e8",
  B: "#b6a3d7",
  R: "#f36f5f",
  G: "#63c184",
  C: "#a1a1aa",
};

export const COLOR_LABEL = {
  W: "White",
  U: "Blue",
  B: "Black",
  R: "Red",
  G: "Green",
  C: "Colorless/Generic",
};

export const BASICS = new Set(["Mountain", "Swamp", "Island", "Forest", "Plains", "Wastes"]);

export function normalizeName(name = "") {
  return name
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[’']/g, "'")
    .trim();
}

export function parseCardLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const qtyMatch = trimmed.match(/^(\d+)\s+(.+)$/);
  if (!qtyMatch) return null;

  const qty = parseInt(qtyMatch[1], 10);
  let rest = qtyMatch[2].replace(/\s*\*F\*?\s*$/i, "").trim();

  rest = rest.replace(/\s+\([A-Z0-9]+\)\s+[\w-]+(?:[a-z])?\s*$/i, "");
  rest = rest.replace(/\s+\([A-Z0-9]+\)\s*$/i, "");

  let name = rest.trim();
  if (!name) return null;

  name = name.replace(/\s+\/\s+/, " // ");
  return { qty, name };
}

export function makeBasicLandCard(name) {
  return {
    name,
    cmc: 0,
    mana_cost: "",
    oracle_text: "",
    type_line: "Basic Land",
    legalities: { commander: "legal" },
  };
}

export function getManaCost(card) {
  if (!card) return null;
  if (card.mana_cost) return card.mana_cost;
  return card.card_faces?.[0]?.mana_cost ?? null;
}

export function parsePips(manaCost) {
  if (!manaCost) return { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  const pips = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  for (const [, token] of manaCost.matchAll(/\{([^}]+)\}/g)) {
    if (["W", "U", "B", "R", "G"].includes(token)) pips[token]++;
    else if (token.includes("/")) {
      for (const piece of token.split("/")) {
        if (["W", "U", "B", "R", "G"].includes(piece)) pips[piece] += 0.5;
        else pips.C += 0.5;
      }
    } else {
      const numeric = parseInt(token, 10);
      pips.C += Number.isNaN(numeric) ? 1 : numeric;
    }
  }
  return pips;
}

export function findCard(cardMap, name) {
  if (!name) return null;
  const frontName = name.split(" // ")[0];
  return cardMap[name] || cardMap[frontName] || null;
}

export function getCardText(card) {
  if (!card) return "";
  const faceText = (card.card_faces || []).map((face) => face.oracle_text || "").join(" ");
  return [card.oracle_text, faceText].filter(Boolean).join(" ").toLowerCase();
}

export function getTypeLine(card) {
  return (card?.type_line || "").toLowerCase();
}

export function isLand(card) {
  return getTypeLine(card).includes("land");
}

export function isLandCard(name, card) {
  return BASICS.has(name) || isLand(card);
}

export function clampScore(score) {
  return Math.max(MIN_SCORE, Math.min(MAX_SCORE, Math.round(score)));
}

function hasAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

export const ROLE_PATTERNS = {
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
  recursion: [
    /from your graveyard/,
    /return .*graveyard/,
    /put .*graveyard.*hand/,
    /flashback/,
    /escape/,
    /unearth/,
    /retrace/,
  ],
  engine: [
    /whenever/,
    /at the beginning of/,
    /the first time/,
    /you may cast/,
    /copy target/,
    /create .* token/,
  ],
  payoff: [
    /creatures you control get/,
    /tokens you control/,
    /whenever .* you control/,
    /whenever you cast/,
    /whenever you draw/,
    /deals damage equal/,
  ],
  finisher: [
    /you win the game/,
    /target player loses the game/,
    /extra combat/,
    /double strike/,
    /can't be blocked/,
    /creatures you control get \+\d\/\+\d/,
    /each opponent loses/,
  ],
};

export const ROLE_LABELS = {
  ramp: "Ramp",
  draw: "Draw",
  removal: "Removal",
  boardWipe: "Wipe",
  protection: "Protect",
  tutor: "Tutor",
  recursion: "Recursion",
  engine: "Engine",
  payoff: "Payoff",
  finisher: "Finisher",
  gameChanger: "Game Changer",
};

export function getRoles(card) {
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
    recursion: hasAny(text, ROLE_PATTERNS.recursion),
    engine: hasAny(text, ROLE_PATTERNS.engine),
    payoff: hasAny(text, ROLE_PATTERNS.payoff),
    finisher: hasAny(text, ROLE_PATTERNS.finisher) || (type.includes("creature") && (card?.cmc ?? 0) >= 6),
  };
}

export function getRoleKeys(card) {
  const roles = getRoles(card);
  return Object.entries(roles)
    .filter(([, active]) => active)
    .map(([key]) => key);
}

export const SIGNALS = [
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

export function getSharedSignals(card, commanderCards) {
  if (!card || !commanderCards.length) return [];
  const cardSignals = SIGNALS.filter((signal) => signal.test(card)).map((signal) => signal.key);
  const commanderSignals = new Set(
    commanderCards.flatMap((commander) => SIGNALS.filter((signal) => signal.test(commander)).map((signal) => signal.key)),
  );
  return cardSignals.filter((signal) => commanderSignals.has(signal));
}
