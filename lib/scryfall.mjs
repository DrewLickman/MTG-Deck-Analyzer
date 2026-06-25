import { BASICS, SCRYFALL_BATCH_SIZE, cardNameLookupVariants, makeBasicLandCard, normalizeCardName, normalizeName } from "./cardUtils.mjs";

function mapCardResult(results, requestedName, card) {
  const variants = cardNameLookupVariants(requestedName);
  results[card.name] = card;
  for (const variant of variants) results[variant] = card;
  results[normalizeCardName(requestedName)] = card;
}

function isSameCardName(a, b) {
  return normalizeName(a) === normalizeName(b);
}

async function fetchNamedCard(name, exact = true) {
  const params = new URLSearchParams({ [exact ? "exact" : "fuzzy"]: name });
  const res = await fetch(`https://api.scryfall.com/cards/named?${params.toString()}`);
  if (!res.ok) return null;
  return res.json();
}

async function retryMissingCard(name) {
  for (const variant of cardNameLookupVariants(name)) {
    const exact = await fetchNamedCard(variant, true);
    if (exact) return exact;
  }
  for (const variant of cardNameLookupVariants(name)) {
    const fuzzy = await fetchNamedCard(variant, false);
    if (fuzzy) return fuzzy;
  }
  return null;
}

export async function fetchScryfall(names, onProgress = () => {}) {
  const unique = [...new Set(names.filter((name) => !BASICS.has(name)))];
  const results = {};

  for (const name of names) {
    if (BASICS.has(name)) results[name] = makeBasicLandCard(name);
  }

  const missingNames = new Set();
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
        const searched = batch.find((name) => {
          const front = normalizeCardName(name).split(" // ")[0];
          return normalizeName(card.name).startsWith(normalizeName(front)) || isSameCardName(name, card.name);
        });
        mapCardResult(results, searched || card.name, card);
      }

      for (const missing of data.not_found || []) {
        try {
          const card = await retryMissingCard(missing.name);
          if (card) mapCardResult(results, missing.name, card);
          else missingNames.add(missing.name);
        } catch (error) {
          console.warn("Scryfall named retry failed:", missing.name, error);
          missingNames.add(missing.name);
        }
      }
    } catch (error) {
      console.warn("Scryfall batch failed:", error);
      for (const name of batch) missingNames.add(name);
    }
  }

  const notFound = [];
  const stillMissing = [...missingNames].filter((name) => !cardNameLookupVariants(name).some((variant) => results[variant]));
  for (let i = 0; i < stillMissing.length; i++) {
    const name = stillMissing[i];
    try {
      const card = await retryMissingCard(name);
      if (card) mapCardResult(results, name, card);
      else notFound.push(name);
    } catch (error) {
      console.warn("Scryfall named retry failed:", name, error);
      notFound.push(name);
    }
  }

  return { results, notFound };
}
