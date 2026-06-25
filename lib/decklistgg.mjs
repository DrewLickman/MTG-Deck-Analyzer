export const DECKLIST_GG_IMPORT_ENDPOINT = "https://decklist.gg/api/extract-decklist";

function asEntries(section = []) {
  if (Array.isArray(section)) return section;
  if (section && typeof section === "object") return Object.values(section.cards || section);
  return [];
}

function entryName(entry) {
  return entry?.name || entry?.card?.name || "";
}

function entryQuantity(entry) {
  const quantity = Number(entry?.quantity ?? entry?.qty ?? entry?.count ?? 1);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
}

function cardsToLines(section = []) {
  return asEntries(section)
    .map((entry) => {
      const name = entryName(entry);
      return name ? `${entryQuantity(entry)} ${name}` : null;
    })
    .filter(Boolean)
    .join("\n");
}

function cardNames(section = []) {
  return asEntries(section)
    .map(entryName)
    .filter(Boolean);
}

export function moxfieldDeckUrl(id) {
  return `https://moxfield.com/decks/${id}`;
}

export function normalizeDecklistGgDeck(data = {}) {
  const commanders = cardNames(data.commander || data.commanders);
  const companions = cardNames(data.companion || data.companions);
  const mainboard = cardsToLines(data.mainboard || data.main || data.deck);
  const sideboard = cardsToLines(data.sideboard);
  const considering = cardsToLines(data.maybeboard || data.considering);

  const deckText = [
    mainboard,
    sideboard ? `Sideboard:\n${sideboard}` : "",
    considering ? `Considering:\n${considering}` : "",
  ].filter(Boolean).join("\n\n");

  return {
    commanders,
    companions,
    deckText,
    name: data.deckName || data.name || "",
    playerName: data.playerName || "",
    format: data.format || "",
  };
}

export async function fetchDecklistGgDeck(deckUrl, fetchImpl = fetch) {
  const response = await fetchImpl(DECKLIST_GG_IMPORT_ENDPOINT, {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url: deckUrl }),
    cache: "no-store",
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // Decklist.gg normally returns JSON. Keep the downstream error clear if it does not.
  }

  if (!response.ok) {
    const error = new Error(payload?.error || `Decklist.gg returned ${response.status}`);
    error.status = response.status;
    error.details = [`${DECKLIST_GG_IMPORT_ENDPOINT} returned ${response.status}`];
    throw error;
  }

  if (!payload || typeof payload !== "object") {
    const error = new Error("Decklist.gg returned an unsupported response.");
    error.status = 502;
    error.details = [`${DECKLIST_GG_IMPORT_ENDPOINT} returned non-json content`];
    throw error;
  }

  return payload;
}
