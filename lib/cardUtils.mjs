export const SCRYFALL_BATCH_SIZE = 25;
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
  M: "#d8b4fe",
  C: "#a1a1aa",
};

export const COLOR_LABEL = {
  W: "White",
  U: "Blue",
  B: "Black",
  R: "Red",
  G: "Green",
  M: "Multicolor",
  C: "Colorless/Generic",
};

export const MANA_CURVE_COLOR_ORDER = ["W", "U", "B", "R", "G", "C"];

export const BASICS = new Set(["Mountain", "Swamp", "Island", "Forest", "Plains", "Wastes"]);

export const SOS_FULL_ART_BASICS = {
  Plains: {
    collector_number: "267",
    image_uris: {
      normal: "https://cards.scryfall.io/normal/front/a/8/a845de50-4af0-4f4a-9c2a-db587973571c.jpg?1783903615",
      large: "https://cards.scryfall.io/large/front/a/8/a845de50-4af0-4f4a-9c2a-db587973571c.jpg?1783903615",
    },
  },
  Island: {
    collector_number: "268",
    image_uris: {
      normal: "https://cards.scryfall.io/normal/front/9/3/937250fe-bcad-4ff8-9406-286a69db7e0a.jpg?1783903615",
      large: "https://cards.scryfall.io/large/front/9/3/937250fe-bcad-4ff8-9406-286a69db7e0a.jpg?1783903615",
    },
  },
  Swamp: {
    collector_number: "269",
    image_uris: {
      normal: "https://cards.scryfall.io/normal/front/1/7/1797d5c7-d3fa-4184-85ae-46db14ddf523.jpg?1783903615",
      large: "https://cards.scryfall.io/large/front/1/7/1797d5c7-d3fa-4184-85ae-46db14ddf523.jpg?1783903615",
    },
  },
  Mountain: {
    collector_number: "270",
    image_uris: {
      normal: "https://cards.scryfall.io/normal/front/6/a/6af1f1db-eb91-4297-83f6-9318b87fd220.jpg?1783903615",
      large: "https://cards.scryfall.io/large/front/6/a/6af1f1db-eb91-4297-83f6-9318b87fd220.jpg?1783903615",
    },
  },
  Forest: {
    collector_number: "271",
    image_uris: {
      normal: "https://cards.scryfall.io/normal/front/4/6/46196e8f-9339-4f00-b9cf-cab8f9abc80e.jpg?1783903614",
      large: "https://cards.scryfall.io/large/front/4/6/46196e8f-9339-4f00-b9cf-cab8f9abc80e.jpg?1783903614",
    },
  },
};

export function normalizeName(name = "") {
  return name
    .toLowerCase()
    .replace(/\s*\/{1,2}\s*/g, " // ")
    .replace(/\s+/g, " ")
    .replace(/[’']/g, "'")
    .trim();
}

export function normalizeCardName(name = "") {
  return String(name || "")
    .replace(/\s*\/{1,2}\s*/g, " // ")
    .replace(/\s+/g, " ")
    .trim();
}

export function cardNameLookupVariants(name = "") {
  const normalized = normalizeCardName(name);
  const singleSlash = normalized.replace(/\s+\/\/\s+/g, " / ");
  const compactSlash = normalized.replace(/\s+\/\/\s+/g, "/");
  const frontFace = normalized.split(" // ")[0];
  return [...new Set([name, normalized, singleSlash, compactSlash, frontFace].map((item) => String(item || "").trim()).filter(Boolean))];
}

export function parseCardLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (/^(#|\/\/)/.test(trimmed)) return null;

  const qtyMatch = trimmed.match(/^(?:\*?\s*)?(\d+)x?\s+(.+)$/i);
  if (!qtyMatch) return null;

  const qty = parseInt(qtyMatch[1], 10);
  let rest = qtyMatch[2].replace(/\s*\*F\*?\s*$/i, "").trim();

  rest = rest.replace(/\s+\([A-Z0-9]+\)\s+[\w-]+(?:[a-z])?\s*$/i, "");
  rest = rest.replace(/\s+\([A-Z0-9]+\)\s*$/i, "");

  let name = rest.trim();
  if (!name) return null;

  name = normalizeCardName(name);
  return { qty, name };
}

export function makeBasicLandCard(name) {
  const sosPrinting = SOS_FULL_ART_BASICS[name];
  return {
    name,
    cmc: 0,
    mana_cost: "",
    oracle_text: "",
    type_line: "Basic Land",
    legalities: { commander: "legal" },
    ...(sosPrinting ? {
      set: "sos",
      set_name: "Secrets of Strixhaven",
      lang: "en",
      full_art: true,
      ...sosPrinting,
    } : {}),
  };
}

export function getManaCost(card) {
  if (!card) return null;
  if (card.mana_cost) return card.mana_cost;
  return card.card_faces?.[0]?.mana_cost ?? null;
}

export const MANA_SYMBOL_DISPLAY = {
  T: "↩️",
  C: "🔘",
  W: "⚪️",
  U: "🔵",
  B: "⚫️",
  R: "🔴",
  G: "🟢",
};

function displayManaToken(token) {
  const upper = String(token || "").toUpperCase();
  if (/^\d+$/.test(upper)) return MANA_SYMBOL_DISPLAY.C.repeat(Number(upper));
  if (MANA_SYMBOL_DISPLAY[upper]) return MANA_SYMBOL_DISPLAY[upper];
  if (upper.includes("/")) {
    return upper
      .split("/")
      .map((piece) => MANA_SYMBOL_DISPLAY[piece] || piece)
      .join("");
  }
  return `{${token}}`;
}

export function formatManaSymbols(manaCost) {
  if (!manaCost) return "";
  return String(manaCost).replace(/\{([^}]+)\}/g, (_, token) => displayManaToken(token));
}

export function formatTextSymbols(text) {
  if (!text) return "";
  return String(text).replace(/\{([^}]+)\}/gi, (_, token) => displayManaToken(token));
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

export function getManaColorKeys(card) {
  const pips = parsePips(getManaCost(card));
  const colored = ["W", "U", "B", "R", "G"].filter((key) => pips[key] > 0);
  if (colored.length) return colored;
  const printedColors = Array.isArray(card?.colors) ? card.colors.filter((key) => ["W", "U", "B", "R", "G"].includes(key)) : [];
  return printedColors.length ? printedColors : ["C"];
}

export function getManaColorBucket(card) {
  const keys = getManaColorKeys(card);
  return keys.length > 1 ? "M" : keys[0];
}

export function findCard(cardMap, name) {
  if (!name) return null;
  const variants = cardNameLookupVariants(name);
  const frontName = normalizeCardName(name).split(" // ")[0];
  return variants.map((variant) => cardMap[variant]).find(Boolean) || cardMap[frontName] || null;
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

function hasTutorRole(text) {
  if (!hasAny(text, ROLE_PATTERNS.tutor)) return false;
  return !/search your library for (a |an |up to \d+ )?(basic )?land card/.test(text);
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
  cardSelection: [
    /scry \d+/,
    /surveil \d+/,
    /look at the top/,
    /reveal the top/,
    /draw .* discard/,
    /discard .* draw/,
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
  tokenMaker: [
    /create .* token/,
    /token that's a copy/,
  ],
  sacrificeOutlet: [
    /sacrifice (a|another|an) .*:/,
    /sacrifice .*: add/,
    /sacrifice .*: draw/,
  ],
  graveyardHate: [
    /exile .* graveyard/,
    /exile all .* graveyards/,
    /cards? in graveyards can't/,
  ],
  stax: [
    /can't untap/,
    /players can't/,
    /opponents can't/,
    /spells cost .* more/,
    /spells .* cost .* more/,
    /enters the battlefield tapped/,
  ],
  costReducer: [
    /spells? you cast cost .* less/,
    /costs? .* less to cast/,
  ],
  manaFixing: [
    /add one mana of any color/,
    /add .* mana .* any combination of colors/,
    /mana of any color/,
  ],
  haste: [
    /creatures you control have haste/,
    /\bhaste\b/,
  ],
  evasion: [
    /\bflying\b/,
    /\btrample\b/,
    /\bmenace\b/,
    /can't be blocked/,
  ],
  lifeGain: [
    /you gain \d+ life/,
    /gain life/,
    /lifelink/,
  ],
};

export const ROLE_LABELS = {
  ramp: "Ramp",
  draw: "Draw",
  removal: "Removal",
  boardWipe: "Wipe",
  protection: "Protect",
  tutor: "Tutor",
  cardSelection: "Selection",
  recursion: "Recursion",
  engine: "Engine",
  payoff: "Payoff",
  finisher: "Finisher",
  tokenMaker: "Tokens",
  sacrificeOutlet: "Sac Outlet",
  graveyardHate: "Grave Hate",
  stax: "Stax",
  costReducer: "Cost Reducer",
  manaFixing: "Fixing",
  haste: "Haste",
  evasion: "Evasion",
  lifeGain: "Lifegain",
  fastMana: "Fast Mana",
  comboPiece: "Combo Piece",
  gameChanger: "Game Changer",
  core: "Core",
  commander: "Commander",
  land: "Land",
};

export const ANALYSIS_ROLE_KEYS = [
  "ramp",
  "draw",
  "removal",
  "boardWipe",
  "tutor",
  "protection",
  "recursion",
  "fastMana",
  "stax",
  "comboPiece",
];

export const FAST_MANA_NAMES = new Set([
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

export const COMBO_PIECE_NAMES = new Set([
  "thassa's oracle",
  "demonic consultation",
  "tainted pact",
  "underworld breach",
  "brain freeze",
  "lion's eye diamond",
  "isochron scepter",
  "dramatic reversal",
  "kiki-jiki, mirror breaker",
  "zealous conscripts",
  "pestermite",
  "deceiver exarch",
  "food chain",
  "misthollow griffin",
  "squee, the immortal",
  "eternal scourge",
]);

export function getRoles(card) {
  const text = getCardText(card);
  const type = getTypeLine(card);
  const name = normalizeName(card?.name);
  const boardWipe = hasAny(text, ROLE_PATTERNS.boardWipe);

  return {
    ramp: hasAny(text, ROLE_PATTERNS.ramp) || (type.includes("artifact") && /add \{?[wubrgc]/.test(text)),
    draw: hasAny(text, ROLE_PATTERNS.draw),
    removal: !boardWipe && hasAny(text, ROLE_PATTERNS.removal),
    boardWipe,
    protection: hasAny(text, ROLE_PATTERNS.protection),
    tutor: hasTutorRole(text),
    cardSelection: hasAny(text, ROLE_PATTERNS.cardSelection),
    recursion: hasAny(text, ROLE_PATTERNS.recursion),
    engine: hasAny(text, ROLE_PATTERNS.engine),
    payoff: hasAny(text, ROLE_PATTERNS.payoff),
    finisher: hasAny(text, ROLE_PATTERNS.finisher) || (type.includes("creature") && (card?.cmc ?? 0) >= 6),
    tokenMaker: hasAny(text, ROLE_PATTERNS.tokenMaker),
    sacrificeOutlet: hasAny(text, ROLE_PATTERNS.sacrificeOutlet),
    graveyardHate: hasAny(text, ROLE_PATTERNS.graveyardHate),
    stax: hasAny(text, ROLE_PATTERNS.stax),
    costReducer: hasAny(text, ROLE_PATTERNS.costReducer),
    manaFixing: hasAny(text, ROLE_PATTERNS.manaFixing),
    haste: hasAny(text, ROLE_PATTERNS.haste),
    evasion: hasAny(text, ROLE_PATTERNS.evasion),
    lifeGain: hasAny(text, ROLE_PATTERNS.lifeGain),
    fastMana: FAST_MANA_NAMES.has(name),
    comboPiece: COMBO_PIECE_NAMES.has(name) || /you win the game|target player loses the game/.test(text),
  };
}

export function getRoleKeys(card) {
  const roles = getRoles(card);
  return Object.entries(roles)
    .filter(([, active]) => active)
    .map(([key]) => key);
}

function firstMatchingPattern(text, patterns = []) {
  return patterns.find((pattern) => pattern.test(text));
}

function evidenceForRole(role, card, name) {
  if (!card) {
    return {
      role,
      cardName: name,
      reason: "Card metadata was unavailable, so this role could not be verified.",
      confidence: "low",
      matchingRule: "missing-card-data",
      source: "local fallback",
    };
  }

  const text = getCardText(card);
  const type = getTypeLine(card);
  const normalized = normalizeName(card.name || name);
  const pattern = firstMatchingPattern(text, ROLE_PATTERNS[role]);
  if (pattern) {
    return {
      role,
      cardName: name || card.name,
      reason: `${ROLE_LABELS[role] || role} matched oracle text pattern ${pattern}.`,
      confidence: "medium",
      matchingRule: `oracle:${pattern.source}`,
      source: "oracle text pattern",
    };
  }

  if (role === "ramp" && type.includes("artifact") && /add \{?[wubrgc]/.test(text)) {
    return {
      role,
      cardName: name || card.name,
      reason: "Artifact produces mana from oracle text.",
      confidence: "medium",
      matchingRule: "manual heuristic:artifact-adds-mana",
      source: "manual heuristic",
    };
  }

  if (role === "fastMana" && FAST_MANA_NAMES.has(normalized)) {
    return {
      role,
      cardName: name || card.name,
      reason: "Known fast-mana card in local override list.",
      confidence: "high",
      matchingRule: "known-card:fast-mana",
      source: "known-card override",
    };
  }

  if (role === "comboPiece" && COMBO_PIECE_NAMES.has(normalized)) {
    return {
      role,
      cardName: name || card.name,
      reason: "Known compact combo card in local override list.",
      confidence: "high",
      matchingRule: "known-card:combo-piece",
      source: "known-card override",
    };
  }

  if (role === "comboPiece" && /you win the game|target player loses the game/.test(text)) {
    return {
      role,
      cardName: name || card.name,
      reason: "Oracle text contains an alternate win/loss condition.",
      confidence: "medium",
      matchingRule: "oracle:win-loss-condition",
      source: "manual heuristic",
    };
  }

  return null;
}

export function getRoleEvidence(card, name = card?.name) {
  const roles = getRoles(card);
  return Object.entries(roles)
    .filter(([, active]) => active)
    .map(([role]) => evidenceForRole(role, card, name))
    .filter(Boolean);
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
