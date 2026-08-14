import { fetchArchidektDeck, normalizeArchidektDeck } from "./archidekt.mjs";
import { identifyDeckSource } from "./deckSource.mjs";
import { fetchDecklistGgDeck, normalizeDecklistGgDeck } from "./decklistgg.mjs";
import { fetchMoxfieldDeck, normalizeMoxfieldDeck } from "./moxfield.mjs";

function requireMainboard(normalized, provider) {
  if (normalized.deckText?.trim()) return normalized;
  const error = new Error(`${provider} returned a deck, but no mainboard cards were found.`);
  error.status = 422;
  error.details = [];
  throw error;
}

export async function importDeck(input, fetchImpl = fetch) {
  const target = identifyDeckSource(input);
  if (!target) {
    const error = new Error("Enter a valid Moxfield or Archidekt deck URL.");
    error.status = 400;
    error.details = [];
    throw error;
  }

  if (target.platform === "archidekt") {
    try {
      const normalized = requireMainboard(
        normalizeArchidektDeck(await fetchArchidektDeck(target.id, fetchImpl)),
        "Archidekt",
      );
      return {
        id: target.id,
        platform: target.platform,
        source: "archidekt",
        ...normalized,
      };
    } catch (directError) {
      const error = new Error(`Could not import this Archidekt deck. ${directError.message}`);
      error.status = directError.status || 500;
      error.details = directError.details || [];
      throw error;
    }
  }

  let decklistError;
  try {
    const normalized = requireMainboard(
      normalizeDecklistGgDeck(await fetchDecklistGgDeck(target.url, fetchImpl)),
      "Decklist.gg",
    );
    return {
      id: target.id,
      platform: target.platform,
      source: "decklist.gg",
      ...normalized,
    };
  } catch (error) {
    decklistError = error;
  }

  try {
    const normalized = requireMainboard(
      normalizeMoxfieldDeck(await fetchMoxfieldDeck(target.id, fetchImpl)),
      "Moxfield",
    );
    return {
      id: target.id,
      platform: target.platform,
      source: target.platform,
      importWarnings: [`Decklist.gg import unavailable: ${decklistError.message}`],
      ...normalized,
    };
  } catch (directError) {
    const error = new Error(
      `Could not import this Moxfield deck. ${directError.message}`,
    );
    error.status = directError.status || decklistError.status || 500;
    error.details = [
      ...(decklistError.details || []),
      ...(directError.details || []),
    ];
    throw error;
  }
}
