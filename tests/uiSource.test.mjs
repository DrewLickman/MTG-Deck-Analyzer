import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../mtg-analyzer.jsx", import.meta.url), "utf8");

test("card UI renders grouped collapsible type and role evidence sections", () => {
  assert.match(source, /function CardGroupSections/);
  assert.match(source, /Type Groups/);
  assert.match(source, /Role Evidence Groups/);
  assert.match(source, /typeGroups\.map/);
  assert.match(source, /roleGroups\.map/);
  assert.match(source, /<details[\s\S]*summary/);
  assert.match(source, /group\.cards\.map/);
  assert.match(source, /group\.evidence\.length/);
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

test("overview renders commander role classification details", () => {
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
