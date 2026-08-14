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

test("reduced card images open full-resolution viewport-safe previews with oracle text", () => {
  assert.match(source, /function CardHoverPreview/);
  assert.match(source, /function PreviewableCardImage/);
  assert.match(source, /function CardPreview/);
  assert.match(source, /function cardFullPreviewUrl/);
  assert.match(source, /card\?\.image_uris\?\.png/);
  assert.match(source, /faceImages\?\.png/);
  assert.match(source, /function cardOracleText/);
  assert.match(source, /face\.oracle_text/);
  assert.match(source, /Oracle text/);
  assert.match(source, /createPortal\(preview, document\.body\)/);
  assert.match(source, /window\.matchMedia\("\(min-width: 1024px\) and \(hover: hover\) and \(pointer: fine\)"\)/);
  assert.match(source, /const fitsRight/);
  assert.match(source, /const fitsLeft/);
  assert.match(source, /Math\.min\(unclampedLeft/);
  assert.match(source, /Math\.min\(unclampedTop/);
  assert.match(source, /fixed z-50/);
  assert.match(source, /maxHeight: previewPosition\.maxHeight/);
  assert.match(source, /overflow-y-auto/);
  assert.match(source, /onLoad=\{updatePreviewPosition\}/);
  assert.match(source, /card\?\.image_uris\?\.normal/);
  assert.match(source, /card_faces\?\.find/);
  assert.ok((source.match(/<PreviewableCardImage/g) || []).length >= 5);
  assert.doesNotMatch(source, /<img src=\{cardPreviewUrl\(card\)\}/);
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

test("mobile tab bar centers the active tab whenever selection changes", () => {
  assert.match(source, /function MobileTabBar/);
  assert.match(source, /const navRef = useRef\(null\)/);
  assert.match(source, /data-mobile-tab=\{mobile \? tab\.id : undefined\}/);
  assert.match(source, /querySelector\(`\[data-mobile-tab="\$\{activeTab\}"\]`\)/);
  assert.match(source, /scrollIntoView\(\{ behavior: "smooth", block: "nearest", inline: "center" \}\)/);
  assert.match(source, /\}, \[activeTab\]\)/);
});

test("deck identity and snapshot render only on Home below the tablet tabs", () => {
  assert.match(source, /function HomeDeckHeader/);
  assert.match(source, /activeTab === "scorecard" && \(\s*<header className="space-y-4">/);
  assert.match(source, /<HomeDeckHeader deck=\{deck\} coreCards=\{coreCards\} toggleCoreCard=\{toggleCoreCard\} \/>/);
  assert.match(source, /<SummaryStrip analysis=\{analysis\} deck=\{deck\} analysisReady=\{analysisReady\} \/>/);

  const desktopTabsIndex = source.indexOf('<nav className="sticky top-0');
  const homeHeaderIndex = source.indexOf('{activeTab === "scorecard" && (', desktopTabsIndex);
  assert.ok(desktopTabsIndex >= 0);
  assert.ok(homeHeaderIndex > desktopTabsIndex);
});

test("desktop navigation uses a divided left sidebar without a redundant import pop-out", () => {
  assert.match(source, /function DesktopSidebar/);
  assert.match(source, /lg:grid-cols-\[280px_minmax\(0,1fr\)\]/);
  assert.match(source, /h-screen flex-col border-r border-neutral-800/);
  assert.match(source, /aria-label="Analysis sections"/);
  assert.match(source, /function DesktopSidebar\(\{ activeTab, setActiveTab, inputProps \}\)/);
  assert.match(source, /data-desktop-tab=\{vertical \? tab\.id : undefined\}/);
  assert.match(source, /setActiveTab=\{setActiveTab\} vertical/);
  assert.match(source, /md:flex lg:hidden/);
  const sidebar = source.slice(source.indexOf("function DesktopSidebar"), source.indexOf("function MobileTabBar"));
  assert.match(sidebar, /<InputControls \{\.\.\.inputProps\} compact showTitle=\{false\} sidebar \/>/);
});

test("desktop places the Moxfield importer in the top-left sidebar while narrow layouts retain the panel", () => {
  assert.doesNotMatch(source, /function DesktopImportBar/);
  assert.doesNotMatch(source, /aria-label="Desktop Moxfield import"/);
  assert.doesNotMatch(source, /sticky top-0 z-30 hidden lg:block/);
  assert.match(source, /<InputControls \{\.\.\.inputProps\} compact showTitle=\{false\} sidebar \/>/);
  assert.match(source, /inputProps=\{inputProps\}/);
  assert.match(source, /<aside aria-label="Deck settings" className="border-b border-neutral-800 bg-neutral-950\/95 p-3 lg:hidden">/);
  assert.match(source, /className="absolute left-2 top-2 z-40 .* lg:hidden"/);
});

test("analysis tabs render simple icons on desktop and mobile", () => {
  assert.match(source, /const TAB_ICON_PATHS =/);
  assert.match(source, /function TabIcon/);
  assert.match(source, /<TabIcon tabId=\{tab\.id\} \/>/);
  for (const tabId of ["scorecard", "overview", "structure", "power", "mana", "cards", "construct", "mulligan", "cuts", "upgrades", "debug"]) {
    assert.match(source, new RegExp(`\\b${tabId}: \\[`));
  }
});

test("build tab provides a three-zone Moxfield sideboard construction workflow", () => {
  assert.match(source, /\{ id: "construct", label: "Build" \}/);
  assert.match(source, /function DeckConstructionTab/);
  assert.match(source, /Build from the Moxfield sideboard/);
  assert.match(source, /Pick One/);
  assert.match(source, /Versus/);
  assert.match(source, /Add to main deck/);
  assert.match(source, /Choose this card/);
  assert.match(source, /Set aside/);
  assert.match(source, /type: "versusComparison"/);
  assert.match(source, /type: "versusComparisonSetAside"/);
  assert.match(source, /sourceLabel/);
  assert.match(source, /Main deck card/);
  assert.match(source, /Candidate pool card/);
  assert.match(source, /counts.main >= 100/);
  assert.match(source, /object-contain/);
  assert.match(source, /h-\[min\(46vh,26rem\)\]/);
  assert.match(source, /sm:grid-cols-\[minmax\(160px,30%\)_minmax\(0,1fr\)\]/);
  assert.match(source, /Skip, redraw draft/);
  assert.match(source, /Neither — set both aside/);
  assert.match(source, /Both cards move to Set Aside\. Undo restores their original zones\./);
  assert.match(source, /hover:border-rose-400/);
  assert.match(source, /hover:outline-rose-500/);
  assert.match(source, /type: "neitherSetAside"/);
  assert.match(source, /setAsideVersusPair/);
  assert.match(source, /const CONSTRUCTION_ZONE_OPTIONS/);
  assert.match(source, /draggable/);
  assert.match(source, /onDragStart/);
  assert.match(source, /onDrop=\{handleDrop\}/);
  assert.match(source, /Move to…/);
  assert.match(source, /type: "moveStack"/);
  assert.match(source, /moveConstructionStack/);
  assert.match(source, /activeDropZone === zone/);
  assert.match(source, /Move Main Deck to Sideboard/);
  assert.match(source, /Confirm move/);
  assert.match(source, /Moxfield sideboard\/candidate pool/);
  assert.match(source, /Command-zone cards stay separate and are not moved/);
  assert.match(source, /disabled=\{!canMoveMain\}/);
  assert.match(source, /type: "moveMainToPool"/);
  assert.match(source, /moveMainToCandidatePool/);
  assert.match(source, /isLand\(findCard\(cardMap, entry\.name\)\)/);
  assert.match(source, /Add all candidate-pool lands/);
  assert.match(source, /No recognized land cards are available in the candidate pool/);
  assert.match(source, /type: "addCandidateLands"/);
  assert.match(source, /addCandidateLandsToMain/);
  assert.match(source, /label="Deck Size"/);
  assert.doesNotMatch(source, /Metric label="Total Deck"/);
  assert.match(source, /shouldOfferMainDraft/);
  assert.match(source, /Start draft from the oversized main deck/);
  assert.match(source, /setMode\("versus"\)/);
  assert.match(source, /title="Main Deck"/);
  assert.match(source, /title="Candidate Pool"/);
  assert.match(source, /title="Set Aside"/);
  assert.match(source, /type: "undo"/);
  assert.match(source, /type: "restart"/);
  assert.match(source, /applyConstructionSession\(currentDeck, next\)/);
  assert.match(source, /activeTab === "construct"/);
});

test("mobile deck snapshot uses a contained horizontal snap row", () => {
  assert.match(source, /aria-label="Deck snapshot metrics"/);
  assert.match(source, /snap-x snap-mandatory/);
  assert.match(source, /overflow-x-auto overscroll-x-contain/);
  assert.match(source, /w-\[82vw\] max-w-\[82vw\].*snap-start/);
  assert.match(source, /md:grid md:grid-cols-2/);
  assert.match(source, /xl:grid-cols-4/);
});

test("mulligan lab draws independent hands and renders strength and glue analysis", () => {
  assert.match(source, /\{ id: "mulligan", label: "Mulligan" \}/);
  assert.match(source, /function MulliganTab/);
  assert.match(source, /drawOpeningHand\(deck\)/);
  assert.match(source, /analyzeOpeningHand\(\{ deck, hand, cardMap, analysis, coreCards \}\)/);
  assert.match(source, /Every attempt reshuffles the complete main deck/);
  assert.match(source, /Opening Hand Lab/);
  assert.match(source, /result\.verdict\.label/);
  assert.match(source, /label="Colored sources"/);
  assert.match(source, /result\.metrics\.coloredSources/);
  assert.match(source, /Glue categories/);
  assert.match(source, /result\.glueNeeds/);
  assert.match(source, /need\.examples/);
  assert.match(source, /Examples from this deck/);
  assert.match(source, /Select your opening hand/);
  assert.match(source, /Analyze selected hand/);
  assert.match(source, /addCardToOpeningHand/);
  assert.match(source, /manualHand\.length !== 7/);
  assert.doesNotMatch(source, /result\.glueCards/);
  assert.match(source, /activeTab === "mulligan"/);
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
  assert.match(source, /<form\s+onSubmit=\{\(event\) => \{\s*event\.preventDefault\(\);\s*onImport\(\);\s*\}\}/);
  assert.match(source, /<button type="submit" disabled=\{loading \|\| !moxfieldUrl\.trim\(\)\}/);
  assert.match(source, /Paste clipboard/);
  assert.match(source, /navigator\.clipboard\?\.readText/);
  assert.match(source, /await navigator\.clipboard\.readText\(\)/);
  assert.match(source, /https:\/\/moxfield\.com\/decks\/\.\.\./);
  assert.match(source, /onImport: handleMoxfieldImport/);
  assert.match(source, /flex min-h-screen items-center justify-center/);
  assert.match(source, /<InputControls \{\.\.\.inputProps\} fullPage \/>/);
  assert.doesNotMatch(source, /function EmptyWorkspace/);
  assert.doesNotMatch(source, /Paste a Moxfield link to start\./);
  assert.doesNotMatch(source, /The app imports the deck, detects command-zone cards/);
  assert.doesNotMatch(source, /Commander Override/);
  assert.doesNotMatch(source, /Companion Override/);
  assert.doesNotMatch(source, /Analyze Deck/);
  assert.doesNotMatch(source, /placeholder=\{"1 Sol Ring/);
});

test("import preflights parsed and seeded decks before committing new analysis state", () => {
  const analyzeStart = source.indexOf("const analyzeDeckValues = useCallback");
  const parseIndex = source.indexOf("const parsedDeck = parseDecklist", analyzeStart);
  const seedIndex = source.indexOf("const seededDeck = validateCommandZone", analyzeStart);
  const remoteResetIndex = source.indexOf("setRemoteAnalysis(null)", analyzeStart);
  const deckCommitIndex = source.indexOf("setDeckModel(seededDeck)", analyzeStart);
  assert.ok(analyzeStart >= 0);
  assert.ok(parseIndex > analyzeStart);
  assert.ok(seedIndex > parseIndex);
  assert.ok(remoteResetIndex > seedIndex);
  assert.ok(deckCommitIndex > remoteResetIndex);

  const importStart = source.indexOf("const importMoxfieldUrl = useCallback");
  const analyzeCallIndex = source.indexOf("await analyzeDeckValues({", importStart);
  const deckInputCommitIndex = source.indexOf("setDeckInput(importedDeckText)", importStart);
  assert.ok(analyzeCallIndex > importStart);
  assert.ok(deckInputCommitIndex > analyzeCallIndex);
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
  assert.match(source, /<PreviewableCardImage\s+card=\{item\.card\}/);
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
  assert.match(source, /grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 min-\[1920px\]:grid-cols-7/);
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
