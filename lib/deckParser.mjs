import { normalizeName, parseCardLine } from "./cardUtils.mjs";

const SECTION_ALIASES = {
  commander: "commanders",
  commanders: "commanders",
  commandzone: "commanders",
  command: "commanders",
  companion: "companions",
  companions: "companions",
  deck: "main",
  main: "main",
  mainboard: "main",
  sideboard: "sideboard",
  sb: "sideboard",
  considering: "considering",
  maybeboard: "considering",
  maybe: "considering",
};

function sectionKey(line) {
  const normalized = line.toLowerCase().replace(/[\s:_-]/g, "");
  return SECTION_ALIASES[normalized] || null;
}

function emptyDeck() {
  return {
    main: [],
    commanders: [],
    companions: [],
    sideboard: [],
    considering: [],
    commandSource: "unknown",
    companionSource: "none",
    inferenceWarnings: [],
    firstCardCandidate: null,
    bottomCommandCandidates: [],
    expectedMainCount: 99,
    cardCount: 0,
  };
}

function parseManualNames(input) {
  if (!input?.trim()) return [];
  return input
    .split(/\r?\n|;|\s+\+\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => parseCardLine(part)?.name || part);
}

function isBottomCommandBlock(block) {
  return Boolean(
    block &&
    ["main", "sideboard", "considering"].includes(block.section) &&
    block.entries.length >= 1 &&
    block.entries.length <= 2 &&
    block.entries.every((entry) => entry.qty === 1),
  );
}

function hasPriorBlockInSection(blocks, index) {
  const block = blocks[index];
  return blocks.slice(0, index).some((candidate) => candidate.section === block.section && candidate.entries.length);
}

function sameCard(a, b) {
  return normalizeName(a) === normalizeName(b);
}

function removeNames(entries, names) {
  if (!names.length) return entries;
  return entries.filter((entry) => !names.some((name) => sameCard(entry.name, name)));
}

function countCards(entries) {
  return entries.reduce((sum, entry) => sum + entry.qty, 0);
}

function buildBlocks(raw) {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let current = [];
  let section = "main";

  const flush = () => {
    if (current.length) {
      blocks.push({ section, entries: current });
      current = [];
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flush();
      continue;
    }

    const nextSection = sectionKey(line);
    if (nextSection) {
      flush();
      section = nextSection;
      continue;
    }

    const parsed = parseCardLine(line);
    if (parsed) current.push(parsed);
  }

  flush();
  return blocks;
}

export function parseDecklist(raw, options = {}) {
  const commanderInput = typeof options === "string" ? options : options.commanderInput;
  const companionInput = typeof options === "object" ? options.companionInput : "";
  const deck = emptyDeck();
  const blocks = buildBlocks(raw || "");
  const explicitCommanders = [];
  const explicitCompanions = [];

  for (const block of blocks) {
    if (block.section === "commanders") explicitCommanders.push(...block.entries);
    else if (block.section === "companions") explicitCompanions.push(...block.entries);
    else deck[block.section].push(...block.entries);
  }

  deck.firstCardCandidate = deck.main[0]?.name || null;

  const manualCommanders = parseManualNames(commanderInput).map((name) => ({ qty: 1, name }));
  const manualCompanions = parseManualNames(companionInput).map((name) => ({ qty: 1, name }));
  const mainBlocks = blocks.filter((block) => block.section === "main" && block.entries.length);
  const finalBlockIndex = blocks.length - 1;
  const finalBlock = blocks[finalBlockIndex];
  const finalMainBlock = mainBlocks[mainBlocks.length - 1];
  const finalSeparatedCommandBlock = isBottomCommandBlock(finalBlock) && (
    (finalBlock.section === "main" && mainBlocks.length > 1) ||
    (finalBlock.section !== "main" && hasPriorBlockInSection(blocks, finalBlockIndex))
  )
    ? finalBlock
    : null;

  if (manualCommanders.length) {
    deck.commanders = manualCommanders.slice(0, 2);
    deck.commandSource = "manual";
    deck.inferenceWarnings.push("Manual commander override applied.");
  } else if (explicitCommanders.length) {
    deck.commanders = explicitCommanders.slice(0, 2);
    deck.commandSource = "section";
  } else if (finalSeparatedCommandBlock) {
    deck.commanders = finalSeparatedCommandBlock.entries.slice(0, 2);
    deck.bottomCommandCandidates = finalSeparatedCommandBlock.entries.map((entry) => entry.name);
    deck.commandSource = "bottom-block";
    deck.inferenceWarnings.push(
      finalSeparatedCommandBlock.section === "main"
        ? "Commander inferred from the separated bottom block."
        : `Commander inferred from the final separated ${finalSeparatedCommandBlock.section} block.`,
    );
  } else if (
    finalMainBlock &&
    mainBlocks.length > 1 &&
    isBottomCommandBlock(finalMainBlock)
  ) {
    deck.commanders = finalMainBlock.entries.slice(0, 2);
    deck.bottomCommandCandidates = finalMainBlock.entries.map((entry) => entry.name);
    deck.commandSource = "bottom-block";
    deck.inferenceWarnings.push("Commander inferred from the separated bottom block.");
  } else if (deck.main.length) {
    deck.commanders = [deck.main[0]];
    deck.commandSource = "first-card";
    deck.inferenceWarnings.push("Commander inferred from the first parsed card.");
  }

  if (manualCompanions.length) {
    deck.companions = manualCompanions.slice(0, 1);
    deck.companionSource = "manual";
  } else if (explicitCompanions.length) {
    deck.companions = explicitCompanions.slice(0, 1);
    deck.companionSource = "section";
  }

  if (explicitCommanders.length > 2 || manualCommanders.length > 2) {
    deck.inferenceWarnings.push("More than two command-zone cards were provided; only the first two are treated as commanders.");
  }
  if (explicitCompanions.length > 1 || manualCompanions.length > 1) {
    deck.inferenceWarnings.push("More than one companion was provided; only the first is treated as the companion.");
  }

  const commandZoneNames = [...deck.commanders, ...deck.companions].map((entry) => entry.name);
  deck.main = removeNames(deck.main, commandZoneNames);
  deck.sideboard = removeNames(deck.sideboard, commandZoneNames);
  deck.considering = removeNames(deck.considering, commandZoneNames);
  deck.expectedMainCount = Math.max(0, 100 - deck.commanders.length);
  deck.cardCount = countCards(deck.main);
  deck.commanderNames = deck.commanders.map((entry) => entry.name);
  deck.companionNames = deck.companions.map((entry) => entry.name);

  return deck;
}

export function deckLookupNames(deck) {
  return [
    ...deck.commanders.map((entry) => entry.name),
    ...deck.companions.map((entry) => entry.name),
    ...deck.main.map((entry) => entry.name),
    ...deck.sideboard.map((entry) => entry.name),
    ...deck.considering.map((entry) => entry.name),
  ].filter((name, index, all) => all.indexOf(name) === index);
}

export function validateCommandZone(deck, cardMap, findCard, getCardText) {
  const warnings = [...deck.inferenceWarnings];

  if (deck.commanders.length === 0) warnings.push("No commander could be identified.");
  if (deck.commanders.length === 2) {
    const commanderCards = deck.commanders.map((entry) => findCard(cardMap, entry.name));
    const partnerLike = commanderCards.every((card) => {
      const text = getCardText(card);
      return /partner|friends forever|doctor's companion|choose a background/.test(text);
    });
    if (!partnerLike) {
      warnings.push("Two commanders were detected, but Partner-style legality could not be confirmed from card text.");
    }
  }

  if (deck.cardCount !== deck.expectedMainCount) {
    warnings.push(`Main deck has ${deck.cardCount} cards; expected ${deck.expectedMainCount} after command-zone cards.`);
  }

  return { ...deck, inferenceWarnings: warnings };
}
