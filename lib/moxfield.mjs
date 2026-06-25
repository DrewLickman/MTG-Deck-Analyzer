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

