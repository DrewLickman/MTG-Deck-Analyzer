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

test("home renders a build roadmap for deckbuilding decisions", () => {
  assert.match(source, /const roadmap = analysis\.roadmap/);
  assert.match(source, /Build Roadmap/);
  assert.match(source, /roadmap\.headline/);
  assert.match(source, /roadmap\.steps/);
  assert.match(source, /First Cuts/);
  assert.match(source, /roadmap\.cutPriorities/);
  assert.match(source, /Protect/);
  assert.match(source, /roadmap\.protect/);
});

test("home renders an action plan queue with cuts adds and tab navigation", () => {
  assert.match(source, /function ActionPlanPanel/);
  assert.match(source, /const actionPlan = analysis\.actionPlan/);
  assert.match(source, /Action Plan/);
  assert.match(source, /actionPlan\?\.headline/);
  assert.match(source, /actionPlan\?\.requiredCount/);
  assert.match(source, /actionPlan\?\.recommendedCount/);
  assert.match(source, /Open \{TABS\.find/);
  assert.match(source, /setActiveTab\(task\.tab\)/);
  assert.match(source, /Next Cuts/);
  assert.match(source, /actionPlan\?\.nextCuts/);
  assert.match(source, /Next Adds/);
  assert.match(source, /actionPlan\?\.nextAdds/);
});

test("local analysis builds roadmap data", () => {
  assert.match(source, /analysis\.roadmap/);
  assert.match(source, /analysis\.actionPlan/);
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

test("cuts tab renders exact required cut count controls", () => {
  assert.match(source, /const deckSizePlan = analysis\.deckSizePlan/);
  assert.match(source, /const requiredCuts = deckSizePlan\.cutsNeeded/);
  assert.match(source, /Need \{requiredCuts\} cut/);
  assert.match(source, /setCutCount\(requiredCuts \|\| 3\)/);
  assert.match(source, /\[requiredCuts, 1, 3, 10\]/);
  assert.match(source, /sizeCutRecommended/);
});

test("cuts tab renders a deck-wide visual tier list", () => {
  assert.match(source, /import \{ buildTierRows \} from "\.\/lib\/deckTiers\.mjs"/);
  assert.match(source, /S: \{ label: "S"/);
  assert.match(source, /F: \{ label: "F"/);
  assert.match(source, /function TierListCard/);
  assert.match(source, /cardPreviewUrl\(item\.card\)/);
  assert.match(source, /<ManaCostDisplay card=\{item\.card\} \/>/);
  assert.match(source, /flex min-h-40 flex-1 flex-col/);
  assert.doesNotMatch(source, /absolute inset-x-0 bottom-0/);
  assert.doesNotMatch(source, /backdrop-blur-sm/);
  assert.match(source, /function DeckTierList/);
  assert.match(source, /const tierRows = useMemo\(\(\) => buildTierRows/);
  assert.match(source, /<DeckTierList/);
  assert.match(source, /cutDecisions=\{cutDecisions\}/);
  assert.match(source, /decision === "cut"/);
  assert.match(source, /decision === "keep"/);
  assert.match(source, /Cut filters below do not hide cards here/);
  assert.match(source, /grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5/);
});

test("cut export uses visible required cuts first", () => {
  assert.match(source, /requiredExportCuts/);
  assert.match(source, /additionalCutIdeas/);
  assert.match(source, /Required cuts/);
  assert.match(source, /Additional cut ideas/);
  assert.match(source, /Do not cut/);
  assert.match(source, /keptCandidateKeys/);
});

test("cut export can be copied with feedback", () => {
  assert.match(source, /const \[exportCopyStatus, setExportCopyStatus\] = useState\("idle"\)/);
  assert.match(source, /setExportCopyStatus\("idle"\)/);
  assert.match(source, /const copyExportText = async \(\) =>/);
  assert.match(source, /navigator\.clipboard\?\.writeText/);
  assert.match(source, /navigator\.clipboard\.writeText\(exportText\)/);
  assert.match(source, /setExportCopyStatus\("copied"\)/);
  assert.match(source, /setExportCopyStatus\("error"\)/);
  assert.match(source, /Copy change plan/);
  assert.match(source, /Clipboard access was blocked/);
});

test("cuts tab supports interactive cut review decisions", () => {
  assert.match(source, /const \[cutDecisions, setCutDecisions\] = useState\(\{\}\)/);
  assert.match(source, /function CutCandidateCard\(\{ candidate, cardMap, analysisReady, decision, onDecision \}\)/);
  assert.match(source, /onDecision\(candidate\.name, decision === "cut" \? null : "cut"\)/);
  assert.match(source, /onDecision\(candidate\.name, decision === "keep" \? null : "keep"\)/);
  assert.match(source, /Cut Review/);
  assert.match(source, /Accepted cuts/);
  assert.match(source, /Kept candidates/);
});

test("cuts review has bulk accept and clear actions", () => {
  assert.match(source, /const acceptRecommendedCuts = \(\) =>/);
  assert.match(source, /for \(const candidate of requiredExportCuts\)/);
  assert.match(source, /next\[normalizeName\(candidate\.name\)\] = "cut"/);
  assert.match(source, /const clearCutReview = \(\) =>/);
  assert.match(source, /setCutDecisions\(\{\}\)/);
  assert.match(source, /Accept recommended cuts/);
  assert.match(source, /Clear review/);
});

test("cuts review shows projected deck size and automatic fill choices", () => {
  assert.match(source, /projectedTotal/);
  assert.match(source, /projectedExportTotal/);
  assert.match(source, /projectedExportMeetsTarget/);
  assert.match(source, /remainingManualCuts/);
  assert.match(source, /Auto-fill Cuts/);
  assert.match(source, /Projected Export Total/);
});

test("compare slots expose rank pressure and review decisions", () => {
  assert.match(source, /function CompareCandidatePanel/);
  assert.match(source, /candidate\.cutPressure/);
  assert.match(source, /candidate\.keepPressure/);
  assert.match(source, /candidate\.replacementNeed/);
  assert.match(source, /candidate\.cutReason/);
  assert.match(source, /candidate\.keepRisk/);
  assert.match(source, /<CompareCandidatePanel/);
  assert.match(source, /decision=\{cutDecisions\[normalizeName\(candidate\.name\)\]\}/);
  assert.match(source, /onDecision=\{setCandidateDecision\}/);
});

test("upgrades tab renders copyable add plan", () => {
  assert.match(source, /function UpgradesTab/);
  assert.match(source, /const roadmap = analysis\.roadmap/);
  assert.match(source, /const \[addPlanCopyStatus, setAddPlanCopyStatus\] = useState\("idle"\)/);
  assert.match(source, /const addPlanText = \[/);
  assert.match(source, /const copyAddPlan = async \(\) =>/);
  assert.match(source, /navigator\.clipboard\.writeText\(addPlanText\)/);
  assert.match(source, /Add Plan/);
  assert.match(source, /Copy add plan/);
  assert.match(source, /Suggested Adds/);
  assert.match(source, /Candidate Pool/);
});
