import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../mtg-analyzer.jsx", import.meta.url), "utf8");

test("Home renders only canonical next steps instead of duplicate recommendation panels", () => {
  assert.match(source, /function NextStepCard/);
  assert.match(source, /const nextSteps = \(analysis\.nextSteps \|\| \[\]\)\.slice\(0, 3\)/);
  assert.match(source, /<NextStepCard key=\{step\.id\} step=\{step\} setActiveTab=\{setActiveTab\} \/>/);
  assert.match(source, /One action each/);
  assert.doesNotMatch(source, /function ActionPlanPanel/);
  assert.doesNotMatch(source, /Build Roadmap/);
  assert.doesNotMatch(source, /Likely Cuts/);
  assert.doesNotMatch(source, /Upgrade Ideas/);
});

test("Home snapshot has four compact decision metrics", () => {
  assert.match(source, /aria-label="Deck snapshot metrics"/);
  assert.match(source, /label="Main deck"/);
  assert.match(source, /label="Mana"/);
  assert.match(source, /label="Answers"/);
  assert.match(source, /label="Power"/);
  assert.doesNotMatch(source, /snap-x snap-mandatory/);
});

test("game plan uses three non-repeating stages and compact secondary cluster tags", () => {
  assert.match(source, /Three-Stage Plan/);
  assert.match(source, /winPlan\?\.stages/);
  assert.match(source, /stage\.cards\.length/);
  assert.match(source, /Also tagged here/);
  assert.match(source, /cluster\.secondaryCards/);
  assert.doesNotMatch(source, /<details key=\{cluster\.name\}[^>]* open>/);
});

test("coverage defaults to compact role summaries and only foregrounds answer gaps", () => {
  assert.match(source, /<details key=\{role\.key\}/);
  assert.match(source, /Target \{role\.target\} · \{role\.status\}/);
  assert.match(source, /const gaps = \(structure\.answerGaps \|\| \[\]\)\.filter/);
  assert.match(source, /Covered categories/);
  assert.doesNotMatch(source, /Role Balance/);
});

test("power uses one grouped driver list and a readable Game Changer date", () => {
  assert.match(source, /Detected Drivers/);
  assert.match(source, /const absentDrivers/);
  assert.match(source, /Game Changer list updated/);
  assert.doesNotMatch(source, /gameChangerVersion/);
  assert.doesNotMatch(source, /Bracket Dimensions/);
});

test("mana separates generic costs from colored pip demand and uses ordered bands", () => {
  assert.match(source, /Colored Pip Demand/);
  assert.match(source, /Generic mana in costs:/);
  assert.match(source, /Setup, early, commander turn, midgame, then top end/);
  assert.doesNotMatch(source, /manaFit\.reasons\.slice/);
});

test("card list reports analyzed nonlands, groups filters, and hides broad cut signals", () => {
  assert.match(source, /Card List/);
  assert.match(source, /analyzedNonLandCount/);
  assert.match(source, /const analyzedNonLandCount = useMemo\(\(\) => \(analysis\.scores \|\| \[\]\)\.length/);
  assert.match(source, /ROLE_FILTER_GROUPS/);
  assert.match(source, /<optgroup key=\{group\.label\} label=\{group\.label\}>/);
  assert.match(source, /const shortlistLimit = Math\.max\(10/);
  assert.match(source, /function cardConclusion/);
  assert.match(source, /Remove core mark/);
  assert.doesNotMatch(source, /Dense Card Table/);
});

test("Build explains commander math, keeps actions compact, and shows weak signals first", () => {
  assert.match(source, /\$\{counts\.main\} main \+ \$\{commanderCount\} commander = \$\{totalDeckCount\}/);
  assert.match(source, /role="toolbar" aria-label="Build actions"/);
  assert.match(source, /Bulk actions/);
  assert.match(source, /aria-label=\{`Move \$\{entry\.name\} to another zone`\}/);
  assert.match(source, />Move<\/summary>/);
  assert.match(source, /const belowTargetSignals/);
  assert.match(source, /Show covered signals/);
  assert.match(source, /title="Candidates"/);
  assert.doesNotMatch(source, /Move to…/);
});

test("Mulligan presents exclusive random and manual modes without additive repair labels", () => {
  const activeMulligan = source.slice(source.lastIndexOf("function MulliganTab"), source.indexOf("function DebugTab", source.lastIndexOf("function MulliganTab")));
  assert.match(activeMulligan, /Random Hand/);
  assert.match(activeMulligan, /Manual Hand/);
  assert.match(activeMulligan, /mode === "random"/);
  assert.match(activeMulligan, /mode === "manual"/);
  assert.match(activeMulligan, /<MulliganResult selected=\{selected\} result=\{result\} cardMap=\{cardMap\} \/>/);
  assert.match(activeMulligan, /Seven-slot hand/);
  assert.match(source, /What would improve this hand/);
  assert.match(source, /Result \{example\.resultingScore\}\/100/);
  assert.doesNotMatch(activeMulligan, /Glue categories/);
  assert.doesNotMatch(activeMulligan, /Empty card slot/);
  assert.doesNotMatch(source.slice(source.indexOf("function MulliganResult"), source.indexOf("function MulliganTab", source.indexOf("function MulliganResult"))), /up to \+\{need\.improvement\}/);
});

test("Cuts selects into one shared detail panel and keeps exports collapsed", () => {
  assert.match(source, /function DeckTierList/);
  assert.match(source, /Review \$\{item\.name\} cut details/);
  assert.match(source, /Suggestion Details/);
  assert.match(source, /candidateNames=\{visibleCandidateNames\}/);
  assert.match(source, /Review \$\{visibleCandidates\.length\} suggestion/);
  assert.match(source, /Show more/);
  assert.match(source, /input list="cut-shortlist"/);
  assert.match(source, /Object\.keys\(cutDecisions\)\.length > 0/);
  assert.match(source, /Export decisions/);
  assert.doesNotMatch(source, /Cut filters below do not hide cards here/);
});

test("Upgrades makes exact swaps primary and groups each candidate once", () => {
  const activeUpgrades = source.slice(source.lastIndexOf("function UpgradesTab"), source.indexOf("function HandCard", source.lastIndexOf("function UpgradesTab")));
  assert.match(activeUpgrades, /Recommended Swaps/);
  assert.match(activeUpgrades, /Suggested Cards/);
  assert.match(activeUpgrades, /\["add", "maybe", "skip"\]/);
  assert.match(activeUpgrades, /const byName = new Map\(\)/);
  assert.doesNotMatch(activeUpgrades, /Add Plan/);
  assert.doesNotMatch(activeUpgrades, /Candidate Cards/);
});

test("navigation groups jobs and avoids horizontal navigation scrollers", () => {
  assert.match(source, /const TAB_GROUPS/);
  assert.match(source, /id: "analysis"/);
  assert.match(source, /id: "build"/);
  assert.match(source, /id: "test"/);
  assert.match(source, /const SHOW_DEBUG = process\.env\.NODE_ENV === "development"/);
  assert.match(source, /function TabletTabNav/);
  assert.match(source, /grid-cols-4/);
  assert.match(source, /function MobileTabBar/);
  assert.match(source, /grid-cols-5/);
  assert.match(source, /More/);
  const navigation = source.slice(source.indexOf("function TabletTabNav"), source.indexOf("function CalculatingAnalysisPanel"));
  assert.doesNotMatch(navigation, /overflow-x-auto/);
});

test("desktop sidebar stays compact before it needs to scroll", () => {
  const desktopSidebar = source.slice(source.indexOf("function DesktopSidebar"), source.indexOf("function TabletTabNav"));
  assert.match(source, /lg:grid-cols-\[256px_minmax\(0,1fr\)\]/);
  assert.match(source, /const sizeClass = mobile \? "min-h-12[\s\S]*min-h-9 w-full justify-start px-2\.5 py-1\.5 text-left text-\[13px\]/);
  assert.match(source, /sidebar \? "space-y-2" : "space-y-3"/);
  assert.match(desktopSidebar, /overflow-y-auto p-2/);
  assert.match(desktopSidebar, /space-y-3/);
});

test("Moxfield and Archidekt share one import flow and analysis is preflighted before commit", () => {
  assert.match(source, /Deck Import/);
  assert.match(source, /Moxfield or Archidekt/);
  assert.match(source, /\/api\/import\/deck/);
  assert.match(source, /Import & Analyze/);
  assert.match(source, /navigator\.clipboard\?\.readText/);
  const analyzeStart = source.indexOf("const analyzeDeckValues = useCallback");
  const seedIndex = source.indexOf("const seededDeck = validateCommandZone", analyzeStart);
  const deckCommitIndex = source.indexOf("setDeckModel(seededDeck)", analyzeStart);
  assert.ok(seedIndex > analyzeStart);
  assert.ok(deckCommitIndex > seedIndex);
});
