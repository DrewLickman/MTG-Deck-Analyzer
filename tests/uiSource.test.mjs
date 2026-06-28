import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../mtg-analyzer.jsx", import.meta.url), "utf8");

test("card UI renders dense table controls instead of grouped evidence first", () => {
  assert.match(source, /Dense Card Table/);
  assert.match(source, /Search cards or roles/);
  assert.match(source, /Cut Signal/);
  assert.match(source, /cutsByName/);
  assert.match(source, /setExpanded\(rows\.map/);
  assert.match(source, /roles\.slice\(0, 4\)/);
  assert.doesNotMatch(source, /<CardGroupSections analysis=\{analysis\} cardMap=\{cardMap\} \/>/);
});

test("card previews prefer Scryfall image URLs and degrade gracefully", () => {
  assert.match(source, /function CardPreview/);
  assert.match(source, /const \[open, setOpen\] = useState\(false\)/);
  assert.match(source, /onClick=\{\(\) => setOpen/);
  assert.match(source, /group-hover:block/);
  assert.match(source, /cardPreviewUrl\(card\)/);
  assert.match(source, /card\?\.image_uris\?\.normal/);
  assert.match(source, /card_faces\?\.find/);
  assert.match(source, /<img src=\{imageUrl\}/);
  assert.match(source, /No image available/);
});

test("mana costs render with project mana icon assets", () => {
  assert.match(source, /function ManaSymbol/);
  assert.match(source, /\/mana\/\$\{upper\.toLowerCase\(\)\}\.svg/);
  assert.match(source, /alt=\{`\{\$\{token\}\}`\}/);
});

test("game plan renders commander role classification details", () => {
  assert.match(source, /function CommanderRolePanel/);
  assert.match(source, /function CommanderRoleGraph/);
  assert.match(source, /COMMANDER_ROLE_POINTS/);
  assert.match(source, /Commander Role/);
  assert.match(source, /commander\.category/);
  assert.match(source, /commander\.confidence/);
  assert.match(source, /commander\.categoryScores/);
  assert.match(source, /confidenceScore/);
  assert.match(source, /Quadratic confidence center/);
  assert.match(source, /Low-confidence classification/);
  assert.match(source, /commander\.evidence/);
  assert.match(source, /alternateCategories/);
});

test("analysis tabs are organized by user job", () => {
  assert.match(source, /\{ id: "scorecard", label: "Home" \}/);
  assert.match(source, /\{ id: "overview", label: "Game Plan" \}/);
  assert.match(source, /\{ id: "structure", label: "Coverage" \}/);
  assert.match(source, /Deck Snapshot/);
  assert.match(source, /Needs Attention/);
  assert.match(source, /Likely Cuts/);
  assert.match(source, /Score Details/);
  assert.match(source, /Core Identity/);
  assert.match(source, /Synergy Clusters/);
  assert.match(source, /Role Balance/);
  assert.match(source, /Answer Gaps/);
  assert.match(source, /Curve Bands/);
  assert.match(source, /function ManaTab/);
});

test("import UI exposes only the Moxfield URL flow", () => {
  assert.match(source, /Moxfield Import/);
  assert.match(source, /Import & Analyze/);
  assert.match(source, /https:\/\/moxfield\.com\/decks\/\.\.\./);
  assert.match(source, /onImport=\{handleMoxfieldImport\}/);
  assert.doesNotMatch(source, /Commander Override/);
  assert.doesNotMatch(source, /Companion Override/);
  assert.doesNotMatch(source, /Analyze Deck/);
  assert.doesNotMatch(source, /placeholder=\{"1 Sol Ring/);
});

test("home and snapshot render explicit action-oriented findings", () => {
  assert.match(source, /Active Fixes/);
  assert.match(source, /Problem/);
  assert.match(source, /Action/);
  assert.match(source, /finding\.detail/);
  assert.match(source, /finding\.action/);
  assert.doesNotMatch(source, /Urgent/);
});

test("old nine-box top metric strip labels are removed", () => {
  assert.match(source, /Deck Snapshot/);
  assert.match(source, /Mana Fit/);
  assert.doesNotMatch(source, /Metric label="Overall"/);
  assert.doesNotMatch(source, /Metric label="Bracket"/);
  assert.doesNotMatch(source, /Metric label="Core Syn"/);
  assert.doesNotMatch(source, /Metric label="Findings"/);
});
