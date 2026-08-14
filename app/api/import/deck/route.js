import { NextResponse } from "next/server";
import { importDeck } from "../../../../lib/deckImport.mjs";

export async function GET(request) {
  const url = new URL(request.url);
  const input = url.searchParams.get("url") || url.searchParams.get("id") || "";

  try {
    return NextResponse.json(await importDeck(input));
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "Deck import failed.", details: error.details || [] },
      { status: error.status || 500 },
    );
  }
}
