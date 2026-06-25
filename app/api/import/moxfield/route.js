import { NextResponse } from "next/server";
import { fetchDecklistGgDeck, moxfieldDeckUrl, normalizeDecklistGgDeck } from "../../../../lib/decklistgg.mjs";
import { extractMoxfieldId, normalizeMoxfieldDeck } from "../../../../lib/moxfield.mjs";

const MOXFIELD_ENDPOINTS = [
  (id) => `https://api2.moxfield.com/v3/decks/all/${id}`,
  (id) => `https://api2.moxfield.com/v2/decks/all/${id}`,
];

async function fetchMoxfieldJson(id) {
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
      const response = await fetch(url, { headers, cache: "no-store" });
      const contentType = response.headers.get("content-type") || "";
      if (!response.ok) {
        errors.push(`${url} returned ${response.status}`);
        continue;
      }
      if (!contentType.includes("application/json")) {
        errors.push(`${url} returned ${contentType || "non-json content"}`);
        continue;
      }
      return response.json();
    } catch (error) {
      errors.push(`${url} failed: ${error.message}`);
    }
  }

  const blocked = errors.some((error) => /403|401|forbidden|unauthorized/i.test(error));
  const message = blocked
    ? "Moxfield blocked the server-side import request. The deck may still be public, but Moxfield is refusing automated API access from this network."
    : "Moxfield import failed. The deck may be private, deleted, or using an unsupported response shape.";
  const error = new Error(message);
  error.details = errors;
  error.status = blocked ? 502 : 404;
  throw error;
}

export async function GET(request) {
  const url = new URL(request.url);
  const input = url.searchParams.get("url") || url.searchParams.get("id") || "";
  const id = extractMoxfieldId(input);

  if (!id) {
    return NextResponse.json({ error: "Invalid Moxfield URL or deck id." }, { status: 400 });
  }

  try {
    const data = await fetchMoxfieldJson(id);
    const normalized = normalizeMoxfieldDeck(data);
    if (!normalized.deckText.trim()) {
      return NextResponse.json({ error: "Moxfield returned a deck, but no mainboard cards were found." }, { status: 422 });
    }
    return NextResponse.json({ id, source: "moxfield", ...normalized });
  } catch (moxfieldError) {
    try {
      const data = await fetchDecklistGgDeck(moxfieldDeckUrl(id));
      const normalized = normalizeDecklistGgDeck(data);
      if (!normalized.deckText.trim()) {
        return NextResponse.json(
          {
            error: "Decklist.gg returned a deck, but no mainboard cards were found.",
            details: moxfieldError.details || [],
          },
          { status: 422 },
        );
      }
      return NextResponse.json({
        id,
        source: "decklist.gg",
        importWarnings: [moxfieldError.message],
        ...normalized,
      });
    } catch (decklistError) {
      const details = [
        ...(moxfieldError.details || []),
        ...(decklistError.details || []),
      ];
      const message = `${moxfieldError.message} Decklist.gg fallback also failed: ${decklistError.message}`;
      return NextResponse.json(
        { error: message, details },
        { status: decklistError.status || moxfieldError.status || 500 },
      );
    }
  }
}
