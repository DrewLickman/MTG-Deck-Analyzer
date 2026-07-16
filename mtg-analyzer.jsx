"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { COLOR_HEX, COLOR_LABEL, MANA_CURVE_COLOR_ORDER, ROLE_LABELS, findCard, formatTextSymbols, getCardText, getManaCost, getManaColorKeys, getRoleKeys, normalizeName } from "./lib/cardUtils.mjs";
import { DEFAULT_ANALYSIS_SETTINGS, buildAnalysisPrompt, buildLocalAnalysis, extractJSON, mergeAnalysis, resolveAnalysisSettings } from "./lib/deckAnalysis.mjs";
import { buildTierRows } from "./lib/deckTiers.mjs";
import { deckLookupNames, parseDecklist, validateCommandZone } from "./lib/deckParser.mjs";
import { analyzeOpeningHand, drawOpeningHand } from "./lib/openingHand.mjs";
import { fetchScryfall, seedScryfallResults } from "./lib/scryfall.mjs";

const TABS = [
  { id: "scorecard", label: "Home" },
  { id: "overview", label: "Game Plan" },
  { id: "structure", label: "Coverage" },
  { id: "power", label: "Power" },
  { id: "mana", label: "Mana" },
  { id: "cards", label: "Cards" },
  { id: "mulligan", label: "Mulligan" },
  { id: "cuts", label: "Cuts" },
  { id: "upgrades", label: "Upgrades" },
  { id: "debug", label: "Debug" },
];

const ROLE_FILTERS = [
  { id: "all", label: "All" },
  { id: "ramp", label: "Ramp" },
  { id: "draw", label: "Draw" },
  { id: "removal", label: "Removal" },
  { id: "boardWipe", label: "Wipes" },
  { id: "tutor", label: "Tutors" },
  { id: "cardSelection", label: "Selection" },
  { id: "protection", label: "Protection" },
  { id: "recursion", label: "Recursion" },
  { id: "engine", label: "Engines" },
  { id: "payoff", label: "Payoffs" },
  { id: "finisher", label: "Finishers" },
  { id: "tokenMaker", label: "Tokens" },
  { id: "sacrificeOutlet", label: "Sac Outlets" },
  { id: "graveyardHate", label: "Grave Hate" },
  { id: "stax", label: "Stax" },
  { id: "costReducer", label: "Reducers" },
  { id: "manaFixing", label: "Fixing" },
  { id: "haste", label: "Haste" },
  { id: "evasion", label: "Evasion" },
  { id: "lifeGain", label: "Lifegain" },
  { id: "gameChanger", label: "Game Changers" },
  { id: "core", label: "Core" },
];

function extractMoxfieldDeckUrl(value = "") {
  const match = String(value).trim().match(/https?:\/\/(?:www\.)?moxfield\.com\/decks\/[a-zA-Z0-9_-]+(?:[^\s)"'<>]*)?/i);
  return match?.[0] || "";
}

function names(entries = []) {
  return entries.map((entry) => entry.name).join(" + ") || "None";
}

function scoreColor(score) {
  if (score >= 7) return "text-emerald-300 font-bold";
  if (score >= 4) return "text-emerald-300";
  if (score >= 1) return "text-neutral-200";
  if (score === 0) return "text-neutral-500";
  if (score >= -2) return "text-amber-300";
  if (score >= -5) return "text-rose-300";
  return "text-rose-400 font-bold";
}

function panelClass(extra = "") {
  return `rounded-lg border border-neutral-800 bg-neutral-900/80 ${extra}`;
}

function Metric({ label, value, tone = "neutral", sub }) {
  const displayValue = value ?? "-";
  const compactValue = String(displayValue).length > 8;
  const toneClass = {
    neutral: "border-neutral-800 bg-neutral-900",
    good: "border-emerald-900 bg-emerald-950/40",
    warn: "border-amber-900 bg-amber-950/40",
    bad: "border-rose-900 bg-rose-950/40",
  }[tone];

  return (
    <div className={`rounded-lg border px-3 py-2 ${toneClass}`}>
      <div className="text-[11px] uppercase tracking-wide text-neutral-500">{label}</div>
      <div className={`mt-1 font-semibold leading-tight text-neutral-50 ${compactValue ? "text-sm sm:text-base" : "text-lg sm:text-xl"}`}>{displayValue}</div>
      {sub && <div className="mt-0.5 text-xs text-neutral-500">{sub}</div>}
    </div>
  );
}

function RoleChip({ role }) {
  return (
    <span className="inline-flex rounded border border-neutral-700 bg-neutral-800 px-1.5 py-0.5 text-[11px] text-neutral-300">
      {ROLE_LABELS[role] || role}
    </span>
  );
}

function manaTokens(manaCost) {
  return Array.from(String(manaCost || "").matchAll(/\{([^}]+)\}/g)).map((match) => match[1]);
}

function ManaSymbol({ token }) {
  const upper = String(token || "").toUpperCase();
  const asset = upper.length === 1 && ["W", "U", "B", "R", "G", "C", "T"].includes(upper) ? `/mana/${upper.toLowerCase()}.svg` : null;
  if (asset) {
    return <img src={asset} alt={`{${token}}`} title={`{${token}}`} className="h-5 w-5 shrink-0" />;
  }
  return (
    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-neutral-500 bg-neutral-200 px-1 text-[10px] font-bold leading-none text-neutral-900" title={`{${token}}`}>
      {upper}
    </span>
  );
}

function ManaCostDisplay({ card }) {
  const tokens = manaTokens(getManaCost(card));
  return (
    <span className="inline-flex min-h-7 items-center gap-0.5 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm leading-none text-neutral-100">
      {tokens.length ? tokens.map((token, index) => <ManaSymbol key={`${token}-${index}`} token={token} />) : "No cost"}
    </span>
  );
}

function cardPreviewUrl(card) {
  return card?.image_uris?.normal || card?.card_faces?.find((face) => face.image_uris?.normal)?.image_uris?.normal || null;
}

function CardPreview({ card, name }) {
  const imageUrl = cardPreviewUrl(card);
  const [open, setOpen] = useState(false);
  return (
    <div className="group relative inline-flex" onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="rounded border border-neutral-800 bg-neutral-950/60 px-2 py-1 text-xs text-neutral-300 group-hover:border-amber-500 group-hover:text-amber-200"
      >
        {name}
      </button>
      <div className={`pointer-events-none absolute left-0 top-full z-30 mt-2 w-56 rounded-lg border border-neutral-700 bg-neutral-950 p-2 shadow-2xl ${open ? "block" : "hidden group-hover:block"}`}>
        {imageUrl ? (
          <img src={imageUrl} alt={name} className="w-full rounded-md" loading="lazy" />
        ) : (
          <div className="flex aspect-[5/7] items-center justify-center rounded-md border border-neutral-800 bg-neutral-900 p-3 text-center text-xs text-neutral-500">No image available</div>
        )}
      </div>
    </div>
  );
}

function StatusLine({ ok, children }) {
  return (
    <div className={`rounded-lg border px-3 py-2 text-sm ${ok ? "border-emerald-900 bg-emerald-950/30 text-emerald-200" : "border-amber-900 bg-amber-950/30 text-amber-200"}`}>
      {children}
    </div>
  );
}

function statusClasses(status) {
  if (status === "good") return "border-emerald-900 bg-emerald-950/35 text-emerald-200";
  if (status === "bad" || status === "critical") return "border-rose-900 bg-rose-950/35 text-rose-200";
  if (status === "warning" || status === "warn") return "border-amber-900 bg-amber-950/35 text-amber-200";
  return "border-neutral-800 bg-neutral-950 text-neutral-300";
}

function confidenceClasses(confidence) {
  if (confidence === "high") return "border-rose-800 bg-rose-950/40 text-rose-200";
  if (confidence === "medium") return "border-amber-800 bg-amber-950/40 text-amber-200";
  return "border-neutral-700 bg-neutral-950 text-neutral-300";
}

function toneForScore(score) {
  if (score >= 70) return "good";
  if (score >= 50) return "warn";
  return "bad";
}

function settingValue(settings, key) {
  return settings?.[key] ?? DEFAULT_ANALYSIS_SETTINGS[key];
}

function calculationValue(ready, value) {
  return ready ? (value ?? "-") : "Calculating...";
}

function FindingCard({ finding }) {
  return (
    <div className={`rounded-lg border p-3 text-sm ${statusClasses(finding.severity)}`}>
      <div className="font-semibold">{finding.label}</div>
      <div className="mt-3 space-y-2">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-neutral-500">Problem</div>
          <div className="mt-1 text-neutral-300">{finding.detail}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-neutral-500">Action</div>
          <div className="mt-1 text-neutral-200">{finding.action}</div>
        </div>
      </div>
    </div>
  );
}

function MiniBar({ value, max = 12, status = "neutral" }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const color = status === "good" ? "bg-emerald-400" : status === "bad" ? "bg-rose-400" : status === "warn" ? "bg-amber-400" : "bg-neutral-500";
  return (
    <div className="h-1.5 overflow-hidden rounded bg-neutral-800">
      <div className={`h-full rounded ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

async function runRemoteAnalysis(prompt) {
  try {
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    const data = await res.json();
    if (data.skipped) return null;
    if (!res.ok || data.error) throw new Error(data.error?.message || "Analysis API error");
    const text = (data.content || []).map((block) => (block.type === "text" ? block.text : "")).join("");
    if (!text) throw new Error("Empty analysis response.");
    return extractJSON(text);
  } catch (error) {
    console.warn("Remote analysis unavailable; using local analysis.", error);
    return null;
  }
}

function IdentityReview({ deck, onUseFirst, onUseBottom }) {
  if (!deck) {
    return (
      <div className={panelClass("p-4")}>
        <div className="text-sm text-neutral-400">Paste a decklist to review detected command-zone cards.</div>
      </div>
    );
  }

  return (
    <div className={panelClass("p-4")}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-neutral-500">Detected Command Zone</div>
          <div className="mt-1 text-sm font-semibold text-neutral-100">{names(deck.commanders)}</div>
          {deck.companions.length > 0 && <div className="mt-1 text-xs text-neutral-400">Companion: {names(deck.companions)}</div>}
        </div>
        <div className="rounded border border-neutral-800 px-2 py-1 text-xs text-neutral-400">{deck.commandSource}</div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Metric label="Main" value={`${deck.cardCount}/${deck.expectedMainCount}`} tone={deck.cardCount === deck.expectedMainCount ? "good" : "warn"} />
        <Metric label="Outside Main" value={deck.sideboard.length + deck.considering.length} sub="Sideboard + considering" />
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {deck.firstCardCandidate && (
          <button type="button" onClick={onUseFirst} className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:border-amber-500 hover:text-amber-200">
            Use first card
          </button>
        )}
        {deck.bottomCommandCandidates.length > 0 && (
          <button type="button" onClick={onUseBottom} className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:border-amber-500 hover:text-amber-200">
            Use bottom block
          </button>
        )}
      </div>

      {deck.inferenceWarnings.length > 0 && (
        <div className="mt-3 space-y-2">
          {deck.inferenceWarnings.slice(0, 3).map((warning) => (
            <StatusLine key={warning} ok={false}>{warning}</StatusLine>
          ))}
        </div>
      )}
    </div>
  );
}

function InputControls({
  error,
  moxfieldUrl,
  draftDeck,
  loading,
  progress,
  onImport,
  onMoxfieldPaste,
  setMoxfieldUrl,
  showTitle = true,
}) {
  return (
    <div>
      {showTitle && (
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-amber-400">MTG Commander</div>
          <h1 className="mt-1 text-2xl font-bold text-neutral-50">Deck Analyzer</h1>
        </div>
      )}

      <div className={`${showTitle ? "mt-5" : "mt-3"} space-y-3`}>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-neutral-500">Moxfield Import</div>
          <div className="mt-1 text-xs text-neutral-500">Paste a public Moxfield deck link to import and analyze.</div>
        </div>
        <div className="grid gap-2">
          <input
            value={moxfieldUrl}
            onChange={(event) => setMoxfieldUrl(event.target.value)}
            onPaste={onMoxfieldPaste}
            placeholder="https://moxfield.com/decks/..."
            className="min-h-11 min-w-0 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-base text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-amber-500 sm:text-sm"
          />
          <button type="button" onClick={onImport} disabled={loading || !moxfieldUrl.trim()} className="min-h-11 rounded-lg bg-amber-500 px-3 py-2 text-sm font-bold text-neutral-950 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400">
            Import & Analyze
          </button>
        </div>

        {draftDeck && (
          <div className={panelClass("p-3")}>
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">Imported Deck</div>
            <div className="mt-1 text-sm font-semibold text-neutral-100">{names(draftDeck.commanders)}</div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Metric label="Main" value={`${draftDeck.cardCount}/${draftDeck.expectedMainCount}`} tone={draftDeck.cardCount === draftDeck.expectedMainCount ? "good" : "warn"} />
              <Metric label="Outside" value={draftDeck.sideboard.length + draftDeck.considering.length} sub="Side + maybe" />
            </div>
          </div>
        )}

        {error && <div className="rounded-lg border border-rose-900 bg-rose-950/40 p-3 text-sm text-rose-200">{error}</div>}
        {loading && <div className="rounded-lg border border-amber-900 bg-amber-950/30 p-3 text-sm text-amber-200">{progress || "Analyzing..."}</div>}
      </div>
    </div>
  );
}

function InputPanel(props) {
  const { draftDeck, hasAnalysis, sidePanelOpen } = props;

  if (!sidePanelOpen) return null;

  return (
    <aside className="border-b border-neutral-800 bg-neutral-950/95 p-3 lg:sticky lg:top-0 lg:max-h-screen lg:overflow-y-auto lg:border-b-0 lg:border-r lg:p-4">
      <div className="lg:hidden">
        {hasAnalysis ? (
          <details className="rounded-lg border border-neutral-800 bg-neutral-900/80">
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2">
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-amber-400">Import</div>
                <div className="text-sm font-semibold text-neutral-100">{names(draftDeck?.commanders || [])}</div>
              </div>
              <span className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-400">Edit</span>
            </summary>
            <div className="border-t border-neutral-800 p-3">
              <InputControls {...props} showTitle={false} />
            </div>
          </details>
        ) : (
          <InputControls {...props} />
        )}
      </div>

      <div className="hidden lg:block">
        <InputControls {...props} />
      </div>
    </aside>
  );
}

function EmptyWorkspace({ draftDeck, sidePanelOpen }) {
  if (!sidePanelOpen) return null;

  return (
    <main className="p-3 sm:p-5 lg:p-8">
      <div className="mx-auto max-w-6xl">
        <div className={panelClass("p-5")}>
          <div className="text-[11px] uppercase tracking-wide text-neutral-500">Ready</div>
          <h2 className="mt-2 text-2xl font-semibold text-neutral-50">Paste a Moxfield link to start.</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-400">The app imports the deck, detects command-zone cards, loads Scryfall data, and runs the analysis from that single source of truth.</p>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <Metric label="Commanders" value={draftDeck ? draftDeck.commanders.length : 0} />
            <Metric label="Companions" value={draftDeck ? draftDeck.companions.length : 0} />
            <Metric label="Main Count" value={draftDeck ? `${draftDeck.cardCount}/${draftDeck.expectedMainCount}` : "-"} />
          </div>
        </div>
      </div>
    </main>
  );
}

function SummaryStrip({ analysis, deck, analysisReady }) {
  const bracket = analysis.bracket;
  const manaFit = analysis.manaFit || analysis.structure?.manaFit;
  const winPlan = analysis.structure?.winPlan;
  const topFinding = (analysis.priorityFindings || []).find((finding) => finding.severity !== "notice") || analysis.priorityFindings?.[0];
  return (
    <section className={panelClass("p-4")}>
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wide text-neutral-500">Deck Snapshot</div>
          <div className="mt-1 text-lg font-semibold text-neutral-50">{names(deck.commanders)}</div>
          <div className="mt-1 text-xs text-neutral-500">{deck.cardCount}/{deck.expectedMainCount} main-deck cards</div>
        </div>
        <div className="grid flex-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
          <div className={`rounded-lg border p-3 ${statusClasses(topFinding?.severity || "notice")}`}>
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">Needs Attention</div>
            <div className="mt-1 text-sm font-semibold">{topFinding?.label || "No active issue"}</div>
            <div className="mt-1 text-xs text-neutral-300">{topFinding?.action || "Tune from actual games and matchup needs."}</div>
          </div>
          <div className={`rounded-lg border p-3 ${statusClasses(manaFit?.status)}`}>
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">Mana Fit</div>
            <div className="mt-1 text-sm font-semibold capitalize">{calculationValue(analysisReady, manaFit?.status)}</div>
            <div className="mt-1 text-xs text-neutral-300">{manaFit ? `${manaFit.currentLands} lands, ${manaFit.currentRamp} ramp` : "Loading"}</div>
          </div>
          <div className={`rounded-lg border p-3 ${statusClasses(winPlan?.status)}`}>
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">Game Plan</div>
            <div className="mt-1 text-sm font-semibold capitalize">{calculationValue(analysisReady, winPlan?.status)}</div>
            <div className="mt-1 text-xs text-neutral-300">{winPlan?.primary || "Unknown"}</div>
          </div>
          <div className={`rounded-lg border p-3 ${analysisReady ? (bracket?.bracket >= 4 ? statusClasses("bad") : bracket?.bracket === 3 ? statusClasses("warn") : statusClasses("good")) : statusClasses()}`}>
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">Power</div>
            <div className="mt-1 text-sm font-semibold">{calculationValue(analysisReady, bracket?.rangeLabel)}</div>
            <div className="mt-1 text-xs text-neutral-300">{analysisReady ? bracket?.label : "Loading"}</div>
          </div>
        </div>
      </div>
    </section>
  );
}

const SETTING_GROUPS = [
  { key: "landsMin", label: "Base Min Lands", min: 30, max: 44, step: 1 },
  { key: "landsMax", label: "Base Max Lands", min: 32, max: 46, step: 1 },
  { key: "rampTarget", label: "Base Ramp", min: 4, max: 18, step: 1 },
  { key: "drawTarget", label: "Card Flow", min: 4, max: 18, step: 1 },
  { key: "removalTarget", label: "Removal", min: 0, max: 12, step: 1 },
  { key: "wipesTarget", label: "Wipes", min: 0, max: 6, step: 1 },
  { key: "resilienceTarget", label: "Resilience", min: 0, max: 12, step: 1 },
  { key: "avgManaValueTarget", label: "Avg MV", min: 2.0, max: 5.0, step: 0.1 },
  { key: "expectedWinTurnTarget", label: "Win Turn", min: 4, max: 12, step: 1 },
  { key: "tutorSensitivity", label: "Tutors", min: 0, max: 8, step: 1 },
  { key: "fastManaSensitivity", label: "Fast Mana", min: 0, max: 8, step: 1 },
  { key: "gameChangerSensitivity", label: "Game Changers", min: 0, max: 8, step: 1 },
  { key: "synergySensitivity", label: "Core Support", min: 1, max: 20, step: 1 },
];

function SettingsPanel({ settings, setSettings }) {
  const resolved = resolveAnalysisSettings(settings);

  const updateSetting = (key, value) => {
    setSettings((current) => resolveAnalysisSettings({ ...current, [key]: value }));
  };
  const toggleIgnoredSetting = (key) => {
    setSettings((current) => {
      const next = resolveAnalysisSettings(current);
      const ignored = new Set(next.ignoredSettings || []);
      if (ignored.has(key)) ignored.delete(key);
      else ignored.add(key);
      return resolveAnalysisSettings({ ...next, ignoredSettings: [...ignored] });
    });
  };

  return (
    <section className={panelClass("p-4 sm:p-5")}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-neutral-500">Soft Assumptions</div>
          <div className="mt-1 text-sm text-neutral-400">Tune the baseline targets. Mana fit can shift land and ramp ranges when the curve asks for it.</div>
        </div>
        <button
          type="button"
          onClick={() => setSettings(DEFAULT_ANALYSIS_SETTINGS)}
          className="min-h-9 rounded border border-neutral-700 px-3 py-1 text-xs font-semibold text-neutral-300 hover:border-amber-500 hover:text-amber-200"
        >
          Reset
        </button>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {SETTING_GROUPS.map((setting) => (
          <label key={setting.key} className={`rounded-lg border p-3 ${resolved.ignoredSettings.includes(setting.key) ? "border-neutral-700 bg-neutral-950/60 opacity-70" : "border-neutral-800 bg-neutral-950"}`}>
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs uppercase tracking-wide text-neutral-500">{setting.label}</span>
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm text-neutral-100">{settingValue(resolved, setting.key)}</span>
                <button
                  type="button"
                  title="Ignore this setting in overall score"
                  aria-label={`Ignore ${setting.label} in overall score`}
                  onClick={(event) => {
                    event.preventDefault();
                    toggleIgnoredSetting(setting.key);
                  }}
                  className={`h-6 w-6 rounded border text-xs font-bold ${resolved.ignoredSettings.includes(setting.key) ? "border-amber-500 bg-amber-500 text-neutral-950" : "border-neutral-700 text-neutral-500 hover:border-amber-500 hover:text-amber-200"}`}
                >
                  x
                </button>
              </div>
            </div>
            <input
              type="range"
              disabled={resolved.ignoredSettings.includes(setting.key)}
              min={setting.min}
              max={setting.max}
              step={setting.step}
              value={settingValue(resolved, setting.key)}
              onChange={(event) => updateSetting(setting.key, Number(event.target.value))}
              className="mt-3 w-full accent-amber-500"
            />
            {resolved.ignoredSettings.includes(setting.key) && <div className="mt-2 text-xs text-amber-300">Ignored in overall score</div>}
          </label>
        ))}
      </div>
    </section>
  );
}

function ScorecardPanel({ item, analysisReady }) {
  return (
    <article className={`rounded-lg border p-4 ${statusClasses(item.status)}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">{item.label}</div>
          <div className="mt-1 text-xs uppercase tracking-wide text-neutral-500">{analysisReady ? (item.ignored ? "Ignored in overall score" : item.grade) : "Calculating"}</div>
        </div>
        <div className={`rounded border border-neutral-700 bg-neutral-950 px-2 py-1 font-mono text-neutral-100 ${analysisReady ? "text-lg" : "text-xs"}`}>
          {calculationValue(analysisReady, item.score)}
        </div>
      </div>
      <p className="mt-3 text-sm leading-6 text-neutral-300">{item.summary}</p>
      <div className="mt-3">
        <div className="text-xs uppercase tracking-wide text-neutral-500">Evidence</div>
        <ul className="mt-2 space-y-1 text-sm text-neutral-300">
          {item.evidence.slice(0, 4).map((line) => <li key={line}>{line}</li>)}
        </ul>
      </div>
      <div className="mt-3">
        <div className="text-xs uppercase tracking-wide text-neutral-500">Adjustment</div>
        <div className="mt-1 text-sm text-neutral-300">{item.adjustments[0] || "No immediate adjustment."}</div>
      </div>
      {item.highlightCards.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {item.highlightCards.slice(0, 6).map((card) => (
            <span key={card} className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-300">{card}</span>
          ))}
        </div>
      )}
    </article>
  );
}

function priorityClasses(priority) {
  if (priority === "required") return "border-rose-800 bg-rose-950/30 text-rose-100";
  if (priority === "recommended") return "border-amber-800 bg-amber-950/30 text-amber-100";
  return "border-neutral-800 bg-neutral-950 text-neutral-300";
}

function ActionPlanPanel({ actionPlan, setActiveTab }) {
  const tasks = actionPlan?.tasks || [];
  return (
    <section className={panelClass("p-4 sm:p-5")}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-neutral-500">Action Plan</div>
          <div className="mt-1 text-sm text-neutral-300">{actionPlan?.headline || "No action plan available yet."}</div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:min-w-[220px]">
          <Metric label="Required" value={actionPlan?.requiredCount ?? 0} tone={(actionPlan?.requiredCount || 0) > 0 ? "bad" : "good"} />
          <Metric label="Tuning" value={actionPlan?.recommendedCount ?? 0} tone={(actionPlan?.recommendedCount || 0) > 0 ? "warn" : "neutral"} />
        </div>
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-2">
          {tasks.length ? tasks.map((task, index) => (
            <article key={task.id || `${task.label}-${index}`} className={`rounded border p-3 ${priorityClasses(task.priority)}`}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded border border-current/40 font-mono text-xs">{index + 1}</span>
                    <span className="text-sm font-semibold">{task.label}</span>
                    <span className="rounded border border-current/30 px-1.5 py-0.5 text-[11px] uppercase">{task.priority}</span>
                  </div>
                  <p className="mt-2 text-sm text-neutral-300">{task.action}</p>
                  <p className="mt-1 text-xs text-neutral-500">{task.detail}</p>
                  {(task.relatedCards || []).length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {task.relatedCards.slice(0, 5).map((card) => <span key={card} className="rounded border border-neutral-700 bg-neutral-950/70 px-2 py-0.5 text-xs text-neutral-300">{card}</span>)}
                    </div>
                  )}
                </div>
                {task.tab && (
                  <button
                    type="button"
                    onClick={() => setActiveTab(task.tab)}
                    className="min-h-9 shrink-0 rounded border border-neutral-700 px-3 py-1 text-xs font-semibold text-neutral-200 hover:border-amber-500 hover:text-amber-200"
                  >
                    Open {TABS.find((tab) => tab.id === task.tab)?.label || "tab"}
                  </button>
                )}
              </div>
            </article>
          )) : <div className="rounded border border-neutral-800 bg-neutral-950 p-3 text-sm text-neutral-500">No required tasks are active.</div>}
        </div>

        <aside className="space-y-3">
          <div className="rounded border border-neutral-800 bg-neutral-950 p-3">
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">Next Cuts</div>
            <div className="mt-2 space-y-2">
              {(actionPlan?.nextCuts || []).slice(0, 4).map((candidate) => (
                <div key={candidate.name} className="text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-neutral-100">{candidate.name}</span>
                    <span className={`rounded border px-1.5 py-0.5 text-[11px] uppercase ${confidenceClasses(candidate.confidence)}`}>{candidate.required ? "required" : candidate.confidence}</span>
                  </div>
                  <div className="mt-1 text-xs text-neutral-500">{candidate.replacementNeed}</div>
                </div>
              ))}
              {!(actionPlan?.nextCuts || []).length && <div className="text-sm text-neutral-500">No cut queue yet.</div>}
            </div>
          </div>

          <div className="rounded border border-neutral-800 bg-neutral-950 p-3">
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">Next Adds</div>
            <div className="mt-2 space-y-2">
              {(actionPlan?.nextAdds || []).slice(0, 3).map((upgrade) => (
                <div key={`${upgrade.add}-${upgrade.cut}`} className="text-sm">
                  <div className="font-semibold text-neutral-100">{upgrade.add}</div>
                  <div className="mt-1 text-xs text-neutral-500">Test over {upgrade.cut}</div>
                </div>
              ))}
              {!(actionPlan?.nextAdds || []).length && <div className="text-sm text-neutral-500">No add candidates supplied.</div>}
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}

function ScorecardTab({ analysis, settings, setSettings, setActiveTab, analysisReady }) {
  const actionFindings = (analysis.priorityFindings || []).filter((finding) => finding.severity !== "notice").slice(0, 4);
  const topCuts = (analysis.cutCandidates || []).slice(0, 4);
  const topUpgrades = (analysis.upgrades || []).slice(0, 3);
  const needsAttention = (analysis.highlights?.needsAttention || []).filter((item) => !item.ignored).slice(0, 4);
  const strengths = (analysis.highlights?.strengths || []).filter((item) => !item.ignored).slice(0, 4);
  const roadmap = analysis.roadmap || {};
  const actionPlan = analysis.actionPlan || {};

  return (
    <div className="space-y-3 sm:space-y-4">
      <section className="grid gap-3 sm:gap-4 xl:grid-cols-[0.85fr_1.15fr]">
        <div className={panelClass("p-4 sm:p-5")}>
          <div className="text-[11px] uppercase tracking-wide text-neutral-500">Home</div>
          <div className={`mt-2 font-bold text-neutral-50 ${analysisReady ? "text-5xl" : "text-3xl"}`}>{calculationValue(analysisReady, analysis.overallScore)}</div>
          <div className="mt-3 text-sm text-neutral-400">Action dashboard based on the current commander, core cards, and tuning targets.</div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Metric label="Active Fixes" value={calculationValue(analysisReady, actionFindings.length)} tone={analysisReady ? (actionFindings.length ? "warn" : "good") : "neutral"} />
            <Metric label="Cut Ideas" value={calculationValue(analysisReady, topCuts.length)} tone="neutral" />
          </div>
        </div>

        <div className={panelClass("p-4 sm:p-5")}>
          <div className="text-[11px] uppercase tracking-wide text-neutral-500">Needs Attention</div>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {actionFindings.length
              ? actionFindings.map((finding) => <FindingCard key={`${finding.label}-${finding.action}`} finding={finding} />)
              : <FindingCard finding={{ severity: "notice", label: "No active fix", detail: "The main checks are not flagging a critical deckbuilding task.", action: "Use Cuts or playtest notes for finer tuning." }} />}
          </div>
        </div>
      </section>

      <ActionPlanPanel actionPlan={actionPlan} setActiveTab={setActiveTab} />

      <section className={panelClass("p-4 sm:p-5")}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">Build Roadmap</div>
            <div className="mt-1 text-sm text-neutral-300">{roadmap.headline || "Tune around the strongest game-plan pieces and playtest results."}</div>
          </div>
          <span className={`w-fit rounded border px-2 py-1 text-xs uppercase ${roadmap.status === "stable" ? "border-emerald-800 text-emerald-200" : "border-amber-800 text-amber-200"}`}>
            {roadmap.status === "stable" ? "stable draft" : "needs work"}
          </span>
        </div>
        <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
          <div className="space-y-2">
            {(roadmap.steps || []).slice(0, 4).map((step, index) => (
              <div key={`${step.label}-${index}`} className="rounded border border-neutral-800 bg-neutral-950 px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded border border-neutral-700 font-mono text-xs text-neutral-400">{index + 1}</span>
                  <span className="text-sm font-semibold text-neutral-100">{step.label}</span>
                </div>
                <div className="mt-2 text-sm text-neutral-300">{step.action}</div>
                <div className="mt-1 text-xs text-neutral-500">{step.reason}</div>
              </div>
            ))}
            {!(roadmap.steps || []).length && <div className="rounded border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-500">No urgent build steps are active; tune from matchup notes.</div>}
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-1">
            <div className="rounded border border-neutral-800 bg-neutral-950 p-3">
              <div className="text-[11px] uppercase tracking-wide text-neutral-500">First Cuts</div>
              <div className="mt-2 space-y-2">
                {(roadmap.cutPriorities || []).slice(0, 3).map((candidate) => (
                  <div key={candidate.name} className="text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-neutral-100">{candidate.name}</span>
                      <span className={`rounded border px-1.5 py-0.5 text-[11px] uppercase ${confidenceClasses(candidate.confidence)}`}>{candidate.confidence}</span>
                    </div>
                    <div className="mt-1 text-xs text-neutral-500">{candidate.replacementNeed}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded border border-neutral-800 bg-neutral-950 p-3">
              <div className="text-[11px] uppercase tracking-wide text-neutral-500">Protect</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(roadmap.protect || []).length
                  ? roadmap.protect.slice(0, 6).map((name) => <span key={name} className="rounded border border-neutral-700 px-2 py-0.5 text-xs text-neutral-300">{name}</span>)
                  : <span className="text-sm text-neutral-500">Mark core cards as you identify them.</span>}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:gap-4 xl:grid-cols-3">
        <div className={panelClass("p-4")}>
          <div className="text-[11px] uppercase tracking-wide text-neutral-500">Needs Attention</div>
          <div className="mt-3 space-y-2">
            {needsAttention.map((item) => (
              <div key={item.key} className="flex items-center justify-between rounded border border-neutral-800 bg-neutral-950 px-3 py-2">
                <span className="text-sm text-neutral-200">{item.label}</span>
                <span className={`font-mono text-sm ${analysisReady ? scoreColor(Math.round((item.score - 50) / 10)) : "text-neutral-400"}`}>{calculationValue(analysisReady, item.score)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className={panelClass("p-4")}>
          <div className="text-[11px] uppercase tracking-wide text-neutral-500">Likely Cuts</div>
          <div className="mt-3 space-y-2">
            {topCuts.length ? topCuts.map((candidate) => (
              <div key={candidate.name} className="rounded border border-neutral-800 bg-neutral-950 px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-neutral-100">{candidate.name}</span>
                  <span className={`rounded border px-1.5 py-0.5 text-[11px] uppercase ${confidenceClasses(candidate.confidence)}`}>{candidate.confidence}</span>
                </div>
                <div className="mt-1 text-xs text-neutral-500">{candidate.replacementNeed}</div>
              </div>
            )) : <div className="text-sm text-neutral-500">No cut candidates available yet.</div>}
          </div>
        </div>

        <div className={panelClass("p-4")}>
          <div className="text-[11px] uppercase tracking-wide text-neutral-500">Strengths</div>
          <div className="mt-3 space-y-2">
            {strengths.map((item) => (
              <div key={item.key} className="flex items-center justify-between rounded border border-neutral-800 bg-neutral-950 px-3 py-2">
                <span className="text-sm text-neutral-200">{item.label}</span>
                <span className={`font-mono text-sm ${analysisReady ? "text-emerald-300" : "text-neutral-400"}`}>{calculationValue(analysisReady, item.score)}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className={panelClass("p-4 sm:p-5")}>
        <div className="text-[11px] uppercase tracking-wide text-neutral-500">Upgrade Ideas</div>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {topUpgrades.length ? topUpgrades.map((upgrade) => (
            <div key={`${upgrade.cut}-${upgrade.add}`} className="rounded border border-neutral-800 bg-neutral-950 p-3">
              <div className="text-xs text-neutral-500">Swap</div>
              <div className="mt-1 text-sm text-rose-200">{upgrade.cut}</div>
              <div className="text-xs text-neutral-600">to</div>
              <div className="text-sm font-semibold text-emerald-200">{upgrade.add}</div>
            </div>
          )) : <div className="text-sm text-neutral-500">No upgrade pairings available yet.</div>}
        </div>
      </section>

      <details className="space-y-3">
        <summary className="cursor-pointer rounded-lg border border-neutral-800 bg-neutral-900/80 p-4 text-sm font-semibold text-neutral-100 sm:p-5">Tuning</summary>
        <div className="mt-4">
          <SettingsPanel settings={settings} setSettings={setSettings} />
        </div>
      </details>

      <details className="space-y-3">
        <summary className="cursor-pointer rounded-lg border border-neutral-800 bg-neutral-900/80 p-4 text-sm font-semibold text-neutral-100 sm:p-5">Score Details</summary>
        <div className="mt-4 grid gap-3 sm:gap-4 lg:grid-cols-2">
          {(analysis.scorecard || []).map((item) => <ScorecardPanel key={item.key} item={item} analysisReady={analysisReady} />)}
        </div>
      </details>
    </div>
  );
}

const COMMANDER_ROLE_POINTS = {
  Enabler: { x: 22, y: 24 },
  Linchpin: { x: 78, y: 24 },
  Intensifier: { x: 78, y: 76 },
  Counterweight: { x: 22, y: 76 },
};

function CommanderRoleGraph({ commander }) {
  const scores = commander.categoryScores || [];
  const total = scores.reduce((sum, item) => sum + item.confidenceScore, 0) || 1;
  const centroid = scores.reduce((point, item) => {
    const rolePoint = COMMANDER_ROLE_POINTS[item.category] || { x: 50, y: 50 };
    return {
      x: point.x + rolePoint.x * (item.confidenceScore / total),
      y: point.y + rolePoint.y * (item.confidenceScore / total),
    };
  }, { x: 0, y: 0 });

  return (
    <div className="mt-3">
      <div className="relative h-48 rounded-lg border border-neutral-800 bg-neutral-950">
        <div className="absolute left-1/2 top-3 bottom-3 w-px bg-neutral-800" />
        <div className="absolute left-3 right-3 top-1/2 h-px bg-neutral-800" />
        {scores.map((item) => {
          const point = COMMANDER_ROLE_POINTS[item.category] || { x: 50, y: 50 };
          const size = 18 + item.confidenceScore * 0.34;
          const active = item.category === commander.category;
          return (
            <div
              key={item.category}
              className={`absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border text-[11px] font-semibold ${active ? "border-amber-300 bg-amber-400 text-neutral-950" : "border-neutral-700 bg-neutral-900 text-neutral-300"}`}
              style={{ left: `${point.x}%`, top: `${point.y}%`, width: `${size}px`, height: `${size}px`, opacity: 0.45 + item.confidenceScore / 180 }}
              title={`${item.category}: ${item.confidenceScore}%`}
            >
              {item.confidenceScore}
            </div>
          );
        })}
        <div
          className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-neutral-950 bg-sky-300 shadow-[0_0_0_2px_rgba(125,211,252,0.4)]"
          style={{ left: `${centroid.x}%`, top: `${centroid.y}%` }}
          title="Quadratic confidence center"
        />
        <div className="absolute left-3 top-2 text-[11px] text-neutral-500">Enabler</div>
        <div className="absolute right-3 top-2 text-[11px] text-neutral-500">Linchpin</div>
        <div className="absolute bottom-2 right-3 text-[11px] text-neutral-500">Intensifier</div>
        <div className="absolute bottom-2 left-3 text-[11px] text-neutral-500">Counterweight</div>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1 text-xs text-neutral-500">
        {scores.map((item) => (
          <div key={item.category} className="flex justify-between gap-2">
            <span>{item.category}</span>
            <span className="font-mono">{item.confidenceScore}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CommanderRolePanel({ commanderProfile }) {
  const commanders = commanderProfile?.commanders || [];
  return (
    <section className={panelClass("p-4 sm:p-5")}>
      <div className="text-[11px] uppercase tracking-wide text-neutral-500">Commander Role</div>
      <p className="mt-2 text-sm text-neutral-400">{commanderProfile?.summary || "No commander classification available."}</p>
      <div className="mt-3 space-y-3">
        {commanders.map((commander) => (
          <div key={commander.name} className={`rounded-lg border p-3 ${commander.outlier ? "border-amber-900 bg-amber-950/30" : "border-neutral-800 bg-neutral-950"}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="font-semibold text-neutral-100">{commander.name}</div>
                <div className="mt-1 text-sm text-amber-200">{commander.category}</div>
              </div>
              <span className={`rounded border px-2 py-0.5 text-[11px] uppercase ${commander.confidence === "high" ? "border-emerald-800 text-emerald-200" : commander.confidence === "medium" ? "border-amber-800 text-amber-200" : "border-rose-800 text-rose-200"}`}>
                {commander.confidence}
              </span>
            </div>
            {commander.outlier && <div className="mt-2 text-xs text-amber-200">Low-confidence classification</div>}
            <p className="mt-2 text-sm text-neutral-300">{commander.explanation}</p>
            {commander.alternateCategories?.length > 0 && (
              <div className="mt-2 text-xs text-neutral-500">Also plausible: {commander.alternateCategories.join(", ")}</div>
            )}
            <CommanderRoleGraph commander={commander} />
            <div className="mt-3 space-y-2">
              {(commander.evidence || []).map((item) => (
                <div key={item.text} className="rounded border border-neutral-800 bg-neutral-900/70 p-2">
                  <div className="text-xs text-neutral-300">{item.text}</div>
                  {item.cards?.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {item.cards.map((card) => <RoleChip key={card} role={card} />)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function OverviewTab({ analysis, deck }) {
  const winPlan = analysis.structure?.winPlan;
  return (
    <div className="grid gap-3 sm:gap-4 xl:grid-cols-[1.15fr_0.85fr]">
      <section className={panelClass("p-4 sm:p-5")}>
        <div className="text-[11px] uppercase tracking-wide text-neutral-500">Strategy</div>
        <p className="mt-2 text-sm leading-6 text-neutral-300">{analysis.strategy}</p>

        <div className="mt-5 space-y-3">
          <div className={`rounded-lg border p-3 ${statusClasses(winPlan?.status)}`}>
            <div className="text-xs uppercase tracking-wide text-neutral-500">Win Plan</div>
            <div className="mt-1 text-sm font-semibold">{winPlan?.primary || "Unknown"}</div>
            <div className="mt-2 text-sm text-neutral-300">{winPlan?.note}</div>
          </div>
          {[
            ["Engines", winPlan?.engines],
            ["Payoffs", winPlan?.payoffs],
            ["Finishers", winPlan?.finishers],
          ].map(([label, cards]) => (
            <div key={label}>
              <div className="text-xs uppercase tracking-wide text-neutral-500">{label}</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {(cards || []).length
                  ? cards.map((card) => <span key={card} className="rounded border border-neutral-800 bg-neutral-950 px-2 py-1 text-xs text-neutral-300">{card}</span>)
                  : <span className="text-sm text-neutral-500">None clearly detected</span>}
              </div>
            </div>
          ))}
        </div>
      </section>

      <CommanderRolePanel commanderProfile={analysis.commanderProfile} />

      <section className={panelClass("p-4 sm:p-5")}>
        <div className="text-[11px] uppercase tracking-wide text-neutral-500">Core Identity</div>
        <div className="mt-3 space-y-3 text-sm">
          <div>
            <div className="text-neutral-500">Commander</div>
            <div className="font-semibold text-neutral-100">{deck.commanders[0]?.name || "None"}</div>
          </div>
          {deck.hasValidPartner && deck.commanders[1] && (
            <div>
              <div className="text-neutral-500">Partner</div>
              <div className="font-semibold text-neutral-100">{deck.commanders[1].name}</div>
            </div>
          )}
          {deck.hasValidCompanion && deck.companions.length > 0 && (
            <div>
            <div className="text-neutral-500">Companion</div>
            <div className="font-semibold text-neutral-100">{names(deck.companions)}</div>
            </div>
          )}
          {deck.inferenceWarnings.map((warning) => (
            <StatusLine key={warning} ok={false}>{warning}</StatusLine>
          ))}
          <div>
            <div className="text-neutral-500">Marked Core Cards</div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {(analysis.coreCards || []).length
                ? analysis.coreCards.map((card) => <span key={card} className="rounded border border-amber-800 bg-amber-950/40 px-2 py-1 text-xs text-amber-200">{card}</span>)
                : <span className="text-sm text-neutral-500">None marked yet</span>}
            </div>
          </div>
        </div>
      </section>

      <section className={`${panelClass("p-4 sm:p-5")} xl:col-span-2`}>
        <div className="text-[11px] uppercase tracking-wide text-neutral-500">Synergy Clusters</div>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          {analysis.synergyClusters.map((cluster) => (
            <details key={cluster.name} className="rounded-lg border border-neutral-800 bg-neutral-950 p-4" open>
              <summary className="cursor-pointer text-sm font-semibold text-amber-200">{cluster.name}</summary>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {cluster.cards.map((card) => (
                  <span key={card} className="rounded border border-neutral-800 bg-neutral-900 px-2 py-1 text-xs text-neutral-300">{card}</span>
                ))}
              </div>
              <p className="mt-3 text-sm text-neutral-400">{cluster.desc}</p>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}

function StructureTab({ analysis }) {
  const structure = analysis.structure || {};
  const profiles = [
    ["Interaction", structure.interactionProfile, [
      ["Total", structure.interactionProfile?.total],
      ["Instant", structure.interactionProfile?.instantSpeed],
      ["Stack", structure.interactionProfile?.stackInteraction],
    ]],
    ["Card Flow", structure.cardFlowProfile, [
      ["Draw", structure.cardFlowProfile?.draw],
      ["Tutors", structure.cardFlowProfile?.tutors],
      ["Engines", structure.cardFlowProfile?.engines],
    ]],
    ["Resilience", structure.resilienceProfile, [
      ["Protect", structure.resilienceProfile?.protection],
      ["Recursion", structure.resilienceProfile?.recursion],
      ["Wipes", structure.resilienceProfile?.boardWipes],
    ]],
  ];

  return (
    <div className="grid gap-3 sm:gap-4 xl:grid-cols-[1.1fr_0.9fr]">
      <section className={panelClass("p-4 sm:p-5")}>
        <div className="text-[11px] uppercase tracking-wide text-neutral-500">Role Balance</div>
        <div className="mt-3 grid gap-2 sm:gap-3 md:grid-cols-2">
          {(structure.roleBalance || []).map((role) => (
            <div key={role.key} className={`rounded-lg border p-3 ${statusClasses(role.status)}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold">{role.label}</div>
                  <div className="mt-1 text-xs text-neutral-500">Target {role.target}</div>
                </div>
                <div className="text-2xl font-bold">{role.count}</div>
              </div>
              <div className="mt-3">
                <MiniBar value={role.count} status={role.status} />
              </div>
              <p className="mt-3 text-sm text-neutral-300">{role.detail}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {role.examples.length
                  ? role.examples.map((card) => <span key={card} className="rounded border border-neutral-800 bg-neutral-950/60 px-2 py-1 text-xs text-neutral-300">{card}</span>)
                  : <span className="text-xs text-neutral-500">No clear examples detected</span>}
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="space-y-4">
        {profiles.map(([label, profile, rows]) => (
          <section key={label} className={panelClass("p-4 sm:p-5")}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-wide text-neutral-500">{label}</div>
                <p className="mt-2 text-sm text-neutral-400">{profile?.note}</p>
              </div>
              <span className={`rounded border px-2 py-1 text-xs uppercase ${statusClasses(profile?.status)}`}>{profile?.status || "unknown"}</span>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2">
              {rows.map(([rowLabel, value]) => (
                <Metric key={rowLabel} label={rowLabel} value={value ?? 0} />
              ))}
            </div>
          </section>
        ))}

        <section className={panelClass("p-4 sm:p-5")}>
          <div className="text-[11px] uppercase tracking-wide text-neutral-500">Answer Gaps</div>
          <div className="mt-3 space-y-2">
            {(structure.answerGaps || []).map((gap) => (
              <StatusLine key={gap.key} ok={gap.ok}>{gap.message}</StatusLine>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function PowerTab({ analysis, analysisReady }) {
  const bracket = analysis.bracket;
  const dimensions = bracket.dimensions || {};
  return (
    <div className="grid gap-3 sm:gap-4 xl:grid-cols-[0.9fr_1.1fr]">
      <section className={panelClass("p-4 sm:p-5")}>
        <div className="text-[11px] uppercase tracking-wide text-neutral-500">Commander Bracket</div>
        <div className={`mt-2 font-bold text-neutral-50 ${analysisReady ? "text-3xl sm:text-4xl" : "text-2xl sm:text-3xl"}`}>{calculationValue(analysisReady, bracket.rangeLabel)}</div>
        <div className="mt-1 text-sm text-neutral-400">{analysisReady ? `${bracket.label} confidence ${Math.round(bracket.confidence * 100)}%` : "Calculating..."}</div>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <Metric label="Win Turn" value={calculationValue(analysisReady, `~${bracket.expectedWinTurn}`)} />
          <Metric label="Game Changers" value={calculationValue(analysisReady, bracket.gameChangers.length)} tone={analysisReady ? (bracket.gameChangers.length > 3 ? "bad" : bracket.gameChangers.length ? "warn" : "good") : "neutral"} />
        </div>
      </section>

      <section className={panelClass("p-4 sm:p-5")}>
        <div className="text-[11px] uppercase tracking-wide text-neutral-500">Evidence</div>
        <div className="mt-3 space-y-2">
          {analysisReady ? bracket.reasons.map((reason) => (
            <StatusLine key={reason} ok={bracket.bracket <= 2}>{reason}</StatusLine>
          )) : <StatusLine ok={false}>Calculating...</StatusLine>}
        </div>
      </section>

      <section className={`${panelClass("p-4 sm:p-5")} xl:col-span-2`}>
        <div className="text-[11px] uppercase tracking-wide text-neutral-500">Bracket Dimensions</div>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {["power", "consistency", "speed", "salt"].map((key) => {
            const dimension = dimensions[key] || {};
            return (
              <details key={key} className="rounded-lg border border-neutral-800 bg-neutral-950 p-3" open>
                <summary className="cursor-pointer text-sm font-semibold capitalize text-neutral-100">{key}</summary>
                <div className="mt-3 space-y-2">
                  {(dimension.positive || []).map((item) => (
                    <StatusLine key={item.text} ok={false}>{item.text}</StatusLine>
                  ))}
                  {(dimension.negative || []).map((item) => (
                    <StatusLine key={item.text} ok>{item.text}</StatusLine>
                  ))}
                </div>
              </details>
            );
          })}
        </div>
      </section>

      <section className={panelClass("p-4 sm:p-5")}>
        <div className="text-[11px] uppercase tracking-wide text-neutral-500">Signals</div>
        <div className="mt-3 space-y-3">
          <details className="rounded-lg border border-neutral-800 bg-neutral-950 p-3" open>
            <summary className="cursor-pointer text-sm font-semibold text-neutral-200">Game Changers</summary>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {analysisReady ? (bracket.gameChangers.length ? bracket.gameChangers.map((name) => <RoleChip key={name} role={name} />) : <span className="text-sm text-neutral-500">None detected</span>) : <span className="text-sm text-neutral-500">Calculating...</span>}
            </div>
            <div className="mt-2 text-xs text-neutral-600">{bracket.gameChangerVersion}</div>
          </details>
          <details className="rounded-lg border border-neutral-800 bg-neutral-950 p-3" open>
            <summary className="cursor-pointer text-sm font-semibold text-neutral-200">Speed</summary>
            <div className="mt-3 space-y-1 text-sm text-neutral-400">
              {analysisReady ? (bracket.speedSignals.length ? bracket.speedSignals.map((signal) => <div key={`${signal.type}-${signal.name}`}>{signal.type}: {signal.name}</div>) : <div>No fast speed cluster detected.</div>) : <div>Calculating...</div>}
            </div>
          </details>
        </div>
      </section>

      <section className={panelClass("p-4 sm:p-5")}>
        <div className="text-[11px] uppercase tracking-wide text-neutral-500">Combo Packages</div>
        <div className="mt-3 space-y-3">
          {!analysisReady ? <div className="text-sm text-neutral-500">Calculating...</div> : bracket.comboSignals.length ? bracket.comboSignals.map((combo) => (
            <details key={combo.name} className="rounded-lg border border-neutral-800 bg-neutral-950 p-3" open>
              <summary className="cursor-pointer text-sm font-semibold text-neutral-200">{combo.name}</summary>
              <div className="mt-2 text-sm text-neutral-400">{combo.matches.join(", ")}</div>
            </details>
          )) : <div className="text-sm text-neutral-500">No compact combo package detected.</div>}
          {analysisReady && bracket.upgradeSuggestions.map((suggestion) => (
            <StatusLine key={suggestion} ok={bracket.bracket <= 3}>{suggestion}</StatusLine>
          ))}
        </div>
      </section>
    </div>
  );
}

function ManaTab({ analysis, pipData, cmcBuckets }) {
  const curveBands = analysis.structure?.curveBands || [];
  const manaFit = analysis.manaFit || analysis.structure?.manaFit;
  return (
    <div className="grid gap-3 sm:gap-4 xl:grid-cols-2">
      {manaFit && (
        <section className={`${panelClass("p-4 sm:p-5")} xl:col-span-2`}>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-neutral-500">Mana Fit</div>
              <p className="mt-2 text-sm leading-6 text-neutral-300">{manaFit.recommendation}</p>
            </div>
            <div className={`shrink-0 rounded border px-3 py-2 text-sm font-semibold capitalize ${statusClasses(manaFit.status)}`}>{manaFit.status}</div>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Lands" value={manaFit.currentLands} sub={`Fit ${manaFit.landRange.min}-${manaFit.landRange.max}`} tone={manaFit.currentLands < manaFit.landRange.min || manaFit.currentLands > manaFit.landRange.max + 2 ? "warn" : "good"} />
            <Metric label="Ramp" value={manaFit.currentRamp} sub={`Fit ${manaFit.rampRange.min}-${manaFit.rampRange.max}`} tone={manaFit.currentRamp < manaFit.rampRange.min || manaFit.currentRamp > manaFit.rampRange.max + 4 ? "warn" : "good"} />
            <Metric label="Avg MV" value={manaFit.averageManaValue} sub="Includes commander" tone={manaFit.curvePressure > 1 ? "warn" : "neutral"} />
            <Metric label="Top End" value={manaFit.topEndCount} sub="MV 5+" tone={manaFit.curvePressure > 1 ? "warn" : "neutral"} />
          </div>
          <ul className="mt-4 grid gap-2 text-sm text-neutral-300 lg:grid-cols-2">
            {manaFit.reasons.slice(0, 4).map((reason) => <li key={reason} className="rounded border border-neutral-800 bg-neutral-950 px-3 py-2">{reason}</li>)}
          </ul>
        </section>
      )}

      <section className={panelClass("p-4 sm:p-5")}>
        <div className="text-[11px] uppercase tracking-wide text-neutral-500">Mana Curve</div>
        <div className="mt-4 h-56 sm:h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={cmcBuckets} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
              <XAxis dataKey="cmc" tick={{ fill: "#a3a3a3", fontSize: 12 }} />
              <YAxis tick={{ fill: "#a3a3a3", fontSize: 12 }} />
              <Tooltip
                contentStyle={{ background: "#171717", border: "1px solid #404040", borderRadius: 8 }}
                formatter={(value, key) => [value, COLOR_LABEL[key] || key]}
              />
              {MANA_CURVE_COLOR_ORDER.map((colorKey) => (
                <Bar key={colorKey} dataKey={colorKey} stackId="mana" fill={COLOR_HEX[colorKey]} radius={colorKey === "C" ? [4, 4, 0, 0] : [0, 0, 0, 0]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {MANA_CURVE_COLOR_ORDER.map((colorKey) => (
            <span key={colorKey} className="inline-flex items-center gap-1.5 text-xs text-neutral-400">
              <span className="h-2.5 w-2.5 rounded-full border border-neutral-700" style={{ background: COLOR_HEX[colorKey] }} />
              {COLOR_LABEL[colorKey]}
            </span>
          ))}
        </div>
      </section>

      <section className={panelClass("p-4 sm:p-5")}>
        <div className="text-[11px] uppercase tracking-wide text-neutral-500">Pip Distribution</div>
        <div className="mt-4 h-56 sm:h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={pipData} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
              <XAxis dataKey="label" tick={{ fill: "#a3a3a3", fontSize: 12 }} />
              <YAxis tick={{ fill: "#a3a3a3", fontSize: 12 }} />
              <Tooltip contentStyle={{ background: "#171717", border: "1px solid #404040", borderRadius: 8 }} formatter={(value, name, item) => [`${item.payload.count} pips (${item.payload.pct}%)`, ""]} />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {pipData.map((data) => <Cell key={data.key} fill={data.hex} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-3 text-sm text-neutral-400">{analysis.splashNote}</p>
      </section>

      <section className={`${panelClass("p-4 sm:p-5")} xl:col-span-2`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">Curve Bands</div>
            <p className="mt-2 text-sm text-neutral-400">Mana-value bands grouped around setup, commander turns, and top end.</p>
          </div>
          <Metric label="Avg MV" value={analysis.stats?.avgCmc ?? "-"} tone={analysis.stats?.avgCmc <= analysis.settings?.avgManaValueTarget ? "good" : "warn"} sub={`Target ${analysis.settings?.avgManaValueTarget ?? "-"}`} />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-5">
          {curveBands.map((band) => (
            <div key={band.key} className="rounded-lg border border-neutral-800 bg-neutral-950 p-3">
              <div className="text-xs text-neutral-500">{band.label}</div>
              <div className="mt-1 text-xl font-semibold text-neutral-100">{band.count}</div>
              <div className="mt-1 text-xs text-neutral-500">MV {band.key}</div>
              <div className="mt-2 text-xs text-neutral-600">{band.detail}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function CardGroupSections({ analysis, cardMap }) {
  const typeGroups = analysis.cardGroups?.typeGroups || [];
  const roleGroups = analysis.cardGroups?.roleGroups || [];

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <section className={panelClass("p-4")}>
        <div className="text-[11px] uppercase tracking-wide text-neutral-500">Type Groups</div>
        <div className="mt-3 space-y-2">
          {typeGroups.map((group) => (
            <details key={group.key} className="rounded-lg border border-neutral-800 bg-neutral-950 p-3" open={group.count > 0}>
              <summary className="cursor-pointer text-sm font-semibold text-neutral-100">{group.label} ({group.count})</summary>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {group.cards.length
                  ? group.cards.map((item) => <CardPreview key={`${group.key}-${item.name}`} card={findCard(cardMap, item.name)} name={item.name} />)
                  : <span className="text-xs text-neutral-500">No cards detected</span>}
              </div>
            </details>
          ))}
        </div>
      </section>

      <section className={panelClass("p-4")}>
        <div className="text-[11px] uppercase tracking-wide text-neutral-500">Role Evidence Groups</div>
        <div className="mt-3 space-y-2">
          {roleGroups.map((group) => (
            <details key={group.key} className="rounded-lg border border-neutral-800 bg-neutral-950 p-3" open={group.count > 0}>
              <summary className="cursor-pointer text-sm font-semibold text-neutral-100">{group.label} ({group.count})</summary>
              <div className="mt-3 space-y-2">
                {group.evidence.length ? group.evidence.map((item, index) => (
                  <div key={`${item.cardName}-${item.role}-${index}`} className="rounded border border-neutral-800 bg-neutral-900/70 p-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <CardPreview card={findCard(cardMap, item.cardName)} name={item.cardName} />
                      <span className="rounded border border-neutral-700 px-1.5 py-0.5 text-[11px] uppercase text-neutral-400">{item.confidence}</span>
                    </div>
                    <div className="mt-2 text-xs text-neutral-400">{item.reason}</div>
                    <div className="mt-1 text-[11px] text-neutral-600">{item.source} · {item.matchingRule}</div>
                  </div>
                )) : <div className="text-xs text-neutral-500">No evidence detected</div>}
              </div>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}

function CardsTab({ analysis, cardMap, coreCards, toggleCoreCard, roleFilter, setRoleFilter, sortCol, sortDir, setSortCol, setSortDir, analysisReady }) {
  const [expanded, setExpanded] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const coreSet = useMemo(() => new Set((coreCards || []).map(normalizeName)), [coreCards]);
  const expandedSet = useMemo(() => new Set(expanded), [expanded]);
  const cutsByName = useMemo(() => new Map((analysis.cutCandidates || []).map((candidate) => [normalizeName(candidate.name), candidate])), [analysis.cutCandidates]);
  const rows = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();
    const filtered = analysis.scores.filter((score) => {
      if (roleFilter !== "all" && !score.roles?.includes(roleFilter)) return false;
      if (!search) return true;
      return score.name.toLowerCase().includes(search) || (score.roles || []).some((role) => (ROLE_LABELS[role] || role).toLowerCase().includes(search));
    });
    return [...filtered].sort((a, b) => {
      if (sortCol === "name") return sortDir === "asc" ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name);
      if (sortCol === "score") return sortDir === "asc" ? a.score - b.score : b.score - a.score;
      return 0;
    });
  }, [analysis.scores, roleFilter, searchTerm, sortCol, sortDir]);

  const toggleSort = (column) => {
    if (sortCol === column) setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    else {
      setSortCol(column);
      setSortDir("asc");
    }
  };

  const toggleExpanded = (name) => {
    setExpanded((current) => current.includes(name) ? current.filter((item) => item !== name) : [...current, name]);
  };

  return (
    <div className="space-y-3">
    <section className={panelClass("overflow-hidden")}>
      <div className="grid gap-3 border-b border-neutral-800 p-3 sm:p-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-neutral-500">Dense Card Table</div>
          <div className="mt-1 text-sm text-neutral-400">{rows.length} visible cards. Expand a row only when you need full text or art.</div>
        </div>
        <div className="grid gap-2 sm:grid-cols-[minmax(180px,1fr)_160px_auto_auto]">
          <input
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Search cards or roles"
            className="min-h-9 rounded border border-neutral-800 bg-neutral-950 px-3 py-1 text-sm text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-amber-500"
          />
          <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)} className="min-h-9 rounded border border-neutral-800 bg-neutral-950 px-2 py-1 text-sm text-neutral-100">
            {ROLE_FILTERS.map((filter) => <option key={filter.id} value={filter.id}>{filter.label}</option>)}
          </select>
          <button type="button" onClick={() => setExpanded(rows.map((row) => row.name))} className="min-h-9 rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:border-amber-500">
            Expand
          </button>
          <button type="button" onClick={() => setExpanded([])} className="min-h-9 rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:border-amber-500">
            Compact
          </button>
        </div>
      </div>

      <div className="divide-y divide-neutral-800 md:hidden">
        {rows.map((score) => {
          const card = findCard(cardMap, score.name);
          const roles = score.roles?.length ? score.roles : getRoleKeys(card);
          const isExpanded = expandedSet.has(score.name);
          const isCore = coreSet.has(normalizeName(score.name));
          const cutCandidate = cutsByName.get(normalizeName(score.name));
          return (
            <article key={score.name} onClick={() => toggleExpanded(score.name)} className="cursor-pointer bg-neutral-900/70 p-3">
              <div className="block w-full text-left">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="font-medium leading-snug text-neutral-100">{score.name}</div>
                      <ManaCostDisplay card={card} />
                    </div>
                    <div className="mt-1 text-xs text-neutral-500">MV {card?.cmc ?? "-"} · {score.note || "No special signal"}</div>
                  </div>
                  <div className={`shrink-0 rounded border border-neutral-700 px-2 py-1 font-mono text-sm ${analysisReady ? scoreColor(score.score) : "text-neutral-400"}`}>
                    {analysisReady ? `${score.score > 0 ? "+" : ""}${score.score}` : "Calculating..."}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1">
                  {roles.map((role) => <RoleChip key={role} role={role} />)}
                  {cutCandidate && <span className={`rounded border px-1.5 py-0.5 text-[11px] uppercase ${confidenceClasses(cutCandidate.confidence)}`}>cut {cutCandidate.confidence}</span>}
                </div>
              </div>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  toggleCoreCard(score.name);
                }}
                className={`mt-3 min-h-9 w-full rounded border px-3 py-2 text-xs font-semibold ${isCore ? "border-amber-500 bg-amber-500 text-neutral-950" : "border-neutral-700 text-neutral-300 hover:border-amber-500 hover:text-amber-200"}`}
              >
                {isCore ? "Core identity" : "Mark as core"}
              </button>
              {isExpanded && (
                <div className="mt-3 rounded-lg border border-neutral-800 bg-neutral-950 p-3">
                  <div className="grid gap-3 sm:grid-cols-[120px_1fr]">
                    <div>
                      {cardPreviewUrl(card) ? (
                        <img src={cardPreviewUrl(card)} alt={score.name} className="w-full rounded-md border border-neutral-800" loading="lazy" />
                      ) : (
                        <div className="flex aspect-[5/7] items-center justify-center rounded-md border border-neutral-800 text-center text-xs text-neutral-500">No image available</div>
                      )}
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wide text-neutral-500">Type</div>
                      <div className="mt-1 text-sm text-neutral-200">{card?.type_line || "Unknown"}</div>
                      <div className="mt-3 text-xs uppercase tracking-wide text-neutral-500">Card Text</div>
                      <div className="mt-1 text-sm leading-6 text-neutral-300">{formatTextSymbols(getCardText(card)) || "No text available."}</div>
                    </div>
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>

      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[980px] text-sm">
          <thead className="bg-neutral-950 text-left text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="w-10 px-4 py-3"></th>
              <th className="px-4 py-3">
                <button type="button" onClick={() => toggleSort("name")} className="hover:text-amber-300">Card</button>
              </th>
              <th className="px-4 py-3">
                <button type="button" onClick={() => toggleSort("score")} className="hover:text-amber-300">Score</button>
              </th>
              <th className="px-4 py-3">Roles</th>
              <th className="px-4 py-3">MV</th>
              <th className="px-4 py-3">Cut Signal</th>
              <th className="px-4 py-3">Why</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((score) => {
              const card = findCard(cardMap, score.name);
              const roles = score.roles?.length ? score.roles : getRoleKeys(card);
              const isExpanded = expandedSet.has(score.name);
              const isCore = coreSet.has(normalizeName(score.name));
              const cutCandidate = cutsByName.get(normalizeName(score.name));
              return (
                <Fragment key={score.name}>
                  <tr onClick={() => toggleExpanded(score.name)} className="cursor-pointer border-t border-neutral-800 bg-neutral-900/70 hover:bg-neutral-900">
                    <td className="px-3 py-2 text-neutral-500">
                      {isExpanded ? "-" : "+"}
                    </td>
                    <td className="px-3 py-2 font-medium text-neutral-100">
                      <div className="flex items-center gap-2">
                        <span>{score.name}</span>
                        <ManaCostDisplay card={card} />
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleCoreCard(score.name);
                          }}
                          className={`rounded border px-2 py-0.5 text-[11px] font-semibold ${isCore ? "border-amber-500 bg-amber-500 text-neutral-950" : "border-neutral-700 text-neutral-400 hover:border-amber-500 hover:text-amber-200"}`}
                        >
                          {isCore ? "Core" : "Set core"}
                        </button>
                      </div>
                    </td>
                    <td className={`px-3 py-2 font-mono ${analysisReady ? scoreColor(score.score) : "text-neutral-400"}`}>{analysisReady ? `${score.score > 0 ? "+" : ""}${score.score}` : "Calculating..."}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {roles.slice(0, 4).map((role) => <RoleChip key={role} role={role} />)}
                        {roles.length > 4 && <span className="text-xs text-neutral-500">+{roles.length - 4}</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-neutral-400">{card?.cmc ?? "-"}</td>
                    <td className="px-3 py-2">
                      {cutCandidate
                        ? <span className={`rounded border px-1.5 py-0.5 text-[11px] uppercase ${confidenceClasses(cutCandidate.confidence)}`}>{cutCandidate.confidence}</span>
                        : <span className="text-xs text-neutral-600">-</span>}
                    </td>
                    <td className="px-3 py-2 text-neutral-400">{score.note || "No special signal"}</td>
                  </tr>
                  {isExpanded && (
                    <tr className="border-t border-neutral-800 bg-neutral-950">
                      <td></td>
                      <td colSpan={6} className="px-4 py-4">
                        <div className="grid gap-3 lg:grid-cols-[180px_220px_1fr]">
                          <div>
                            {cardPreviewUrl(card) ? (
                              <img src={cardPreviewUrl(card)} alt={score.name} className="w-full rounded-md border border-neutral-800" loading="lazy" />
                            ) : (
                              <div className="flex aspect-[5/7] items-center justify-center rounded-md border border-neutral-800 text-center text-xs text-neutral-500">No image available</div>
                            )}
                          </div>
                          <div>
                            <div className="text-xs uppercase tracking-wide text-neutral-500">Type</div>
                            <div className="mt-1 text-sm text-neutral-200">{card?.type_line || "Unknown"}</div>
                          </div>
                          <div>
                            <div className="text-xs uppercase tracking-wide text-neutral-500">Card Text</div>
                            <div className="mt-1 text-sm leading-6 text-neutral-300">{formatTextSymbols(getCardText(card)) || "No text available."}</div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
    </div>
  );
}

const CUT_EXCLUDE_OPTIONS = [
  { id: "ramp", label: "Ramp" },
  { id: "draw", label: "Draw" },
  { id: "removal", label: "Removal" },
  { id: "boardWipe", label: "Wipes" },
  { id: "land", label: "Lands" },
  { id: "core", label: "Core" },
];

const TIER_META = {
  S: { label: "S", summary: "Core includes", className: "border-emerald-700 bg-emerald-950/30 text-emerald-100" },
  A: { label: "A", summary: "Strong includes", className: "border-sky-700 bg-sky-950/30 text-sky-100" },
  B: { label: "B", summary: "Good role players", className: "border-blue-700 bg-blue-950/30 text-blue-100" },
  C: { label: "C", summary: "Neutral slots", className: "border-neutral-600 bg-neutral-900 text-neutral-100" },
  D: { label: "D", summary: "Cuttable", className: "border-amber-700 bg-amber-950/30 text-amber-100" },
  F: { label: "F", summary: "Cut first", className: "border-rose-700 bg-rose-950/35 text-rose-100" },
};

function TierListCard({ item, analysisReady, onDecision }) {
  const imageUrl = cardPreviewUrl(item.card);
  const candidate = item.cutCandidate;
  const decision = item.decision;
  return (
    <article className="flex min-w-0 flex-col overflow-hidden rounded border border-neutral-800 bg-neutral-950 shadow-lg">
      <div className="border-b border-neutral-800 bg-neutral-900">
        {imageUrl ? (
          <img src={imageUrl} alt={item.name} className="aspect-[5/7] w-full object-cover" loading="lazy" />
        ) : (
          <div className="flex aspect-[5/7] w-full items-center justify-center bg-neutral-900 p-3 text-center text-xs text-neutral-500">No image available</div>
        )}
      </div>
      <div className="flex min-h-40 flex-1 flex-col gap-2 p-2">
        <div className="min-h-9 text-xs font-semibold leading-snug text-neutral-100">{item.name}</div>
        <div className="flex flex-wrap items-center gap-1">
          <ManaCostDisplay card={item.card} />
          <span className={`rounded border border-neutral-700 bg-neutral-950 px-1.5 py-0.5 font-mono text-[11px] ${analysisReady ? scoreColor(item.score) : "text-neutral-400"}`}>
            {analysisReady ? `${item.score > 0 ? "+" : ""}${item.score}` : "..."}
          </span>
          {candidate && <span className={`rounded border px-1.5 py-0.5 text-[10px] uppercase ${confidenceClasses(candidate.confidence)}`}>{candidate.confidence}</span>}
          {candidate?.sizeCutRecommended && <span className="rounded border border-rose-700 bg-rose-950/50 px-1.5 py-0.5 text-[10px] uppercase text-rose-100">required</span>}
          {decision && <span className={`rounded border px-1.5 py-0.5 text-[10px] uppercase ${decision === "cut" ? "border-rose-700 text-rose-100" : "border-emerald-700 text-emerald-100"}`}>{decision}</span>}
        </div>
        <div className="flex flex-wrap gap-1">
          {(item.roles || []).slice(0, 2).map((role) => <RoleChip key={role} role={role} />)}
          {(item.roles || []).length > 2 && <span className="rounded border border-neutral-700 bg-neutral-800 px-1.5 py-0.5 text-[11px] text-neutral-400">+{item.roles.length - 2}</span>}
        </div>
        {candidate && (
          <div className="mt-auto grid grid-cols-2 gap-1">
            <button
              type="button"
              onClick={() => onDecision(item.name, decision === "cut" ? null : "cut")}
              className={`min-h-7 rounded border px-2 py-1 text-[11px] font-semibold ${decision === "cut" ? "border-rose-500 bg-rose-500 text-neutral-950" : "border-neutral-700 text-neutral-200 hover:border-rose-500 hover:text-rose-100"}`}
            >
              Cut
            </button>
            <button
              type="button"
              onClick={() => onDecision(item.name, decision === "keep" ? null : "keep")}
              className={`min-h-7 rounded border px-2 py-1 text-[11px] font-semibold ${decision === "keep" ? "border-emerald-500 bg-emerald-500 text-neutral-950" : "border-neutral-700 text-neutral-200 hover:border-emerald-500 hover:text-emerald-100"}`}
            >
              Keep
            </button>
          </div>
        )}
      </div>
    </article>
  );
}

function DeckTierList({ analysis, cardMap, cutDecisions, onDecision, analysisReady }) {
  const tierRows = useMemo(() => buildTierRows({ analysis, cardMap, cutDecisions }), [analysis, cardMap, cutDecisions]);
  const totalCards = tierRows.reduce((sum, row) => sum + row.cards.length, 0);
  return (
    <section className={panelClass("overflow-hidden")}>
      <div className="border-b border-neutral-800 p-4 sm:p-5">
        <div className="text-[11px] uppercase tracking-wide text-neutral-500">Tier List</div>
        <div className="mt-1 text-sm text-neutral-400">{totalCards} cards grouped from strongest includes to first cuts. Cut filters below do not hide cards here.</div>
      </div>
      <div className="divide-y divide-neutral-800">
        {tierRows.map((row) => {
          const meta = TIER_META[row.tier];
          return (
            <div key={row.tier} className="grid gap-3 p-3 sm:grid-cols-[120px_minmax(0,1fr)] sm:p-4">
              <div className={`flex min-h-20 items-center justify-between gap-3 rounded border px-3 py-2 sm:flex-col sm:items-start sm:justify-center ${meta.className}`}>
                <div className="text-3xl font-bold leading-none">{meta.label}</div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide">{meta.summary}</div>
                  <div className="mt-1 font-mono text-xs opacity-80">{row.cards.length} card{row.cards.length === 1 ? "" : "s"}</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
                {row.cards.length
                  ? row.cards.map((item) => (
                    <TierListCard key={item.name} item={item} analysisReady={analysisReady} onDecision={onDecision} />
                  ))
                  : <div className="flex min-h-40 items-center text-sm text-neutral-500">No cards in this tier.</div>}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function CutCandidateCard({ candidate, cardMap, analysisReady, decision, onDecision }) {
  const card = findCard(cardMap, candidate.name);
  const decisionClasses = decision === "cut"
    ? "border-rose-500 bg-rose-950/30"
    : decision === "keep"
      ? "border-emerald-600 bg-emerald-950/20"
      : "border-neutral-800 bg-neutral-950";
  return (
    <article className={`rounded-lg border p-3 sm:p-4 ${decisionClasses}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <CardPreview card={card} name={candidate.name} />
            <ManaCostDisplay card={card} />
            <span className={`rounded border px-2 py-0.5 text-xs uppercase ${confidenceClasses(candidate.confidence)}`}>{candidate.confidence}</span>
            {decision && <span className={`rounded border px-2 py-0.5 text-xs uppercase ${decision === "cut" ? "border-rose-700 text-rose-200" : "border-emerald-700 text-emerald-200"}`}>{decision}</span>}
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {candidate.sizeCutRecommended && <span className="rounded border border-rose-800 bg-rose-950/40 px-2 py-0.5 text-xs uppercase text-rose-200">required cut</span>}
            {(candidate.roles || []).length
              ? candidate.roles.map((role) => <RoleChip key={role} role={role} />)
              : <span className="text-xs text-neutral-500">No major role detected</span>}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className={`rounded border border-neutral-700 px-2 py-1 font-mono text-sm ${analysisReady ? scoreColor(candidate.score) : "text-neutral-400"}`}>
            {analysisReady ? `${candidate.score > 0 ? "+" : ""}${candidate.score}` : "Calculating..."}
          </div>
          {Number.isFinite(candidate.rank) && <div className="mt-1 text-xs text-neutral-500">Rank {candidate.rank}</div>}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onDecision(candidate.name, decision === "cut" ? null : "cut")}
          className={`min-h-9 rounded border px-3 py-1 text-xs font-semibold ${decision === "cut" ? "border-rose-500 bg-rose-500 text-neutral-950" : "border-neutral-700 text-neutral-300 hover:border-rose-500 hover:text-rose-200"}`}
        >
          Cut
        </button>
        <button
          type="button"
          onClick={() => onDecision(candidate.name, decision === "keep" ? null : "keep")}
          className={`min-h-9 rounded border px-3 py-1 text-xs font-semibold ${decision === "keep" ? "border-emerald-500 bg-emerald-500 text-neutral-950" : "border-neutral-700 text-neutral-300 hover:border-emerald-500 hover:text-emerald-200"}`}
        >
          Keep
        </button>
        {decision && (
          <button
            type="button"
            onClick={() => onDecision(candidate.name, null)}
            className="min-h-9 rounded border border-neutral-700 px-3 py-1 text-xs text-neutral-400 hover:border-neutral-500 hover:text-neutral-200"
          >
            Clear
          </button>
        )}
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-neutral-500">Why Cuttable</div>
          <ul className="mt-2 space-y-1 text-sm text-neutral-300">
            {(candidate.reasons || []).map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
          {Number.isFinite(candidate.cutPressure) && (
            <div className="mt-3 text-xs text-neutral-500">Cut pressure {candidate.cutPressure} minus keep pressure {candidate.keepPressure ?? 0}</div>
          )}
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-neutral-500">Replace With</div>
          <div className="mt-2 text-sm font-semibold text-emerald-200">{candidate.replacementNeed}</div>
          {(candidate.riskFlags || []).length > 0 && (
            <div className="mt-3 rounded border border-amber-900 bg-amber-950/30 p-2 text-xs text-amber-100">
              {candidate.riskFlags.join(" ")}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

function CompareCandidatePanel({ candidate, decision, onDecision, analysisReady }) {
  return (
    <div className={`rounded border p-3 ${decision === "cut" ? "border-rose-700 bg-rose-950/30" : decision === "keep" ? "border-emerald-700 bg-emerald-950/20" : "border-neutral-800 bg-neutral-950"}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold text-neutral-100">{candidate.name}</div>
          <div className={`mt-1 inline-flex rounded border px-2 py-0.5 text-xs uppercase ${confidenceClasses(candidate.confidence)}`}>{candidate.confidence}</div>
        </div>
        <div className="text-right">
          <div className={`font-mono ${analysisReady ? scoreColor(candidate.score) : "text-neutral-400"}`}>{analysisReady ? `${candidate.score > 0 ? "+" : ""}${candidate.score}` : "..."}</div>
          {Number.isFinite(candidate.rank) && <div className="mt-1 text-xs text-neutral-500">Rank {candidate.rank}</div>}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <div className="rounded border border-neutral-800 bg-neutral-950/70 px-2 py-1">
          <div className="uppercase tracking-wide text-neutral-500">Cut</div>
          <div className="mt-1 font-mono text-rose-200">{candidate.cutPressure ?? "-"}</div>
        </div>
        <div className="rounded border border-neutral-800 bg-neutral-950/70 px-2 py-1">
          <div className="uppercase tracking-wide text-neutral-500">Keep</div>
          <div className="mt-1 font-mono text-emerald-200">{candidate.keepPressure ?? 0}</div>
        </div>
        <div className="rounded border border-neutral-800 bg-neutral-950/70 px-2 py-1">
          <div className="uppercase tracking-wide text-neutral-500">Need</div>
          <div className="mt-1 truncate text-neutral-200">{candidate.replacementNeed}</div>
        </div>
      </div>
      <div className="mt-3">
        <div className="text-[11px] uppercase tracking-wide text-neutral-500">Cut Reason</div>
        <div className="mt-1 text-xs text-neutral-300">{candidate.cutReason?.[0] || candidate.reasons?.[0] || "No cut reason available."}</div>
      </div>
      {(candidate.keepRisk || candidate.riskFlags || []).length > 0 && (
        <div className="mt-3 rounded border border-amber-900 bg-amber-950/30 p-2 text-xs text-amber-100">
          {(candidate.keepRisk || candidate.riskFlags).join(" ")}
        </div>
      )}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => onDecision(candidate.name, decision === "cut" ? null : "cut")}
          className={`min-h-8 flex-1 rounded border px-2 py-1 text-xs font-semibold ${decision === "cut" ? "border-rose-500 bg-rose-500 text-neutral-950" : "border-neutral-700 text-neutral-300 hover:border-rose-500 hover:text-rose-200"}`}
        >
          Cut
        </button>
        <button
          type="button"
          onClick={() => onDecision(candidate.name, decision === "keep" ? null : "keep")}
          className={`min-h-8 flex-1 rounded border px-2 py-1 text-xs font-semibold ${decision === "keep" ? "border-emerald-500 bg-emerald-500 text-neutral-950" : "border-neutral-700 text-neutral-300 hover:border-emerald-500 hover:text-emerald-200"}`}
        >
          Keep
        </button>
      </div>
    </div>
  );
}

function CutsTab({ analysis, cardMap, analysisReady }) {
  const deckSizePlan = analysis.deckSizePlan || {};
  const requiredCuts = deckSizePlan.cutsNeeded || 0;
  const [cutCount, setCutCount] = useState(requiredCuts || 3);
  const [cutDecisions, setCutDecisions] = useState({});
  const [excludedRoles, setExcludedRoles] = useState([]);
  const [highConfidenceOnly, setHighConfidenceOnly] = useState(false);
  const [compareA, setCompareA] = useState("");
  const [compareB, setCompareB] = useState("");
  const [exportCopyStatus, setExportCopyStatus] = useState("idle");
  const candidates = analysis.cutCandidates || [];
  const candidateKeys = useMemo(() => new Set(candidates.map((candidate) => normalizeName(candidate.name))), [candidates]);
  const excludedSet = useMemo(() => new Set(excludedRoles), [excludedRoles]);
  const filteredCandidates = useMemo(() => candidates.filter((candidate) => {
    if (highConfidenceOnly && candidate.confidence !== "high") return false;
    return !(candidate.roles || []).some((role) => excludedSet.has(role));
  }), [candidates, excludedSet, highConfidenceOnly]);
  const visibleCandidates = filteredCandidates.slice(0, cutCount);
  const acceptedCuts = candidates.filter((candidate) => cutDecisions[normalizeName(candidate.name)] === "cut");
  const keptCandidates = candidates.filter((candidate) => cutDecisions[normalizeName(candidate.name)] === "keep");
  const acceptedCutKeys = new Set(acceptedCuts.map((candidate) => normalizeName(candidate.name)));
  const keptCandidateKeys = new Set(keptCandidates.map((candidate) => normalizeName(candidate.name)));
  const requiredExportCuts = requiredCuts > 0
    ? [
      ...acceptedCuts,
      ...filteredCandidates
        .filter((candidate) => !acceptedCutKeys.has(normalizeName(candidate.name)) && !keptCandidateKeys.has(normalizeName(candidate.name)))
        .slice(0, Math.max(0, requiredCuts - acceptedCuts.length)),
    ].slice(0, requiredCuts)
    : acceptedCuts.length
      ? acceptedCuts
      : visibleCandidates;
  const requiredExportKeys = new Set(requiredExportCuts.map((candidate) => normalizeName(candidate.name)));
  const additionalCutIdeas = visibleCandidates.filter((candidate) => {
    const key = normalizeName(candidate.name);
    return !requiredExportKeys.has(key) && !keptCandidateKeys.has(key);
  });
  const autoFillCuts = requiredCuts > 0 ? requiredExportCuts.filter((candidate) => !acceptedCutKeys.has(normalizeName(candidate.name))) : [];
  const acceptedCutCountForTarget = Math.min(acceptedCuts.length, requiredCuts || acceptedCuts.length);
  const projectedTotal = Number.isFinite(deckSizePlan.totalCards) ? deckSizePlan.totalCards - acceptedCuts.length : null;
  const projectedExportTotal = Number.isFinite(deckSizePlan.totalCards) ? deckSizePlan.totalCards - requiredExportCuts.length : null;
  const projectedExportMeetsTarget = Number.isFinite(projectedExportTotal) && projectedExportTotal <= (deckSizePlan.targetTotal || 100);
  const remainingManualCuts = Math.max(0, requiredCuts - acceptedCuts.length);
  const compareLeft = candidates.find((candidate) => candidate.name === compareA);
  const compareRight = candidates.find((candidate) => candidate.name === compareB);
  const needs = (analysis.highlights?.needsAttention || []).filter((item) => !item.ignored).slice(0, 4);
  const exportText = [
    requiredCuts > 0 ? `Required cuts (${requiredCuts})` : "Cuts",
    ...requiredExportCuts.map((candidate) => `- ${candidate.name}: ${candidate.replacementNeed}`),
    ...(requiredCuts > 0 && additionalCutIdeas.length ? ["", "Additional cut ideas", ...additionalCutIdeas.map((candidate) => `- ${candidate.name}: ${candidate.replacementNeed}`)] : []),
    ...(keptCandidates.length ? ["", "Do not cut", ...keptCandidates.map((candidate) => `- ${candidate.name}`)] : []),
    "",
    "Adds",
    ...(analysis.upgrades || []).slice(0, cutCount).map((upgrade) => `- ${upgrade.add}`),
    "",
    "Maybe cuts",
    ...filteredCandidates.slice(cutCount, cutCount + 5).map((candidate) => `- ${candidate.name} (${candidate.confidence})`),
    "",
    "Protected core cards",
    ...(analysis.coreCards || []).map((name) => `- ${name}`),
  ].join("\n");

  useEffect(() => {
    setCutCount(requiredCuts || 3);
  }, [requiredCuts]);

  useEffect(() => {
    setExportCopyStatus("idle");
  }, [exportText]);

  useEffect(() => {
    setCutDecisions((current) => Object.fromEntries(Object.entries(current).filter(([name]) => candidateKeys.has(name))));
  }, [candidateKeys]);

  const setCandidateDecision = (name, decision) => {
    setCutDecisions((current) => {
      const key = normalizeName(name);
      const next = { ...current };
      if (decision) next[key] = decision;
      else delete next[key];
      return next;
    });
  };

  const acceptRecommendedCuts = () => {
    setCutDecisions((current) => {
      const next = { ...current };
      for (const candidate of requiredExportCuts) {
        next[normalizeName(candidate.name)] = "cut";
      }
      return next;
    });
  };

  const clearCutReview = () => {
    setCutDecisions({});
  };

  const copyExportText = async () => {
    try {
      if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(exportText);
      setExportCopyStatus("copied");
    } catch {
      setExportCopyStatus("error");
    }
  };

  const toggleExcludedRole = (role) => {
    setExcludedRoles((current) => current.includes(role) ? current.filter((item) => item !== role) : [...current, role]);
  };

  return (
    <div className="space-y-4">
      {requiredCuts > 0 && (
        <section className={panelClass("p-4 sm:p-5")}>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-rose-300">Deck Size</div>
              <h2 className="mt-1 text-xl font-semibold text-neutral-50">Need {requiredCuts} cut{requiredCuts === 1 ? "" : "s"} to reach {deckSizePlan.targetTotal || 100}</h2>
              <p className="mt-1 text-sm text-neutral-400">{deckSizePlan.message}</p>
              <p className="mt-2 text-sm text-neutral-300">{acceptedCutCountForTarget}/{requiredCuts} accepted cuts selected. Projected total after accepted cuts: {projectedTotal ?? "-"}.</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-3 lg:min-w-[360px]">
              <Metric label="Total" value={deckSizePlan.totalCards ?? "-"} tone="warn" />
              <Metric label="Allowed" value={deckSizePlan.allowedTotal ?? "-"} tone="neutral" />
              <Metric label="Target" value={deckSizePlan.targetTotal ?? 100} tone="good" />
            </div>
          </div>
        </section>
      )}

      <section className={panelClass("p-4 sm:p-5")}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">Cut Finder</div>
            <div className="mt-1 text-sm text-neutral-400">{filteredCandidates.length} cut candidates after filters{requiredCuts > 0 ? `; first ${requiredCuts} are marked as required cuts` : ""}</div>
            <div className="mt-1 text-xs text-neutral-500">{acceptedCuts.length} marked cut, {keptCandidates.length} marked keep</div>
          </div>
          <div className="flex flex-wrap gap-2">
            {[requiredCuts, 1, 3, 10].filter((count, index, list) => count > 0 && list.indexOf(count) === index).map((count) => (
              <button
                key={count}
                type="button"
                onClick={() => setCutCount(count)}
                className={`min-h-9 rounded border px-3 py-1 text-xs font-semibold ${cutCount === count ? "border-amber-500 bg-amber-500 text-neutral-950" : "border-neutral-700 text-neutral-300 hover:border-amber-500"}`}
              >
                Need {count} cut{count === 1 ? "" : "s"}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setHighConfidenceOnly((current) => !current)}
              className={`min-h-9 rounded border px-3 py-1 text-xs font-semibold ${highConfidenceOnly ? "border-rose-500 bg-rose-500 text-neutral-950" : "border-neutral-700 text-neutral-300 hover:border-rose-500"}`}
            >
              High confidence
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {CUT_EXCLUDE_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => toggleExcludedRole(option.id)}
              className={`min-h-9 rounded border px-3 py-1 text-xs ${excludedSet.has(option.id) ? "border-sky-500 bg-sky-500 text-neutral-950" : "border-neutral-700 text-neutral-300 hover:border-sky-500"}`}
            >
              Exclude {option.label}
            </button>
          ))}
        </div>
      </section>

      <DeckTierList
        analysis={analysis}
        cardMap={cardMap}
        cutDecisions={cutDecisions}
        onDecision={setCandidateDecision}
        analysisReady={analysisReady}
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <section className="space-y-3">
          {visibleCandidates.length
            ? visibleCandidates.map((candidate) => (
              <CutCandidateCard
                key={candidate.name}
                candidate={candidate}
                cardMap={cardMap}
                analysisReady={analysisReady}
                decision={cutDecisions[normalizeName(candidate.name)]}
                onDecision={setCandidateDecision}
              />
            ))
            : <div className={panelClass("p-4 text-sm text-neutral-500")}>No cut candidates match the current filters.</div>}
        </section>

        <aside className="space-y-4">
          <section className={panelClass("p-4")}>
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">Cut Review</div>
            <div className="mt-3 grid gap-2 text-sm">
              <div className="flex items-center justify-between rounded border border-neutral-800 bg-neutral-950 px-3 py-2">
                <span className="text-neutral-300">Accepted cuts</span>
                <span className="font-mono text-rose-200">{acceptedCuts.length}</span>
              </div>
              <div className="flex items-center justify-between rounded border border-neutral-800 bg-neutral-950 px-3 py-2">
                <span className="text-neutral-300">Kept candidates</span>
                <span className="font-mono text-emerald-200">{keptCandidates.length}</span>
              </div>
              {requiredCuts > 0 && (
                <div className={`rounded border px-3 py-2 ${acceptedCuts.length >= requiredCuts ? "border-emerald-900 bg-emerald-950/30 text-emerald-200" : "border-amber-900 bg-amber-950/30 text-amber-100"}`}>
                  {acceptedCuts.length >= requiredCuts
                    ? "Required cut count is covered."
                    : `${remainingManualCuts} more cut${remainingManualCuts === 1 ? "" : "s"} still need confirmation.`}
                </div>
              )}
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={acceptRecommendedCuts}
                  disabled={!requiredExportCuts.length}
                  className="min-h-9 rounded border border-rose-700 px-3 py-1 text-xs font-semibold text-rose-100 hover:bg-rose-950/40 disabled:cursor-not-allowed disabled:border-neutral-800 disabled:text-neutral-600"
                >
                  Accept recommended cuts
                </button>
                <button
                  type="button"
                  onClick={clearCutReview}
                  disabled={!Object.keys(cutDecisions).length}
                  className="min-h-9 rounded border border-neutral-700 px-3 py-1 text-xs font-semibold text-neutral-300 hover:border-neutral-500 disabled:cursor-not-allowed disabled:border-neutral-800 disabled:text-neutral-600"
                >
                  Clear review
                </button>
              </div>
              {requiredCuts > 0 && (
                <div className="rounded border border-neutral-800 bg-neutral-950 px-3 py-2">
                  <div className="text-xs uppercase tracking-wide text-neutral-500">Projected Export Total</div>
                  <div className={`mt-1 font-mono text-lg ${projectedExportMeetsTarget ? "text-emerald-200" : "text-amber-200"}`}>{projectedExportTotal ?? "-"}</div>
                  <div className="mt-1 text-xs text-neutral-500">Includes accepted cuts plus automatic fill.</div>
                </div>
              )}
              {autoFillCuts.length > 0 && (
                <div className="rounded border border-neutral-800 bg-neutral-950 px-3 py-2">
                  <div className="text-xs uppercase tracking-wide text-neutral-500">Auto-fill Cuts</div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {autoFillCuts.map((candidate) => <span key={candidate.name} className="rounded border border-neutral-700 px-2 py-0.5 text-xs text-neutral-300">{candidate.name}</span>)}
                  </div>
                </div>
              )}
            </div>
          </section>

          <section className={panelClass("p-4")}>
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">Deck Needs</div>
            <div className="mt-3 space-y-2">
              {needs.length
                ? needs.map((item) => (
                  <div key={item.key} className={`rounded border p-3 text-sm ${statusClasses(item.status)}`}>
                    <div className="font-semibold">{item.label}</div>
                    <div className="mt-1 text-neutral-300">{item.summary}</div>
                  </div>
                ))
                : <div className="text-sm text-neutral-500">No low scorecard categories are currently active.</div>}
            </div>
          </section>

          <section className={panelClass("p-4")}>
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">Compare Slots</div>
            <div className="mt-3 grid gap-2">
              <select value={compareA} onChange={(event) => setCompareA(event.target.value)} className="min-h-10 rounded border border-neutral-800 bg-neutral-950 px-2 text-sm text-neutral-100">
                <option value="">First card</option>
                {candidates.map((candidate) => <option key={`a-${candidate.name}`} value={candidate.name}>{candidate.name}</option>)}
              </select>
              <select value={compareB} onChange={(event) => setCompareB(event.target.value)} className="min-h-10 rounded border border-neutral-800 bg-neutral-950 px-2 text-sm text-neutral-100">
                <option value="">Second card</option>
                {candidates.map((candidate) => <option key={`b-${candidate.name}`} value={candidate.name}>{candidate.name}</option>)}
              </select>
            </div>
            {compareLeft && compareRight && (
              <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                {[compareLeft, compareRight].map((candidate) => (
                  <CompareCandidatePanel
                    key={candidate.name}
                    candidate={candidate}
                    decision={cutDecisions[normalizeName(candidate.name)]}
                    onDecision={setCandidateDecision}
                    analysisReady={analysisReady}
                  />
                ))}
              </div>
            )}
          </section>

          <section className={panelClass("p-4")}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-wide text-neutral-500">Export Changes</div>
                <div className="mt-1 text-xs text-neutral-500">Copy this into Moxfield notes or your deckbuilding checklist.</div>
              </div>
              <button
                type="button"
                onClick={copyExportText}
                className="min-h-9 shrink-0 rounded border border-neutral-700 px-3 py-1 text-xs font-semibold text-neutral-300 hover:border-amber-500 hover:text-amber-200"
              >
                {exportCopyStatus === "copied" ? "Copied" : "Copy change plan"}
              </button>
            </div>
            {exportCopyStatus === "error" && <div className="mt-2 rounded border border-amber-900 bg-amber-950/30 px-3 py-2 text-xs text-amber-100">Clipboard access was blocked. Select the text below to copy manually.</div>}
            <textarea readOnly value={exportText} className="mt-3 min-h-64 w-full rounded border border-neutral-800 bg-neutral-950 p-3 font-mono text-xs leading-5 text-neutral-300" />
          </section>
        </aside>
      </div>
    </div>
  );
}

function UpgradesTab({ analysis, analysisReady }) {
  const roadmap = analysis.roadmap || {};
  const candidateAdds = [...analysis.sideboardAnalysis, ...analysis.consideringAnalysis];
  const recommendedAdds = candidateAdds.filter((candidate) => candidate.recommendation === "add");
  const maybeAdds = candidateAdds.filter((candidate) => candidate.recommendation === "maybe");
  const [addPlanCopyStatus, setAddPlanCopyStatus] = useState("idle");
  const addPlanText = [
    "Add priorities",
    ...((roadmap.steps || []).slice(0, 5).map((step) => `- ${step.label}: ${step.action}`)),
    "",
    "Suggested swaps",
    ...((roadmap.upgradePairs || analysis.upgrades || []).slice(0, 5).map((upgrade) => `- Add ${upgrade.add}${upgrade.cut ? ` over ${upgrade.cut}` : ""}`)),
    "",
    "Candidate adds",
    ...recommendedAdds.map((candidate) => `- ${candidate.name}: ${candidate.reason}`),
    "",
    "Maybe adds",
    ...maybeAdds.slice(0, 5).map((candidate) => `- ${candidate.name}: ${candidate.reason}`),
  ].join("\n");

  useEffect(() => {
    setAddPlanCopyStatus("idle");
  }, [addPlanText]);

  const copyAddPlan = async () => {
    try {
      if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(addPlanText);
      setAddPlanCopyStatus("copied");
    } catch {
      setAddPlanCopyStatus("error");
    }
  };

  return (
    <div className="grid gap-3 sm:gap-4 xl:grid-cols-2">
      <section className={`${panelClass("p-4 sm:p-5")} xl:col-span-2`}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">Add Plan</div>
            <div className="mt-1 text-sm text-neutral-300">{roadmap.headline || "Use the current roadmap and candidate pool to decide what to add next."}</div>
          </div>
          <button
            type="button"
            onClick={copyAddPlan}
            className="min-h-9 w-fit rounded border border-neutral-700 px-3 py-1 text-xs font-semibold text-neutral-300 hover:border-amber-500 hover:text-amber-200"
          >
            {addPlanCopyStatus === "copied" ? "Copied" : "Copy add plan"}
          </button>
        </div>
        {addPlanCopyStatus === "error" && <div className="mt-3 rounded border border-amber-900 bg-amber-950/30 px-3 py-2 text-xs text-amber-100">Clipboard access was blocked. Use the add plan text below as the source of truth.</div>}
        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)]">
          <div className="space-y-2">
            {(roadmap.steps || []).slice(0, 4).map((step, index) => (
              <div key={`${step.label}-${index}`} className="rounded border border-neutral-800 bg-neutral-950 px-3 py-2">
                <div className="text-xs uppercase tracking-wide text-neutral-500">Priority {index + 1}</div>
                <div className="mt-1 text-sm font-semibold text-neutral-100">{step.label}</div>
                <div className="mt-1 text-sm text-neutral-300">{step.action}</div>
              </div>
            ))}
            {!(roadmap.steps || []).length && <div className="rounded border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-500">No add priorities are active yet.</div>}
          </div>
          <div className="grid gap-3">
            <div className="rounded border border-neutral-800 bg-neutral-950 p-3">
              <div className="text-[11px] uppercase tracking-wide text-neutral-500">Suggested Adds</div>
              <div className="mt-2 space-y-2">
                {(roadmap.upgradePairs || []).length
                  ? roadmap.upgradePairs.slice(0, 3).map((upgrade) => (
                    <div key={`${upgrade.cut}-${upgrade.add}`} className="text-sm">
                      <div className="font-semibold text-emerald-200">{upgrade.add}</div>
                      <div className="text-xs text-neutral-500">{upgrade.cut ? `Use over ${upgrade.cut}` : upgrade.reason}</div>
                    </div>
                  ))
                  : <div className="text-sm text-neutral-500">No specific add pairings yet.</div>}
              </div>
            </div>
            <div className="rounded border border-neutral-800 bg-neutral-950 p-3">
              <div className="text-[11px] uppercase tracking-wide text-neutral-500">Candidate Pool</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {recommendedAdds.length
                  ? recommendedAdds.slice(0, 8).map((candidate) => <span key={candidate.name} className="rounded border border-emerald-800 px-2 py-0.5 text-xs text-emerald-200">{candidate.name}</span>)
                  : <span className="text-sm text-neutral-500">No add-ready sideboard or considering cards.</span>}
              </div>
            </div>
          </div>
        </div>
      </section>
      <section className={panelClass("p-4 sm:p-5")}>
        <div className="text-[11px] uppercase tracking-wide text-neutral-500">Recommended Swaps</div>
        <div className="mt-3 space-y-3">
          {analysis.upgrades.map((upgrade) => (
            <div key={`${upgrade.cut}-${upgrade.add}`} className="rounded-lg border border-neutral-800 bg-neutral-950 p-3 sm:p-4">
              <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                  <div>
                    <div className="text-xs text-neutral-500">Cut</div>
                    <div className="font-semibold text-rose-200">{upgrade.cut}</div>
                    <div className={`text-xs font-mono ${analysisReady ? scoreColor(upgrade.cutScore) : "text-neutral-400"}`}>{analysisReady ? `${upgrade.cutScore > 0 ? "+" : ""}${upgrade.cutScore}` : "Calculating..."}</div>
                  </div>
                <div className="text-neutral-600">to</div>
                <div>
                  <div className="text-xs text-neutral-500">Add</div>
                  <div className="font-semibold text-emerald-200">{upgrade.add}</div>
                </div>
              </div>
              <p className="mt-3 text-sm text-neutral-400">{upgrade.reason}</p>
            </div>
          ))}
        </div>
      </section>

      <section className={panelClass("p-4 sm:p-5")}>
        <div className="text-[11px] uppercase tracking-wide text-neutral-500">Candidate Cards</div>
        <div className="mt-3 space-y-3">
          {[...analysis.sideboardAnalysis, ...analysis.consideringAnalysis].length === 0 && <div className="text-sm text-neutral-500">No sideboard or considering cards provided.</div>}
          {[...analysis.sideboardAnalysis, ...analysis.consideringAnalysis].map((candidate) => (
            <div key={candidate.name} className="rounded-lg border border-neutral-800 bg-neutral-950 p-3 sm:p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="font-semibold text-neutral-100">{candidate.name}</div>
                <span className="rounded border border-neutral-700 px-2 py-0.5 text-xs uppercase text-neutral-300">{candidate.recommendation}</span>
              </div>
              <p className="mt-2 text-sm text-neutral-400">{candidate.reason}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function HandCard({ item }) {
  const imageUrl = cardPreviewUrl(item.card);
  return (
    <article className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950">
      {imageUrl ? (
        <img src={imageUrl} alt={item.name} className="aspect-[5/7] w-full object-cover" loading="lazy" />
      ) : (
        <div className="flex aspect-[5/7] items-center justify-center bg-neutral-900 p-3 text-center text-xs text-neutral-500">No image available</div>
      )}
      <div className="flex flex-1 flex-col gap-2 p-2.5">
        <div className="text-sm font-semibold leading-tight text-neutral-100">{item.name}</div>
        <div className="mt-auto flex flex-wrap gap-1">
          {item.roles.slice(0, 3).map((role) => <RoleChip key={role} role={role} />)}
        </div>
      </div>
    </article>
  );
}

function MulliganTab({ analysis, deck, cardMap, coreCards }) {
  const [attempts, setAttempts] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const attemptNumber = useRef(0);

  const drawHand = () => {
    const hand = drawOpeningHand(deck);
    const result = analyzeOpeningHand({ deck, hand, cardMap, analysis, coreCards });
    attemptNumber.current += 1;
    const attempt = { id: attemptNumber.current, hand, result };
    setAttempts((current) => [attempt, ...current].slice(0, 8));
    setSelectedId(attempt.id);
  };

  const selected = attempts.find((attempt) => attempt.id === selectedId) || attempts[0];
  const result = selected?.result;

  return (
    <div className="space-y-5">
      <section className={panelClass("p-4 sm:p-5")}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">First-hand testing</div>
            <h3 className="mt-1 text-2xl font-bold text-neutral-50">Opening Hand Lab</h3>
            <p className="mt-2 max-w-2xl text-sm text-neutral-400">Every attempt reshuffles the complete main deck and draws a fresh seven. Previous attempts never remove cards from the next mulligan.</p>
          </div>
          <button type="button" onClick={drawHand} className="min-h-12 rounded-lg bg-amber-500 px-5 py-3 font-bold text-neutral-950 hover:bg-amber-400">
            {attempts.length ? "Draw fresh seven" : "Draw opening hand"}
          </button>
        </div>
      </section>

      {!result ? (
        <section className={panelClass("p-8 text-center")}>
          <div className="text-lg font-semibold text-neutral-200">Ready for a first hand</div>
          <div className="mt-2 text-sm text-neutral-500">Draw seven to grade the hand and find the cards that would best hold it together.</div>
        </section>
      ) : (
        <>
          <section className={panelClass("p-4 sm:p-5")}>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="text-[11px] uppercase tracking-wide text-neutral-500">Attempt {selected.id}</div>
                <div className="mt-1 flex flex-wrap items-center gap-3">
                  <h3 className="text-3xl font-bold text-neutral-50">{result.verdict.label}</h3>
                  <span className={`rounded-lg border px-3 py-1 font-mono text-lg font-bold ${statusClasses(result.verdict.status)}`}>{result.score}/100</span>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                <Metric label="Colored sources" value={result.metrics.coloredSources} tone={result.metrics.coloredSources >= 2 && result.metrics.coloredSources <= 4 ? "good" : "bad"} sub={`${result.metrics.lands} total lands`} />
                <Metric label="Early plays" value={result.metrics.earlyPlays} tone={result.metrics.earlyPlays >= 2 ? "good" : "warn"} />
                <Metric label="Ramp" value={result.metrics.ramp} />
                <Metric label="Card flow" value={result.metrics.cardFlow} />
                <Metric label="Interaction" value={result.metrics.interaction} />
                <Metric label="Engine" value={result.metrics.engineAccess} />
              </div>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
              {result.cards.map((item, index) => <HandCard key={`${item.name}-${item.copyIndex ?? index}-${index}`} item={item} />)}
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <div className="rounded-lg border border-emerald-900/70 bg-emerald-950/20 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-emerald-300">What works</div>
                <div className="mt-3 space-y-2 text-sm text-neutral-300">
                  {result.strengths.length ? result.strengths.map((item) => <div key={item}>• {item}</div>) : <div>No clear structural strength was detected.</div>}
                </div>
              </div>
              <div className="rounded-lg border border-amber-900/70 bg-amber-950/20 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-amber-300">Keep risk</div>
                <div className="mt-3 space-y-2 text-sm text-neutral-300">
                  {result.concerns.length ? result.concerns.map((item) => <div key={item}>• {item}</div>) : <div>No major opening-hand weakness was detected.</div>}
                </div>
              </div>
            </div>
          </section>

          <section className={panelClass("p-4 sm:p-5")}>
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">What this hand is missing</div>
            <h3 className="mt-1 text-xl font-bold text-neutral-50">Glue categories</h3>
            <p className="mt-2 text-sm text-neutral-400">{result.glueSummary}</p>
            {result.glueNeeds.length > 0 && (
              <div className="mt-4 grid gap-3 lg:grid-cols-3">
                {result.glueNeeds.map((need) => (
                  <article key={need.key} className="rounded-lg border border-neutral-800 bg-neutral-950 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="font-semibold text-neutral-100">{need.label}</div>
                      <span className="rounded border border-emerald-800 bg-emerald-950/40 px-2 py-1 font-mono text-xs text-emerald-300">up to +{need.improvement}</span>
                    </div>
                    <div className="mt-2 text-sm text-neutral-300">{need.detail}</div>
                    <div className="mt-4 text-[11px] uppercase tracking-wide text-neutral-500">Examples from this deck</div>
                    <div className="mt-2 space-y-2">
                      {need.examples.map((example) => (
                        <div key={example.name} className="flex items-center justify-between gap-3 rounded border border-neutral-800 bg-neutral-900/60 px-2.5 py-2">
                          <CardPreview card={findCard(cardMap, example.name)} name={example.name} />
                          <span className="shrink-0 font-mono text-xs text-emerald-300">+{example.improvement}</span>
                        </div>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {attempts.length > 1 && (
        <section className={panelClass("p-4 sm:p-5")}>
          <div className="text-[11px] uppercase tracking-wide text-neutral-500">Recent independent attempts</div>
          <div className="mt-3 flex flex-wrap gap-2">
            {attempts.map((attempt) => (
              <button key={attempt.id} type="button" onClick={() => setSelectedId(attempt.id)} className={`rounded-lg border px-3 py-2 text-left text-sm ${selected?.id === attempt.id ? "border-amber-500 bg-amber-950/30 text-amber-100" : "border-neutral-800 bg-neutral-950 text-neutral-300"}`}>
                <span className="font-semibold">#{attempt.id} {attempt.result.verdict.label}</span>
                <span className="ml-2 font-mono text-xs text-neutral-500">{attempt.result.score}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function DebugTab({ analysis, deck, cardMap, notFound }) {
  return (
    <section className={panelClass("p-4 sm:p-5")}>
      <div className="text-[11px] uppercase tracking-wide text-neutral-500">Debug</div>
      <pre className="mt-3 max-h-[640px] overflow-auto rounded-lg bg-neutral-950 p-4 text-xs leading-5 text-neutral-300">
        {JSON.stringify({ deck, commanderProfile: analysis.commanderProfile, deckSizePlan: analysis.deckSizePlan, scorecard: analysis.scorecard, cutCandidates: analysis.cutCandidates, roadmap: analysis.roadmap, actionPlan: analysis.actionPlan, settings: analysis.settings, coreCards: analysis.coreCards, structure: analysis.structure, priorityFindings: analysis.priorityFindings, bracket: analysis.bracket, notFound, indexedCards: Object.keys(cardMap).length }, null, 2)}
      </pre>
    </section>
  );
}

function TabButton({ tab, activeTab, setActiveTab, mobile = false }) {
  return (
    <button
      key={tab.id}
      type="button"
      onClick={() => setActiveTab(tab.id)}
      className={`${mobile ? "min-h-12 min-w-[96px] px-3 py-2 text-xs" : "min-h-10 px-3 py-2 text-sm"} shrink-0 rounded-lg font-semibold ${activeTab === tab.id ? "bg-amber-500 text-neutral-950" : "text-neutral-400 hover:bg-neutral-900 hover:text-neutral-100"}`}
    >
      {tab.label}
    </button>
  );
}

function MobileTabBar({ activeTab, setActiveTab }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 flex gap-2 overflow-x-auto border-t border-neutral-800 bg-neutral-950/95 px-3 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] pt-2 shadow-2xl backdrop-blur md:hidden">
      {TABS.map((tab) => <TabButton key={tab.id} tab={tab} activeTab={activeTab} setActiveTab={setActiveTab} mobile />)}
    </nav>
  );
}

function CalculatingAnalysisPanel() {
  return (
    <section className={panelClass("p-5 sm:p-6")}>
      <div className="text-[11px] uppercase tracking-wide text-neutral-500">Analysis</div>
      <div className="mt-2 text-2xl font-bold text-neutral-50">Calculating...</div>
    </section>
  );
}

function Dashboard({ analysis, deck, cardMap, notFound, cardDataLoading, cardDataProgress, activeTab, setActiveTab, analysisSettings, setAnalysisSettings, coreCards, toggleCoreCard }) {
  const [roleFilter, setRoleFilter] = useState("all");
  const [sortCol, setSortCol] = useState("score");
  const [sortDir, setSortDir] = useState("asc");
  const analysisReady = !cardDataLoading;

  const pipData = useMemo(() => {
    const total = Object.values(analysis.colorPips || {}).reduce((sum, value) => sum + value, 0) || 1;
    return Object.entries(analysis.colorPips || {})
      .filter(([, value]) => value > 0)
      .map(([key, value]) => ({
        key,
        label: COLOR_LABEL[key] || key,
        count: Math.round(value * 10) / 10,
        pct: Math.round((value / total) * 1000) / 10,
        hex: COLOR_HEX[key] || "#a1a1aa",
      }));
  }, [analysis.colorPips]);

  const cmcBuckets = useMemo(() => {
    if (analysis.structure?.manaCurve?.length) return analysis.structure.manaCurve;
    const cardCmcs = (analysis.scores || []).map((score) => Math.floor(findCard(cardMap, score.name)?.cmc ?? 0));
    const maxCmc = Math.max(0, ...cardCmcs);
    const buckets = {};
    for (let i = 0; i <= maxCmc; i++) {
      buckets[String(i)] = { cmc: String(i), total: 0 };
      for (const colorKey of MANA_CURVE_COLOR_ORDER) buckets[String(i)][colorKey] = 0;
    }
    for (const score of analysis.scores || []) {
      const card = findCard(cardMap, score.name);
      const cmc = String(Math.floor(card?.cmc ?? 0));
      const colorKeys = getManaColorKeys(card);
      for (const colorKey of colorKeys) buckets[cmc][colorKey] += 1;
      buckets[cmc].total += 1;
    }
    return Object.values(buckets);
  }, [analysis.structure?.manaCurve, analysis.scores, cardMap]);

  return (
    <main className="min-w-0 p-3 pb-32 sm:p-5 sm:pb-32 md:pb-5 lg:p-8">
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-neutral-500">Commander Analysis</div>
              <h2 className="mt-1 text-xl font-bold leading-tight text-neutral-50 sm:text-2xl">{names(deck.commanders)}</h2>
              {deck.hasValidPartner && deck.commanders[1] && <div className="mt-1 text-sm text-neutral-400">Partner: {deck.commanders[1].name}</div>}
              {deck.hasValidCompanion && deck.companions.length > 0 && <div className="mt-1 text-sm text-neutral-400">Companion: {names(deck.companions)}</div>}
              {coreCards.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {coreCards.map((card) => (
                    <button
                      key={card}
                      type="button"
                      onClick={() => toggleCoreCard(card)}
                      className="rounded border border-amber-700 bg-amber-950/40 px-2 py-1 text-xs text-amber-200 hover:border-amber-400"
                    >
                      Core: {card}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <SummaryStrip analysis={analysis} deck={deck} analysisReady={analysisReady} />
          {cardDataLoading && (
            <div className="rounded-lg border border-sky-900 bg-sky-950/30 p-3 text-sm text-sky-100">
              <div className="font-semibold">Scryfall data loading</div>
              <div className="mt-1 text-sky-200/80">{cardDataProgress || "Fetching card data..."}</div>
            </div>
          )}
          {notFound.length > 0 && (
            <div className="rounded-lg border border-amber-900 bg-amber-950/30 p-3 text-sm text-amber-100">
              <div className="font-semibold">Unidentified cards</div>
              <div className="mt-1 text-amber-200/80">These cards could not be matched after multiple Scryfall lookup attempts:</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {notFound.map((name) => (
                  <span key={name} className="rounded border border-amber-800 bg-neutral-950/60 px-2 py-1 text-xs">{name}</span>
                ))}
              </div>
            </div>
          )}
        </header>

        <nav className="sticky top-0 z-20 -mx-3 hidden gap-2 overflow-x-auto border-b border-neutral-800 bg-neutral-950/95 px-3 py-2 backdrop-blur sm:-mx-5 sm:px-5 md:flex lg:-mx-8 lg:px-8">
          {TABS.map((tab) => (
            <TabButton key={tab.id} tab={tab} activeTab={activeTab} setActiveTab={setActiveTab} />
          ))}
        </nav>

        {!analysisReady ? (
          <CalculatingAnalysisPanel />
        ) : (
          <>
            {activeTab === "scorecard" && <ScorecardTab analysis={analysis} settings={analysisSettings} setSettings={setAnalysisSettings} setActiveTab={setActiveTab} analysisReady={analysisReady} />}
            {activeTab === "overview" && <OverviewTab analysis={analysis} deck={deck} />}
            {activeTab === "structure" && <StructureTab analysis={analysis} />}
            {activeTab === "power" && <PowerTab analysis={analysis} analysisReady={analysisReady} />}
            {activeTab === "mana" && <ManaTab analysis={analysis} pipData={pipData} cmcBuckets={cmcBuckets} />}
            {activeTab === "cards" && (
              <CardsTab
                analysis={analysis}
                cardMap={cardMap}
                coreCards={coreCards}
                toggleCoreCard={toggleCoreCard}
                roleFilter={roleFilter}
                setRoleFilter={setRoleFilter}
                sortCol={sortCol}
                sortDir={sortDir}
                setSortCol={setSortCol}
                setSortDir={setSortDir}
                analysisReady={analysisReady}
              />
            )}
            {activeTab === "mulligan" && <MulliganTab analysis={analysis} deck={deck} cardMap={cardMap} coreCards={coreCards} />}
            {activeTab === "cuts" && <CutsTab analysis={analysis} cardMap={cardMap} analysisReady={analysisReady} />}
            {activeTab === "upgrades" && <UpgradesTab analysis={analysis} analysisReady={analysisReady} />}
            {activeTab === "debug" && <DebugTab analysis={analysis} deck={deck} cardMap={cardMap} notFound={notFound} />}
          </>
        )}
      </div>
      <MobileTabBar activeTab={activeTab} setActiveTab={setActiveTab} />
    </main>
  );
}

export default function App() {
  const [cmdInput, setCmdInput] = useState("");
  const [companionInput, setCompanionInput] = useState("");
  const [deckInput, setDeckInput] = useState("");
  const [moxfieldUrl, setMoxfieldUrl] = useState("");
  const [remoteAnalysis, setRemoteAnalysis] = useState(null);
  const [deckModel, setDeckModel] = useState(null);
  const [cardMap, setCardMap] = useState({});
  const [notFound, setNotFound] = useState([]);
  const [analysisSettings, setAnalysisSettings] = useState(DEFAULT_ANALYSIS_SETTINGS);
  const [coreCards, setCoreCards] = useState([]);
  const [sidePanelOpen, setSidePanelOpen] = useState(true);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [cardDataLoading, setCardDataLoading] = useState(false);
  const [cardDataProgress, setCardDataProgress] = useState("");
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState("scorecard");
  const lastAutoImportRef = useRef("");
  const importInFlightRef = useRef("");
  const analysisRunIdRef = useRef(0);

  const draftDeck = useMemo(() => {
    if (!deckInput.trim()) return null;
    return parseDecklist(deckInput, { commanderInput: cmdInput, companionInput });
  }, [deckInput, cmdInput, companionInput]);

  const analysis = useMemo(() => {
    if (!deckModel) return null;
    const localAnalysis = buildLocalAnalysis(deckModel, cardMap, { analysisSettings, coreCards });
    return mergeAnalysis(remoteAnalysis, localAnalysis);
  }, [deckModel, cardMap, remoteAnalysis, analysisSettings, coreCards]);

  const toggleCoreCard = (name) => {
    setCoreCards((current) => {
      const normalized = normalizeName(name);
      if (current.some((card) => normalizeName(card) === normalized)) {
        return current.filter((card) => normalizeName(card) !== normalized);
      }
      return [...current, name];
    });
  };

  const analyzeDeckValues = useCallback(async ({ deckText = deckInput, commanderText = cmdInput, companionText = companionInput } = {}) => {
    if (!deckText.trim()) throw new Error("Please paste a decklist.");

    const runId = analysisRunIdRef.current + 1;
    analysisRunIdRef.current = runId;
    setRemoteAnalysis(null);
    setDeckModel(null);
    setNotFound([]);
    setCardDataLoading(false);
    setCardDataProgress("");

    const parsedDeck = parseDecklist(deckText, { commanderInput: commanderText, companionInput: companionText });
    if (!parsedDeck.commanders.length) throw new Error("Could not identify a commander.");
    if (!parsedDeck.main.length) throw new Error("No main-deck cards parsed.");

    const allNames = deckLookupNames(parsedDeck);
    const seedResults = seedScryfallResults(allNames);
    const seededDeck = validateCommandZone(parsedDeck, seedResults, findCard, getCardText);

    setCardMap(seedResults);
    setDeckModel(seededDeck);
    setCoreCards((current) => current.filter((name) => seededDeck.main.some((entry) => normalizeName(entry.name) === normalizeName(name))));
    setActiveTab("scorecard");
    setSidePanelOpen(false);
    setCardDataLoading(true);
    setCardDataProgress(`Loading card data for ${allNames.length} unique cards...`);

    void (async () => {
      try {
        const scryfall = await fetchScryfall(allNames, (message) => {
          if (analysisRunIdRef.current === runId) setCardDataProgress(message);
        });
        if (analysisRunIdRef.current !== runId) return;

        const validatedDeck = validateCommandZone(parsedDeck, scryfall.results, findCard, getCardText);
        setCardMap(scryfall.results);
        setNotFound(scryfall.notFound);
        setDeckModel(validatedDeck);
        setCoreCards((current) => current.filter((name) => validatedDeck.main.some((entry) => normalizeName(entry.name) === normalizeName(name))));
        setCardDataProgress(scryfall.notFound.length
          ? `Loaded card data with ${scryfall.notFound.length} unmatched card${scryfall.notFound.length === 1 ? "" : "s"}.`
          : `Loaded card data for ${allNames.length} unique cards.`);

        const nextRemoteAnalysis = await runRemoteAnalysis(buildAnalysisPrompt(validatedDeck, scryfall.results));
        if (analysisRunIdRef.current === runId) setRemoteAnalysis(nextRemoteAnalysis);
      } catch (fetchError) {
        console.warn("Scryfall enrichment failed:", fetchError);
        if (analysisRunIdRef.current === runId) {
          setCardDataProgress("Scryfall card data unavailable; showing preliminary analysis.");
        }
      } finally {
        if (analysisRunIdRef.current === runId) setCardDataLoading(false);
      }
    })();
  }, [cmdInput, companionInput, deckInput]);

  const importMoxfieldUrl = useCallback(async (inputUrl, options = {}) => {
    const targetUrl = String(inputUrl || "").trim();
    if (!targetUrl || importInFlightRef.current === targetUrl) return;
    importInFlightRef.current = targetUrl;
    lastAutoImportRef.current = targetUrl;
    setLoading(true);
    setError(null);
    setMoxfieldUrl(targetUrl);
    try {
      setProgress(options.auto ? "Importing Moxfield deck..." : "Fetching deck...");

      const res = await fetch(`/api/import/moxfield?url=${encodeURIComponent(targetUrl)}`);
      const data = await res.json();
      if (!res.ok || data.error) {
        const detail = data.details?.length ? ` ${data.details.join(" ")}` : "";
        throw new Error(`${data.error || "Moxfield import failed."}${detail}`);
      }

      const importedCommanderInput = data.commanders?.length ? data.commanders.join(" + ") : cmdInput;
      const importedCompanionInput = data.companions?.length ? data.companions[0] : companionInput;
      const importedDeckText = data.deckText || "";

      if (data.commanders?.length) setCmdInput(importedCommanderInput);
      if (data.companions?.length) setCompanionInput(importedCompanionInput);

      setDeckInput(importedDeckText);
      setProgress("Analyzing imported deck...");
      await analyzeDeckValues({
        deckText: importedDeckText,
        commanderText: importedCommanderInput,
        companionText: importedCompanionInput,
      });
      setSidePanelOpen(false);
    } catch (importError) {
      setError(importError.message);
    } finally {
      importInFlightRef.current = "";
      setLoading(false);
      setProgress("");
    }
  }, [analyzeDeckValues, cmdInput, companionInput]);

  const handleMoxfieldImport = useCallback(() => {
    return importMoxfieldUrl(moxfieldUrl);
  }, [importMoxfieldUrl, moxfieldUrl]);

  const handleMoxfieldPaste = useCallback((event) => {
    const url = extractMoxfieldDeckUrl(event.clipboardData?.getData("text") || "");
    if (!url) return;
    event.preventDefault();
    lastAutoImportRef.current = url;
    importMoxfieldUrl(url, { auto: true });
  }, [importMoxfieldUrl]);

  useEffect(() => {
    const url = extractMoxfieldDeckUrl(moxfieldUrl);
    if (!url || url !== moxfieldUrl.trim() || loading || lastAutoImportRef.current === url) return undefined;
    const timer = window.setTimeout(() => {
      lastAutoImportRef.current = url;
      importMoxfieldUrl(url, { auto: true });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [importMoxfieldUrl, loading, moxfieldUrl]);

  return (
    <div className={`relative min-h-screen bg-neutral-950 text-neutral-100 ${sidePanelOpen ? "lg:grid lg:grid-cols-[320px_minmax(0,1fr)]" : ""}`}>
      <button
        type="button"
        onClick={() => setSidePanelOpen((open) => !open)}
        aria-label={sidePanelOpen ? "Close import and review" : "Open import and review"}
        title={sidePanelOpen ? "Close import and review" : "Open import and review"}
        className="absolute left-2 top-2 z-40 inline-flex h-10 w-10 flex-col items-center justify-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-900 text-neutral-100 shadow-lg hover:border-amber-500"
      >
        <span className="h-0.5 w-5 rounded bg-current" />
        <span className="h-0.5 w-5 rounded bg-current" />
        <span className="h-0.5 w-5 rounded bg-current" />
      </button>
      <InputPanel
        error={error}
        hasAnalysis={Boolean(analysis)}
        moxfieldUrl={moxfieldUrl}
        draftDeck={draftDeck}
        loading={loading}
        progress={progress}
        sidePanelOpen={sidePanelOpen}
        onImport={handleMoxfieldImport}
        onMoxfieldPaste={handleMoxfieldPaste}
        setMoxfieldUrl={setMoxfieldUrl}
      />
      {analysis && deckModel
        ? <Dashboard analysis={analysis} deck={deckModel} cardMap={cardMap} notFound={notFound} cardDataLoading={cardDataLoading} cardDataProgress={cardDataProgress} activeTab={activeTab} setActiveTab={setActiveTab} analysisSettings={analysisSettings} setAnalysisSettings={setAnalysisSettings} coreCards={coreCards} toggleCoreCard={toggleCoreCard} />
        : <EmptyWorkspace draftDeck={draftDeck} sidePanelOpen={sidePanelOpen} />}
    </div>
  );
}
