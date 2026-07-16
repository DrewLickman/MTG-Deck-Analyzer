import { BASICS, SCRYFALL_BATCH_SIZE, cardNameLookupVariants, makeBasicLandCard, normalizeCardName, normalizeName } from "./cardUtils.mjs";

const SCRYFALL_BATCH_CONCURRENCY = 4;
const SCRYFALL_NAMED_CONCURRENCY = 4;
const SCRYFALL_USER_AGENT = "MTG Deck Analyzer/0.1 (local development)";
const cardCache = new Map();

function scryfallHeaders(headers = {}) {
  const nextHeaders = { ...headers };
  if (typeof window === "undefined") nextHeaders["User-Agent"] = SCRYFALL_USER_AGENT;
  return nextHeaders;
}

async function readScryfallJson(res, context) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data.details || data.code || res.statusText || "Unknown Scryfall error";
    throw new Error(`${context} failed (${res.status}): ${detail}`);
  }
  return data;
}

function cacheCard(card, requestedName) {
  if (!card?.name) return;
  const aliases = [
    card.name,
    requestedName,
    ...cardNameLookupVariants(card.name),
    ...cardNameLookupVariants(requestedName),
  ];
  for (const alias of aliases) {
    if (alias) cardCache.set(normalizeName(alias), card);
  }
}

function getCachedCard(name) {
  for (const variant of cardNameLookupVariants(name)) {
    const cached = cardCache.get(normalizeName(variant));
    if (cached) return cached;
  }
  return null;
}

function mapCardResult(results, requestedName, card) {
  const variants = cardNameLookupVariants(requestedName);
  results[card.name] = card;
  for (const variant of variants) results[variant] = card;
  results[normalizeCardName(requestedName)] = card;
  cacheCard(card, requestedName);
}

function isSameCardName(a, b) {
  return normalizeName(a) === normalizeName(b);
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = [];
  let nextIndex = 0;
  const workerCount = Math.min(limit, items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  });
  await Promise.all(workers);
  return results;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchNamedCard(name, exact = true) {
  const cached = getCachedCard(name);
  if (cached) return cached;
  const params = new URLSearchParams({ [exact ? "exact" : "fuzzy"]: name });
  const res = await fetch(`https://api.scryfall.com/cards/named?${params.toString()}`, {
    headers: scryfallHeaders(),
  });
  if (res.status === 404) return null;
  const card = await readScryfallJson(res, `Scryfall named lookup for ${name}`);
  cacheCard(card, name);
  return card;
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

async function fetchCollectionBatch(batch) {
  const res = await fetch("https://api.scryfall.com/cards/collection", {
    method: "POST",
    headers: scryfallHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ identifiers: batch.map((name) => ({ name: normalizeCardName(name).split(" // ")[0] })) }),
  });
  return readScryfallJson(res, "Scryfall collection lookup");
}

async function fetchCollectionBatchWithRetry(batch, attempts = 3) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetchCollectionBatch(batch);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await wait(150 * attempt);
    }
  }
  throw lastError;
}

export function seedScryfallResults(names) {
  const results = {};
  for (const name of names) {
    if (BASICS.has(name)) {
      results[name] = makeBasicLandCard(name);
      continue;
    }
    const cached = getCachedCard(name);
    if (cached) mapCardResult(results, name, cached);
  }
  return results;
}

export async function fetchScryfall(names, onProgress = () => {}) {
  const results = seedScryfallResults(names);
  const unique = [...new Set(names.filter((name) => !results[name]?.image_uris && !getCachedCard(name)))];

  const missingNames = new Set();
  const total = Math.ceil(unique.length / SCRYFALL_BATCH_SIZE);
  const batches = [];

  for (let i = 0; i < unique.length; i += SCRYFALL_BATCH_SIZE) {
    batches.push(unique.slice(i, i + SCRYFALL_BATCH_SIZE));
  }

  let completed = 0;
  const batchResults = await mapWithConcurrency(batches, SCRYFALL_BATCH_CONCURRENCY, async (batch, index) => {
    const batchNum = index + 1;
    onProgress(`Fetching card data from Scryfall: batch ${batchNum} of ${total}`);
    try {
      const data = await fetchCollectionBatchWithRetry(batch);
      return { batch, data };
    } catch (error) {
      console.warn("Scryfall batch failed:", error);
      return { batch, error };
    } finally {
      completed += 1;
      onProgress(`Loaded Scryfall batch ${completed} of ${total}`);
    }
  });

  for (const batchResult of batchResults) {
    const { batch, data, error } = batchResult;
    if (error) {
      for (const name of batch) missingNames.add(name);
      continue;
    }

    try {
      for (const card of data.data || []) {
        const searched = batch.find((name) => {
          const front = normalizeCardName(name).split(" // ")[0];
          return normalizeName(card.name).startsWith(normalizeName(front)) || isSameCardName(name, card.name);
        });
        mapCardResult(results, searched || card.name, card);
      }

      for (const missing of data.not_found || []) missingNames.add(missing.name);
    } catch (error) {
      console.warn("Scryfall batch processing failed:", error);
      for (const name of batch) missingNames.add(name);
    }
  }

  const notFound = [];
  const stillMissing = [...missingNames].filter((name) => !cardNameLookupVariants(name).some((variant) => results[variant]));

  const retryResults = await mapWithConcurrency(stillMissing, SCRYFALL_NAMED_CONCURRENCY, async (name) => {
    try {
      const card = await retryMissingCard(name);
      return { name, card };
    } catch (error) {
      console.warn("Scryfall named retry failed:", name, error);
      return { name, error };
    }
  });

  for (const retry of retryResults) {
    if (retry.card) {
      mapCardResult(results, retry.name, retry.card);
    } else {
      notFound.push(retry.name);
    }
  }

  return { results, notFound };
}
