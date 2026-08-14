export function extractMoxfieldId(input = "") {
  const trimmed = String(input || "").trim();
  const urlMatch = trimmed.match(/moxfield\.com\/decks\/([a-zA-Z0-9_-]+)/);
  if (urlMatch) return urlMatch[1];
  const idMatch = trimmed.match(/^[a-zA-Z0-9_-]{8,}$/);
  return idMatch ? trimmed : null;
}

function boardToLines(board = {}) {
  return Object.values(board || {})
    .map((entry) => {
      const quantity = entry.quantity ?? entry.qty ?? entry.count ?? 1;
      const name = entry.card?.name || entry.name;
      return name ? `${quantity} ${name}` : null;
    })
    .filter(Boolean)
    .join("\n");
}

function boardCards(data, key) {
  return data.boards?.[key]?.cards || data[key]?.cards || data[key] || {};
}

export function normalizeMoxfieldDeck(data = {}) {
  const commanders = Object.values(boardCards(data, "commanders"))
    .map((entry) => entry.card?.name || entry.name)
    .filter(Boolean);
  const companions = Object.values(boardCards(data, "companions"))
    .map((entry) => entry.card?.name || entry.name)
    .filter(Boolean);
  const mainboard = boardToLines(boardCards(data, "mainboard"));
  const sideboard = boardToLines(boardCards(data, "sideboard"));
  const considering = boardToLines(boardCards(data, "maybeboard"));

  const deckText = [
    mainboard,
    sideboard ? `Sideboard:\n${sideboard}` : "",
    considering ? `Considering:\n${considering}` : "",
  ].filter(Boolean).join("\n\n");

  return {
    commanders,
    companions,
    deckText,
    name: data.name || data.deck?.name || "",
  };
}

export const MOXFIELD_ENDPOINTS = [
  (id) => `https://api2.moxfield.com/v3/decks/all/${id}`,
  (id) => `https://api2.moxfield.com/v2/decks/all/${id}`,
];

export async function fetchMoxfieldDeck(id, fetchImpl = fetch) {
  const headers = {
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": `https://www.moxfield.com/decks/${id}`,
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
  };
  const errors = [];

  for (const endpoint of MOXFIELD_ENDPOINTS) {
    const url = endpoint(id);
    try {
      const response = await fetchImpl(url, { headers, cache: "no-store" });
      const contentType = response.headers?.get?.("content-type") || "";
      if (!response.ok) {
        errors.push(`${url} returned ${response.status}`);
        continue;
      }
      if (contentType && !contentType.includes("application/json")) {
        errors.push(`${url} returned ${contentType}`);
        continue;
      }
      return response.json();
    } catch (error) {
      errors.push(`${url} failed: ${error.message}`);
    }
  }

  const blocked = errors.some((error) => /403|401|forbidden|unauthorized/i.test(error));
  const error = new Error(blocked
    ? "Moxfield blocked the server-side import request."
    : "Moxfield could not find a public deck at that URL.");
  error.details = errors;
  error.status = blocked ? 502 : 404;
  throw error;
}
