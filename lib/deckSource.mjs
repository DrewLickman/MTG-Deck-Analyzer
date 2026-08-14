const MOXFIELD_URL_PATTERN = /https?:\/\/(?:www\.)?moxfield\.com\/decks\/([a-zA-Z0-9_-]+)(?:[^\s)"'<>]*)?/i;
const ARCHIDEKT_URL_PATTERN = /https?:\/\/(?:www\.)?archidekt\.com\/decks\/(\d+)(?:[^\s)"'<>]*)?/i;

export function moxfieldDeckUrl(id) {
  return `https://moxfield.com/decks/${id}`;
}

export function archidektDeckUrl(id) {
  return `https://archidekt.com/decks/${id}`;
}

export function extractSupportedDeckUrl(value = "") {
  const input = String(value || "").trim();
  return input.match(MOXFIELD_URL_PATTERN)?.[0]
    || input.match(ARCHIDEKT_URL_PATTERN)?.[0]
    || "";
}

export function identifyDeckSource(input = "") {
  const value = String(input || "").trim();
  const moxfieldMatch = value.match(MOXFIELD_URL_PATTERN);
  if (moxfieldMatch) {
    return {
      id: moxfieldMatch[1],
      platform: "moxfield",
      url: moxfieldDeckUrl(moxfieldMatch[1]),
    };
  }

  const archidektMatch = value.match(ARCHIDEKT_URL_PATTERN);
  if (archidektMatch) {
    return {
      id: archidektMatch[1],
      platform: "archidekt",
      url: archidektDeckUrl(archidektMatch[1]),
    };
  }

  const moxfieldId = value.match(/^[a-zA-Z0-9_-]{8,}$/)?.[0];
  if (moxfieldId) {
    return {
      id: moxfieldId,
      platform: "moxfield",
      url: moxfieldDeckUrl(moxfieldId),
    };
  }

  return null;
}
