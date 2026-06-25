"use client";

import { Fragment, useMemo, useState } from "react";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { COLOR_HEX, COLOR_LABEL, MANA_CURVE_COLOR_ORDER, ROLE_LABELS, findCard, formatManaSymbols, formatTextSymbols, getCardText, getManaCost, getManaColorKeys, getRoleKeys, normalizeName } from "./lib/cardUtils.mjs";
import { DEFAULT_ANALYSIS_SETTINGS, buildAnalysisPrompt, buildLocalAnalysis, extractJSON, mergeAnalysis, resolveAnalysisSettings } from "./lib/deckAnalysis.mjs";
import { deckLookupNames, parseDecklist, validateCommandZone } from "./lib/deckParser.mjs";
import { fetchScryfall } from "./lib/scryfall.mjs";

const TABS = [
  { id: "scorecard", label: "Scorecard" },
  { id: "overview", label: "Overview" },
  { id: "structure", label: "Structure" },
  { id: "power", label: "Power" },
  { id: "mana", label: "Mana" },
  { id: "cards", label: "Cards" },
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
  const toneClass = {
    neutral: "border-neutral-800 bg-neutral-900",
    good: "border-emerald-900 bg-emerald-950/40",
    warn: "border-amber-900 bg-amber-950/40",
    bad: "border-rose-900 bg-rose-950/40",
  }[tone];

  return (
    <div className={`rounded-lg border px-3 py-2 ${toneClass}`}>
      <div className="text-[11px] uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="mt-1 text-lg font-semibold leading-tight text-neutral-50 sm:text-xl">{value ?? "-"}</div>
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

function ManaCostDisplay({ card }) {
  const symbols = formatManaSymbols(getManaCost(card));
  return (
    <span className="inline-flex min-h-7 items-center rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm leading-none text-neutral-100">
      {symbols || "No cost"}
    </span>
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

function toneForScore(score) {
  if (score >= 70) return "good";
  if (score >= 50) return "warn";
  return "bad";
}

function settingValue(settings, key) {
  return settings?.[key] ?? DEFAULT_ANALYSIS_SETTINGS[key];
}

function FindingCard({ finding }) {
  return (
    <div className={`rounded-lg border p-3 text-sm ${statusClasses(finding.severity)}`}>
      <div className="font-semibold">{finding.label}</div>
      <div className="mt-1 text-neutral-300">{finding.detail}</div>
      <div className="mt-2 text-xs uppercase tracking-wide text-neutral-500">{finding.action}</div>
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
  cmdInput,
  companionInput,
  deckInput,
  error,
  moxfieldUrl,
  draftDeck,
  loading,
  progress,
  onAnalyze,
  onImport,
  setCmdInput,
  setCompanionInput,
  setDeckInput,
  setMoxfieldUrl,
  showTitle = true,
}) {
  const useFirst = () => draftDeck?.firstCardCandidate && setCmdInput(draftDeck.firstCardCandidate);
  const useBottom = () => draftDeck?.bottomCommandCandidates?.length && setCmdInput(draftDeck.bottomCommandCandidates.join(" + "));

  return (
    <div>
      {showTitle && (
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-amber-400">MTG Commander</div>
          <h1 className="mt-1 text-2xl font-bold text-neutral-50">Deck Analyzer</h1>
        </div>
      )}

      <div className={`${showTitle ? "mt-5" : "mt-3"} space-y-3`}>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          <input
            value={moxfieldUrl}
            onChange={(event) => setMoxfieldUrl(event.target.value)}
            placeholder="Moxfield URL"
            className="min-h-11 min-w-0 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-base text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-amber-500 sm:text-sm"
          />
          <button type="button" onClick={onImport} className="min-h-11 rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm font-semibold text-neutral-100 hover:border-amber-500">
            Import
          </button>
        </div>

        <label className="block">
          <span className="text-[11px] uppercase tracking-wide text-neutral-500">Commander Override</span>
          <input
            value={cmdInput}
            onChange={(event) => setCmdInput(event.target.value)}
            placeholder="Kykar, Wind's Fury"
            className="mt-1 min-h-11 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-base text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-amber-500 sm:text-sm"
          />
        </label>

        <label className="block">
          <span className="text-[11px] uppercase tracking-wide text-neutral-500">Companion Override</span>
          <input
            value={companionInput}
            onChange={(event) => setCompanionInput(event.target.value)}
            placeholder="Keruga, the Macrosage"
            className="mt-1 min-h-11 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-base text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-amber-500 sm:text-sm"
          />
        </label>

        <label className="block">
          <span className="text-[11px] uppercase tracking-wide text-neutral-500">Decklist</span>
          <textarea
            value={deckInput}
            onChange={(event) => setDeckInput(event.target.value)}
            placeholder={"1 Sol Ring\n1 Arcane Signet\n1 Windfall\n\n1 Kykar, Wind's Fury"}
            className="mt-1 min-h-[280px] w-full resize-y rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-3 font-mono text-base text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-amber-500 sm:min-h-[360px] sm:text-sm"
            spellCheck={false}
          />
        </label>

        <IdentityReview deck={draftDeck} onUseFirst={useFirst} onUseBottom={useBottom} />

        {error && <div className="rounded-lg border border-rose-900 bg-rose-950/40 p-3 text-sm text-rose-200">{error}</div>}
        {loading && <div className="rounded-lg border border-amber-900 bg-amber-950/30 p-3 text-sm text-amber-200">{progress || "Analyzing..."}</div>}

        <button
          type="button"
          onClick={onAnalyze}
          disabled={loading}
          className="min-h-12 w-full rounded-lg bg-amber-500 px-4 py-3 text-sm font-bold text-neutral-950 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400"
        >
          Analyze Deck
        </button>
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
                <div className="text-[11px] uppercase tracking-[0.18em] text-amber-400">Deck input</div>
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

function EmptyWorkspace({ draftDeck }) {
  return (
    <main className="p-3 sm:p-5 lg:p-8">
      <div className="mx-auto max-w-6xl">
        <div className={panelClass("p-5")}>
          <div className="text-[11px] uppercase tracking-wide text-neutral-500">Ready</div>
          <h2 className="mt-2 text-2xl font-semibold text-neutral-50">Review the detected identity, then analyze.</h2>
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

function SummaryStrip({ analysis, deck }) {
  const bracket = analysis.bracket;
  const urgentFindings = (analysis.priorityFindings || []).filter((finding) => finding.severity === "critical" || finding.severity === "warning").length;
  const score = (key) => analysis.scorecard?.find((item) => item.key === key);
  return (
    <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-4 xl:grid-cols-9">
      <Metric label="Overall" value={analysis.overallScore ?? "-"} sub="Score" tone={toneForScore(analysis.overallScore || 0)} />
      <Metric label="Bracket" value={bracket?.rangeLabel || "-"} sub={bracket?.label} tone={bracket?.bracket >= 4 ? "bad" : bracket?.bracket === 3 ? "warn" : "good"} />
      <Metric label="Lands" value={analysis.stats?.landCount} tone={analysis.stats?.landCount >= 36 && analysis.stats?.landCount <= 40 ? "good" : "warn"} />
      <Metric label="Ramp" value={analysis.stats?.rampCount} tone={analysis.stats?.rampCount >= 8 ? "good" : "bad"} />
      <Metric label="Flow" value={analysis.structure?.cardFlowProfile?.total ?? "-"} tone={analysis.structure?.cardFlowProfile?.status === "good" ? "good" : analysis.structure?.cardFlowProfile?.status === "bad" ? "bad" : "warn"} />
      <Metric label="Removal" value={analysis.stats?.removalCount} tone={analysis.stats?.removalCount >= 3 ? "good" : "warn"} />
      <Metric label="Core Syn" value={score("synergy")?.score ?? "-"} tone={toneForScore(score("synergy")?.score || 0)} />
      <Metric label="Win Plan" value={score("winPlan")?.score ?? "-"} tone={toneForScore(score("winPlan")?.score || 0)} />
      <Metric label="Findings" value={urgentFindings} tone={urgentFindings ? "warn" : "good"} sub="Urgent" />
    </div>
  );
}

const SETTING_GROUPS = [
  { key: "landsMin", label: "Min Lands", min: 30, max: 44, step: 1 },
  { key: "landsMax", label: "Max Lands", min: 32, max: 46, step: 1 },
  { key: "rampTarget", label: "Ramp", min: 4, max: 18, step: 1 },
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
          <div className="text-[11px] uppercase tracking-wide text-neutral-500">Analysis Settings</div>
          <div className="mt-1 text-sm text-neutral-400">Adjust the targets used by the local scorecard.</div>
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

function ScorecardPanel({ item }) {
  return (
    <article className={`rounded-lg border p-4 ${statusClasses(item.status)}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">{item.label}</div>
          <div className="mt-1 text-xs uppercase tracking-wide text-neutral-500">{item.ignored ? "Ignored in overall score" : item.grade}</div>
        </div>
        <div className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1 font-mono text-lg text-neutral-100">{item.score}</div>
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

function ScorecardTab({ analysis, settings, setSettings }) {
  return (
    <div className="space-y-3 sm:space-y-4">
      <section className="grid gap-3 sm:gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <div className={panelClass("p-4 sm:p-5")}>
          <div className="text-[11px] uppercase tracking-wide text-neutral-500">Overall Score</div>
          <div className="mt-2 text-5xl font-bold text-neutral-50">{analysis.overallScore ?? "-"}</div>
          <div className="mt-3 text-sm text-neutral-400">Local score based on your current slider targets, commander, and core identity cards.</div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div className={panelClass("p-4")}>
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">Needs Attention</div>
            <div className="mt-3 space-y-2">
              {(analysis.highlights?.needsAttention || []).map((item) => (
                <div key={item.key} className="flex items-center justify-between rounded border border-neutral-800 bg-neutral-950 px-3 py-2">
                  <span className="text-sm text-neutral-200">{item.label}</span>
                  <span className={`font-mono text-sm ${scoreColor(Math.round((item.score - 50) / 10))}`}>{item.score}</span>
                </div>
              ))}
            </div>
          </div>
          <div className={panelClass("p-4")}>
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">Strengths</div>
            <div className="mt-3 space-y-2">
              {(analysis.highlights?.strengths || []).map((item) => (
                <div key={item.key} className="flex items-center justify-between rounded border border-neutral-800 bg-neutral-950 px-3 py-2">
                  <span className="text-sm text-neutral-200">{item.label}</span>
                  <span className="font-mono text-sm text-emerald-300">{item.score}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <SettingsPanel settings={settings} setSettings={setSettings} />

      <section className="grid gap-3 sm:gap-4 lg:grid-cols-2">
        {(analysis.scorecard || []).map((item) => <ScorecardPanel key={item.key} item={item} />)}
      </section>
    </div>
  );
}

function OverviewTab({ analysis, deck }) {
  const winPlan = analysis.structure?.winPlan;
  return (
    <div className="grid gap-3 sm:gap-4 xl:grid-cols-[1.2fr_0.8fr]">
      <section className={panelClass("p-4 sm:p-5")}>
        <div className="text-[11px] uppercase tracking-wide text-neutral-500">Priority Findings</div>
        <div className="mt-3 grid gap-2 sm:gap-3 md:grid-cols-2">
          {(analysis.priorityFindings || []).map((finding) => (
            <FindingCard key={`${finding.label}-${finding.action}`} finding={finding} />
          ))}
        </div>
      </section>

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

      <section className={panelClass("p-4 sm:p-5")}>
        <div className="text-[11px] uppercase tracking-wide text-neutral-500">Consistency Checks</div>
        <div className="mt-3 grid gap-3">
          {analysis.consistencyFlags.map((flag) => (
            <StatusLine key={flag.text} ok={flag.ok}>{flag.text}</StatusLine>
          ))}
        </div>
      </section>

      <section className={panelClass("p-4 sm:p-5")}>
        <div className="text-[11px] uppercase tracking-wide text-neutral-500">Identity</div>
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
          <div className="text-[11px] uppercase tracking-wide text-neutral-500">Card Type Mix</div>
          <div className="mt-3 space-y-3">
            {(structure.typeMix || []).map((item) => (
              <div key={item.type}>
                <div className="flex justify-between text-sm">
                  <span className="text-neutral-300">{item.type}</span>
                  <span className="text-neutral-500">{item.count} ({item.pct}%)</span>
                </div>
                <MiniBar value={item.pct} max={100} />
              </div>
            ))}
          </div>
        </section>

        <section className={panelClass("p-4 sm:p-5")}>
          <div className="text-[11px] uppercase tracking-wide text-neutral-500">Curve Bands</div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {(structure.curveBands || []).map((band) => (
              <div key={band.key} className="rounded-lg border border-neutral-800 bg-neutral-950 p-3">
                <div className="text-xs text-neutral-500">{band.label}</div>
                <div className="mt-1 text-xl font-semibold text-neutral-100">{band.count}</div>
                <div className="mt-1 text-xs text-neutral-500">MV {band.key}</div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function PowerTab({ analysis }) {
  const bracket = analysis.bracket;
  return (
    <div className="grid gap-3 sm:gap-4 xl:grid-cols-[0.9fr_1.1fr]">
      <section className={panelClass("p-4 sm:p-5")}>
        <div className="text-[11px] uppercase tracking-wide text-neutral-500">Commander Bracket</div>
        <div className="mt-2 text-3xl font-bold text-neutral-50 sm:text-4xl">{bracket.rangeLabel}</div>
        <div className="mt-1 text-sm text-neutral-400">{bracket.label} confidence {Math.round(bracket.confidence * 100)}%</div>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <Metric label="Win Turn" value={`~${bracket.expectedWinTurn}`} />
          <Metric label="Game Changers" value={bracket.gameChangers.length} tone={bracket.gameChangers.length > 3 ? "bad" : bracket.gameChangers.length ? "warn" : "good"} />
        </div>
      </section>

      <section className={panelClass("p-4 sm:p-5")}>
        <div className="text-[11px] uppercase tracking-wide text-neutral-500">Evidence</div>
        <div className="mt-3 space-y-2">
          {bracket.reasons.map((reason) => (
            <StatusLine key={reason} ok={bracket.bracket <= 2}>{reason}</StatusLine>
          ))}
        </div>
      </section>

      <section className={panelClass("p-4 sm:p-5")}>
        <div className="text-[11px] uppercase tracking-wide text-neutral-500">Signals</div>
        <div className="mt-3 space-y-3">
          <details className="rounded-lg border border-neutral-800 bg-neutral-950 p-3" open>
            <summary className="cursor-pointer text-sm font-semibold text-neutral-200">Game Changers</summary>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {bracket.gameChangers.length ? bracket.gameChangers.map((name) => <RoleChip key={name} role={name} />) : <span className="text-sm text-neutral-500">None detected</span>}
            </div>
            <div className="mt-2 text-xs text-neutral-600">{bracket.gameChangerVersion}</div>
          </details>
          <details className="rounded-lg border border-neutral-800 bg-neutral-950 p-3" open>
            <summary className="cursor-pointer text-sm font-semibold text-neutral-200">Speed</summary>
            <div className="mt-3 space-y-1 text-sm text-neutral-400">
              {bracket.speedSignals.length ? bracket.speedSignals.map((signal) => <div key={`${signal.type}-${signal.name}`}>{signal.type}: {signal.name}</div>) : <div>No fast speed cluster detected.</div>}
            </div>
          </details>
        </div>
      </section>

      <section className={panelClass("p-4 sm:p-5")}>
        <div className="text-[11px] uppercase tracking-wide text-neutral-500">Combo Packages</div>
        <div className="mt-3 space-y-3">
          {bracket.comboSignals.length ? bracket.comboSignals.map((combo) => (
            <details key={combo.name} className="rounded-lg border border-neutral-800 bg-neutral-950 p-3" open>
              <summary className="cursor-pointer text-sm font-semibold text-neutral-200">{combo.name}</summary>
              <div className="mt-2 text-sm text-neutral-400">{combo.matches.join(", ")}</div>
            </details>
          )) : <div className="text-sm text-neutral-500">No compact combo package detected.</div>}
          {bracket.upgradeSuggestions.map((suggestion) => (
            <StatusLine key={suggestion} ok={bracket.bracket <= 3}>{suggestion}</StatusLine>
          ))}
        </div>
      </section>
    </div>
  );
}

function ManaTab({ analysis, pipData, cmcBuckets }) {
  return (
    <div className="grid gap-3 sm:gap-4 xl:grid-cols-2">
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
    </div>
  );
}

function CardsTab({ analysis, cardMap, coreCards, toggleCoreCard, roleFilter, setRoleFilter, sortCol, sortDir, setSortCol, setSortDir }) {
  const [expanded, setExpanded] = useState([]);
  const coreSet = useMemo(() => new Set((coreCards || []).map(normalizeName)), [coreCards]);
  const expandedSet = useMemo(() => new Set(expanded), [expanded]);
  const rows = useMemo(() => {
    const filtered = analysis.scores.filter((score) => roleFilter === "all" || score.roles?.includes(roleFilter));
    return [...filtered].sort((a, b) => {
      if (sortCol === "name") return sortDir === "asc" ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name);
      if (sortCol === "score") return sortDir === "asc" ? a.score - b.score : b.score - a.score;
      return 0;
    });
  }, [analysis.scores, roleFilter, sortCol, sortDir]);

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
    <section className={panelClass("overflow-hidden")}>
      <div className="flex flex-col gap-3 border-b border-neutral-800 p-3 sm:p-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-neutral-500">Card Scores</div>
          <div className="text-sm text-neutral-400">{rows.length} visible cards</div>
        </div>
        <div className="space-y-2">
          <div className="flex gap-2">
            <button type="button" onClick={() => setExpanded(rows.map((row) => row.name))} className="min-h-9 rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:border-amber-500">
              Expand all
            </button>
            <button type="button" onClick={() => setExpanded([])} className="min-h-9 rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:border-amber-500">
              Compact all
            </button>
          </div>
          <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 sm:mx-0 sm:flex-wrap sm:px-0 sm:pb-0">
            {ROLE_FILTERS.map((filter) => (
              <button
                type="button"
                key={filter.id}
                onClick={() => setRoleFilter(filter.id)}
                className={`min-h-9 shrink-0 rounded border px-2 py-1 text-xs ${roleFilter === filter.id ? "border-amber-500 bg-amber-500 text-neutral-950" : "border-neutral-700 text-neutral-300 hover:border-amber-500"}`}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="divide-y divide-neutral-800 md:hidden">
        {rows.map((score) => {
          const card = findCard(cardMap, score.name);
          const roles = score.roles?.length ? score.roles : getRoleKeys(card);
          const isExpanded = expandedSet.has(score.name);
          const isCore = coreSet.has(normalizeName(score.name));
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
                  <div className={`shrink-0 rounded border border-neutral-700 px-2 py-1 font-mono text-sm ${scoreColor(score.score)}`}>
                    {score.score > 0 ? "+" : ""}{score.score}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1">
                  {roles.map((role) => <RoleChip key={role} role={role} />)}
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
                  <div className="text-xs uppercase tracking-wide text-neutral-500">Type</div>
                  <div className="mt-1 text-sm text-neutral-200">{card?.type_line || "Unknown"}</div>
                  <div className="mt-3 text-xs uppercase tracking-wide text-neutral-500">Card Text</div>
                  <div className="mt-1 text-sm leading-6 text-neutral-300">{formatTextSymbols(getCardText(card)) || "No text available."}</div>
                </div>
              )}
            </article>
          );
        })}
      </div>

      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[760px] text-sm">
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
              <th className="px-4 py-3">Why</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((score) => {
              const card = findCard(cardMap, score.name);
              const roles = score.roles?.length ? score.roles : getRoleKeys(card);
              const isExpanded = expandedSet.has(score.name);
              const isCore = coreSet.has(normalizeName(score.name));
              return (
                <Fragment key={score.name}>
                  <tr onClick={() => toggleExpanded(score.name)} className="cursor-pointer border-t border-neutral-800 bg-neutral-900/70 hover:bg-neutral-900">
                    <td className="px-4 py-3 text-neutral-500">
                      {isExpanded ? "-" : "+"}
                    </td>
                    <td className="px-4 py-3 font-medium text-neutral-100">
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
                    <td className={`px-4 py-3 font-mono ${scoreColor(score.score)}`}>{score.score > 0 ? "+" : ""}{score.score}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {roles.map((role) => <RoleChip key={role} role={role} />)}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-neutral-400">{card?.cmc ?? "-"}</td>
                    <td className="px-4 py-3 text-neutral-400">{score.note || "No special signal"}</td>
                  </tr>
                  {isExpanded && (
                    <tr className="border-t border-neutral-800 bg-neutral-950">
                      <td></td>
                      <td colSpan={5} className="px-4 py-4">
                        <div className="grid gap-3 lg:grid-cols-[220px_1fr]">
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
  );
}

function UpgradesTab({ analysis }) {
  return (
    <div className="grid gap-3 sm:gap-4 xl:grid-cols-2">
      <section className={panelClass("p-4 sm:p-5")}>
        <div className="text-[11px] uppercase tracking-wide text-neutral-500">Recommended Swaps</div>
        <div className="mt-3 space-y-3">
          {analysis.upgrades.map((upgrade) => (
            <div key={`${upgrade.cut}-${upgrade.add}`} className="rounded-lg border border-neutral-800 bg-neutral-950 p-3 sm:p-4">
              <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                <div>
                  <div className="text-xs text-neutral-500">Cut</div>
                  <div className="font-semibold text-rose-200">{upgrade.cut}</div>
                  <div className={`text-xs font-mono ${scoreColor(upgrade.cutScore)}`}>{upgrade.cutScore > 0 ? "+" : ""}{upgrade.cutScore}</div>
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

function DebugTab({ analysis, deck, cardMap, notFound }) {
  return (
    <section className={panelClass("p-4 sm:p-5")}>
      <div className="text-[11px] uppercase tracking-wide text-neutral-500">Debug</div>
      <pre className="mt-3 max-h-[640px] overflow-auto rounded-lg bg-neutral-950 p-4 text-xs leading-5 text-neutral-300">
        {JSON.stringify({ deck, scorecard: analysis.scorecard, settings: analysis.settings, coreCards: analysis.coreCards, structure: analysis.structure, priorityFindings: analysis.priorityFindings, bracket: analysis.bracket, notFound, indexedCards: Object.keys(cardMap).length }, null, 2)}
      </pre>
    </section>
  );
}

function Dashboard({ analysis, deck, cardMap, notFound, activeTab, setActiveTab, analysisSettings, setAnalysisSettings, coreCards, toggleCoreCard }) {
  const [roleFilter, setRoleFilter] = useState("all");
  const [sortCol, setSortCol] = useState("score");
  const [sortDir, setSortDir] = useState("asc");

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
    <main className="min-w-0 p-3 sm:p-5 lg:p-8">
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
          <SummaryStrip analysis={analysis} deck={deck} />
        </header>

        <nav className="sticky top-0 z-20 -mx-3 flex gap-2 overflow-x-auto border-b border-neutral-800 bg-neutral-950/95 px-3 py-2 backdrop-blur sm:-mx-5 sm:px-5 lg:-mx-8 lg:px-8">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`min-h-10 shrink-0 rounded-lg px-3 py-2 text-sm font-semibold ${activeTab === tab.id ? "bg-amber-500 text-neutral-950" : "text-neutral-400 hover:bg-neutral-900 hover:text-neutral-100"}`}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        {activeTab === "scorecard" && <ScorecardTab analysis={analysis} settings={analysisSettings} setSettings={setAnalysisSettings} />}
        {activeTab === "overview" && <OverviewTab analysis={analysis} deck={deck} />}
        {activeTab === "structure" && <StructureTab analysis={analysis} />}
        {activeTab === "power" && <PowerTab analysis={analysis} />}
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
          />
        )}
        {activeTab === "upgrades" && <UpgradesTab analysis={analysis} />}
        {activeTab === "debug" && <DebugTab analysis={analysis} deck={deck} cardMap={cardMap} notFound={notFound} />}
      </div>
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
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState("scorecard");

  const draftDeck = useMemo(() => {
    if (!deckInput.trim()) return null;
    return parseDecklist(deckInput, { commanderInput: cmdInput, companionInput });
  }, [deckInput, cmdInput, companionInput]);

  const analysis = useMemo(() => {
    if (!deckModel || !Object.keys(cardMap).length) return null;
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

  async function handleMoxfieldImport() {
    if (!moxfieldUrl.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const match = moxfieldUrl.match(/moxfield\.com\/decks\/([a-zA-Z0-9_-]+)/);
      if (!match) throw new Error("Invalid Moxfield URL.");
      setProgress("Fetching Moxfield deck...");

      const res = await fetch(`https://api2.moxfield.com/v3/decks/all/${match[1]}`);
      if (!res.ok) throw new Error("Moxfield import failed.");
      const data = await res.json();

      const processBoard = (board) => Object.values(board || {})
        .map((card) => `${card.quantity} ${card.card.name}`)
        .join("\n");
      const commanders = Object.values(data.boards?.commanders?.cards || {}).map((card) => card.card.name);
      const companions = Object.values(data.boards?.companions?.cards || {}).map((card) => card.card.name);
      const mainboard = processBoard(data.boards?.mainboard?.cards);
      const sideboard = processBoard(data.boards?.sideboard?.cards);
      const considering = processBoard(data.boards?.maybeboard?.cards);

      if (commanders.length) setCmdInput(commanders.join(" + "));
      if (companions.length) setCompanionInput(companions[0]);

      setDeckInput([
        mainboard,
        sideboard ? `Sideboard:\n${sideboard}` : "",
        considering ? `Considering:\n${considering}` : "",
      ].filter(Boolean).join("\n\n"));
      setSidePanelOpen(false);
    } catch (importError) {
      setError(importError.message);
    } finally {
      setLoading(false);
      setProgress("");
    }
  }

  async function runAnalysis() {
    if (!deckInput.trim()) {
      setError("Please paste a decklist.");
      return;
    }

    setLoading(true);
    setError(null);
    setRemoteAnalysis(null);
    setDeckModel(null);
    setNotFound([]);

    try {
      const parsedDeck = parseDecklist(deckInput, { commanderInput: cmdInput, companionInput });
      if (!parsedDeck.commanders.length) throw new Error("Could not identify a commander.");
      if (!parsedDeck.main.length) throw new Error("No main-deck cards parsed.");

      const allNames = deckLookupNames(parsedDeck);
      const scryfall = await fetchScryfall(allNames, setProgress);
      const validatedDeck = validateCommandZone(parsedDeck, scryfall.results, findCard, getCardText);

      setCardMap(scryfall.results);
      setNotFound(scryfall.notFound);
      setDeckModel(validatedDeck);
      setCoreCards((current) => current.filter((name) => validatedDeck.main.some((entry) => normalizeName(entry.name) === normalizeName(name))));

      setProgress(`Running deck analysis for ${validatedDeck.cardCount} main-deck cards...`);
      const remoteAnalysis = await runRemoteAnalysis(buildAnalysisPrompt(validatedDeck, scryfall.results));
      setRemoteAnalysis(remoteAnalysis);
      setActiveTab("scorecard");
    } catch (analysisError) {
      setError(analysisError.message);
    } finally {
      setLoading(false);
      setProgress("");
    }
  }

  return (
    <div className={`min-h-screen bg-neutral-950 text-neutral-100 ${sidePanelOpen ? "lg:grid lg:grid-cols-[380px_minmax(0,1fr)]" : ""}`}>
      <button
        type="button"
        onClick={() => setSidePanelOpen((open) => !open)}
        className="fixed left-2 top-2 z-40 min-h-10 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs font-bold text-neutral-100 shadow-lg hover:border-amber-500"
      >
        {sidePanelOpen ? "Close import" : "Open import"}
      </button>
      <InputPanel
        cmdInput={cmdInput}
        companionInput={companionInput}
        deckInput={deckInput}
        error={error}
        hasAnalysis={Boolean(analysis)}
        moxfieldUrl={moxfieldUrl}
        draftDeck={draftDeck}
        loading={loading}
        progress={progress}
        sidePanelOpen={sidePanelOpen}
        onAnalyze={runAnalysis}
        onImport={handleMoxfieldImport}
        setCmdInput={setCmdInput}
        setCompanionInput={setCompanionInput}
        setDeckInput={setDeckInput}
        setMoxfieldUrl={setMoxfieldUrl}
      />
      {analysis && deckModel
        ? <Dashboard analysis={analysis} deck={deckModel} cardMap={cardMap} notFound={notFound} activeTab={activeTab} setActiveTab={setActiveTab} analysisSettings={analysisSettings} setAnalysisSettings={setAnalysisSettings} coreCards={coreCards} toggleCoreCard={toggleCoreCard} />
        : <EmptyWorkspace draftDeck={draftDeck} />}
    </div>
  );
}
