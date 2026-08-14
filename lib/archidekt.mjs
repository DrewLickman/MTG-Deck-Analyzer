export const ARCHIDEKT_API_BASE = "https://archidekt.com/api/decks";

function cardName(entry = {}) {
  return entry.card?.oracleCard?.name
    || entry.card?.displayName
    || entry.card?.name
    || entry.name
    || "";
}

function cardQuantity(entry = {}) {
  const quantity = Number(entry.quantity ?? entry.qty ?? entry.count ?? 1);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
}

function categories(entry = {}) {
  return (Array.isArray(entry.categories) ? entry.categories : [])
    .map((category) => String(category?.name || category || "").trim().toLowerCase())
    .filter(Boolean);
}

function hasCategory(entry, name) {
  return categories(entry).includes(name);
}

function cardsToLines(entries = []) {
  return entries
    .map((entry) => {
      const name = cardName(entry);
      return name ? `${cardQuantity(entry)} ${name}` : null;
    })
    .filter(Boolean)
    .join("\n");
}

export function normalizeArchidektDeck(data = {}) {
  const cards = [
    ...(Array.isArray(data.cards) ? data.cards : []),
    ...(Array.isArray(data.customCards) ? data.customCards : []),
  ];
  const sections = { commanders: [], companions: [], mainboard: [], sideboard: [], considering: [] };
  for (const entry of cards) {
    if (hasCategory(entry, "commander")) sections.commanders.push(entry);
    else if (entry.companion === true || hasCategory(entry, "companion")) sections.companions.push(entry);
    else if (hasCategory(entry, "sideboard")) sections.sideboard.push(entry);
    else if (hasCategory(entry, "maybeboard") || hasCategory(entry, "considering")) sections.considering.push(entry);
    else sections.mainboard.push(entry);
  }

  const mainboardText = cardsToLines(sections.mainboard);
  const sideboardText = cardsToLines(sections.sideboard);
  const consideringText = cardsToLines(sections.considering);
  const deckText = [
    mainboardText,
    sideboardText ? `Sideboard:\n${sideboardText}` : "",
    consideringText ? `Considering:\n${consideringText}` : "",
  ].filter(Boolean).join("\n\n");

  return {
    commanders: sections.commanders.map(cardName).filter(Boolean),
    companions: sections.companions.map(cardName).filter(Boolean),
    deckText,
    name: data.name || "",
    playerName: data.owner?.username || "",
    format: data.deckFormat || "",
  };
}

export async function fetchArchidektDeck(id, fetchImpl = fetch) {
  const url = `${ARCHIDEKT_API_BASE}/${id}/`;
  const response = await fetchImpl(url, {
    headers: { "Accept": "application/json" },
    cache: "no-store",
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // Keep the downstream error specific when Archidekt returns HTML or an empty body.
  }

  if (!response.ok) {
    const error = new Error(response.status === 404
      ? "Archidekt could not find a public deck at that URL."
      : `Archidekt returned ${response.status}.`);
    error.status = response.status;
    error.details = [`${url} returned ${response.status}`];
    throw error;
  }

  if (!payload || typeof payload !== "object") {
    const error = new Error("Archidekt returned an unsupported response.");
    error.status = 502;
    error.details = [`${url} returned non-json content`];
    throw error;
  }

  return payload;
}
