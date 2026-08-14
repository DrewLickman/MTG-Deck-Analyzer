import test from "node:test";
import assert from "node:assert/strict";
import {
  archidektDeckUrl,
  extractSupportedDeckUrl,
  identifyDeckSource,
  moxfieldDeckUrl,
} from "../lib/deckSource.mjs";

test("identifies and canonicalizes supported deck URLs", () => {
  assert.deepEqual(identifyDeckSource("https://www.moxfield.com/decks/BvKkr01dnEO8UbJi4Eu0_g?foo=bar"), {
    id: "BvKkr01dnEO8UbJi4Eu0_g",
    platform: "moxfield",
    url: "https://moxfield.com/decks/BvKkr01dnEO8UbJi4Eu0_g",
  });
  assert.deepEqual(identifyDeckSource("https://www.archidekt.com/decks/365563/brago-blink"), {
    id: "365563",
    platform: "archidekt",
    url: "https://archidekt.com/decks/365563",
  });
  assert.equal(identifyDeckSource("https://example.com/decks/365563"), null);
});

test("extracts a supported URL from pasted text", () => {
  assert.equal(
    extractSupportedDeckUrl("Try this: https://archidekt.com/decks/365563/brago-blink (updated)"),
    "https://archidekt.com/decks/365563/brago-blink",
  );
  assert.equal(extractSupportedDeckUrl("no deck here"), "");
});

test("builds canonical source URLs", () => {
  assert.equal(moxfieldDeckUrl("abc12345"), "https://moxfield.com/decks/abc12345");
  assert.equal(archidektDeckUrl("365563"), "https://archidekt.com/decks/365563");
});
