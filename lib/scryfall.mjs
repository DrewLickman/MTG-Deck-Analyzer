import { BASICS, SCRYFALL_BATCH_SIZE, makeBasicLandCard } from "./cardUtils.mjs";

export async function fetchScryfall(names, onProgress = () => {}) {
  const unique = [...new Set(names.filter((name) => !BASICS.has(name)))];
  const results = {};

  for (const name of names) {
    if (BASICS.has(name)) results[name] = makeBasicLandCard(name);
  }

  const notFound = [];
  const total = Math.ceil(unique.length / SCRYFALL_BATCH_SIZE);

  for (let i = 0; i < unique.length; i += SCRYFALL_BATCH_SIZE) {
    const batch = unique.slice(i, i + SCRYFALL_BATCH_SIZE);
    const batchNum = Math.floor(i / SCRYFALL_BATCH_SIZE) + 1;
    onProgress(`Fetching card data from Scryfall: batch ${batchNum} of ${total}`);

    try {
      const res = await fetch("https://api.scryfall.com/cards/collection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifiers: batch.map((name) => ({ name })) }),
      });
      const data = await res.json();

      for (const card of data.data || []) {
        results[card.name] = card;
        const searched = batch.find((name) => {
          const front = name.toLowerCase().split(" // ")[0];
          return card.name.toLowerCase().startsWith(front) || name.toLowerCase() === card.name.toLowerCase();
        });
        if (searched && searched !== card.name) results[searched] = card;
      }

      for (const missing of data.not_found || []) notFound.push(missing.name);
    } catch (error) {
      console.warn("Scryfall batch failed:", error);
      notFound.push(...batch);
    }
  }

  return { results, notFound };
}
