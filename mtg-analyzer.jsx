"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { COLOR_HEX, COLOR_LABEL, MANA_CURVE_COLOR_ORDER, ROLE_LABELS, findCard, formatTextSymbols, getCardText, getManaCost, getManaColorKeys, getRoleKeys, isLand, normalizeName } from "./lib/cardUtils.mjs";
import { DEFAULT_ANALYSIS_SETTINGS, buildAnalysisPrompt, buildLocalAnalysis, extractJSON, mergeAnalysis, resolveAnalysisSettings } from "./lib/deckAnalysis.mjs";
import { addCandidateLandsToMain, addCandidateToMain, applyConstructionSession, chooseVersusCandidate, chooseVersusComparison, constructionCounts, createConstructionSession, drawConstructionCandidates, moveConstructionStack, moveMainToCandidatePool, restartConstructionSession, setAsideCandidates, setAsideVersusCandidate, setAsideVersusComparison, setAsideVersusPair, undoConstructionAction } from "./lib/deckConstruction.mjs";
import { buildTierRows } from "./lib/deckTiers.mjs";
import { extractSupportedDeckUrl } from "./lib/deckSource.mjs";
import { deckLookupNames, parseDecklist, validateCommandZone } from "./lib/deckParser.mjs";
import { addCardToOpeningHand, analyzeOpeningHand, drawOpeningHand, removeCardFromOpeningHand } from "./lib/openingHand.mjs";
import { fetchScryfall, seedScryfallResults } from "./lib/scryfall.mjs";

const TAB_GROUPS = [
  {
    id: "analysis",
    label: "Analysis",
    tabs: [
      { id: "scorecard", label: "Home" },
      { id: "overview", label: "Game Plan" },
      { id: "structure", label: "Coverage" },
      { id: "power", label: "Power" },
      { id: "mana", label: "Mana" },
      { id: "cards", label: "Cards" },
    ],
  },
  {
    id: "build",
    label: "Build",
    tabs: [
      { id: "construct", label: "Build" },
      { id: "cuts", label: "Cuts" },
      { id: "upgrades", label: "Upgrades" },
    ],
  },
  {
    id: "test",
    label: "Test",
    tabs: [{ id: "mulligan", label: "Mulligan" }],
  },
];

const SHOW_DEBUG = process.env.NODE_ENV === "development";
const TABS = [
  ...TAB_GROUPS.flatMap((group) => group.tabs),
  ...(SHOW_DEBUG ? [{ id: "debug", label: "Debug" }] : []),
];

const TAB_ICON_PATHS = {
  scorecard: ["M3 11.5 12 4l9 7.5", "M5 10v10h14V10", "M9 20v-6h6v6"],
  overview: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z", "m16 8-2.5 5.5L8 16l2.5-5.5L16 8Z"],
  structure: ["M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z", "m9 12 2 2 4-4"],
  power: ["m13 2-9 12h7l-1 8 9-12h-7l1-8Z"],
  mana: ["M12 2s7 8 7 13a7 7 0 0 1-14 0c0-5 7-13 7-13Z"],
  cards: ["M5 4h13a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2V4Z", "M5 7H3v13a2 2 0 0 0 2 2h12v-2"],
  construct: ["M4 4h6v6H4V4Z", "M14 4h6v6h-6V4Z", "M4 14h6v6H4v-6Z", "M17 14v6", "M14 17h6"],
  mulligan: ["M20 7v5h-5", "M4 17v-5h5", "M6.1 9a7 7 0 0 1 11.5-2L20 12", "M17.9 15A7 7 0 0 1 6.4 17L4 12"],
  cuts: ["m3 3 18 18", "m3 21 7.5-7.5", "M7 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z", "M7 17a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"],
  upgrades: ["M4 17 10 11l4 4 6-8", "M15 7h5v5"],
  debug: ["M8 9h8v9a4 4 0 0 1-8 0V9Z", "M9 9V6a3 3 0 0 1 6 0v3", "M4 13h4", "M16 13h4", "M4 17h4", "M16 17h4"],
};

const ROLE_FILTER_GROUPS = [
  {
    label: "Strategy",
    filters: [
      { id: "engine", label: "Engines" },
      { id: "payoff", label: "Payoffs" },
      { id: "finisher", label: "Finishers" },
      { id: "tokenMaker", label: "Tokens" },
      { id: "sacrificeOutlet", label: "Sac Outlets" },
      { id: "costReducer", label: "Reducers" },
      { id: "haste", label: "Haste" },
      { id: "evasion", label: "Evasion" },
      { id: "core", label: "Core" },
    ],
  },
  {
    label: "Interaction",
    filters: [
      { id: "removal", label: "Removal" },
      { id: "boardWipe", label: "Wipes" },
      { id: "protection", label: "Protection" },
      { id: "graveyardHate", label: "Grave Hate" },
      { id: "stax", label: "Stax" },
    ],
  },
  {
    label: "Mana",
    filters: [
      { id: "ramp", label: "Ramp" },
      { id: "manaFixing", label: "Fixing" },
    ],
  },
  {
    label: "Utility",
    filters: [
      { id: "draw", label: "Draw" },
      { id: "tutor", label: "Tutors" },
      { id: "cardSelection", label: "Selection" },
      { id: "recursion", label: "Recursion" },
      { id: "lifeGain", label: "Lifegain" },
      { id: "gameChanger", label: "Game Changers" },
    ],
  },
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

function cardFullPreviewUrl(card) {
  const faceImages = card?.card_faces?.find((face) => face.image_uris)?.image_uris;
  return card?.image_uris?.png
    || card?.image_uris?.large
    || card?.image_uris?.normal
    || faceImages?.png
    || faceImages?.large
    || faceImages?.normal
    || null;
}

function cardOracleText(card) {
  if (card?.oracle_text) return card.oracle_text;
  return (card?.card_faces || [])
    .filter((face) => face.oracle_text)
    .map((face) => `${face.name ? `${face.name}\n` : ""}${face.oracle_text}`)
    .join("\n\n");
}

function CardHoverPreview({ card, name, renderTrigger, anchorClassName = "relative block", clickToToggle = false }) {
  const fullImageUrl = cardFullPreviewUrl(card);
  const oracleText = cardOracleText(card);
  const [open, setOpen] = useState(false);
  const [previewPosition, setPreviewPosition] = useState(null);
  const anchorRef = useRef(null);
  const previewRef = useRef(null);
  const closeTimerRef = useRef(null);

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }, []);

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimerRef.current = window.setTimeout(() => setOpen(false), 120);
  }, [cancelClose]);

  const updatePreviewPosition = useCallback(() => {
    if (typeof window === "undefined") return;
    const anchor = anchorRef.current?.getBoundingClientRect();
    const preview = previewRef.current?.getBoundingClientRect();
    if (!anchor) return;

    const viewportPadding = 12;
    const gap = 12;
    const maxHeight = Math.max(0, window.innerHeight - viewportPadding * 2);
    const width = Math.min(360, Math.max(0, window.innerWidth - viewportPadding * 2));
    const height = Math.min(preview?.height || maxHeight, maxHeight);
    const fitsRight = anchor.right + gap + width <= window.innerWidth - viewportPadding;
    const fitsLeft = anchor.left - gap - width >= viewportPadding;
    const unclampedLeft = fitsRight
      ? anchor.right + gap
      : fitsLeft
        ? anchor.left - gap - width
        : anchor.left + anchor.width / 2 - width / 2;
    const left = Math.max(viewportPadding, Math.min(unclampedLeft, window.innerWidth - width - viewportPadding));
    const unclampedTop = anchor.top + anchor.height / 2 - height / 2;
    const top = Math.max(viewportPadding, Math.min(unclampedTop, window.innerHeight - height - viewportPadding));
    setPreviewPosition({ top, left, width, maxHeight });
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const frame = window.requestAnimationFrame(updatePreviewPosition);
    const handleKeyDown = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("resize", updatePreviewPosition);
    window.addEventListener("scroll", updatePreviewPosition, true);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", updatePreviewPosition);
      window.removeEventListener("scroll", updatePreviewPosition, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, updatePreviewPosition]);

  useEffect(() => () => cancelClose(), [cancelClose]);

  const showDesktopPreview = () => {
    if (!fullImageUrl || typeof window === "undefined") return;
    if (!window.matchMedia("(min-width: 1024px) and (hover: hover) and (pointer: fine)").matches) return;
    cancelClose();
    setOpen(true);
    window.requestAnimationFrame(updatePreviewPosition);
  };

  const togglePreview = () => {
    if (!fullImageUrl) return;
    cancelClose();
    setOpen((current) => !current);
    window.requestAnimationFrame(updatePreviewPosition);
  };

  const preview = (
    <div
      ref={previewRef}
      role="tooltip"
      onMouseEnter={cancelClose}
      onMouseLeave={scheduleClose}
      className="fixed z-50 max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-xl border border-neutral-700 bg-neutral-950 p-2 shadow-2xl shadow-black/70"
      style={previewPosition
        ? { top: previewPosition.top, left: previewPosition.left, width: previewPosition.width, maxHeight: previewPosition.maxHeight }
        : { visibility: "hidden" }}
    >
      {fullImageUrl ? (
        <img src={fullImageUrl} alt={name} className="mx-auto max-h-[62vh] w-full rounded-lg object-contain" onLoad={updatePreviewPosition} />
      ) : (
        <div className="flex aspect-[5/7] items-center justify-center rounded-md border border-neutral-800 bg-neutral-900 p-3 text-center text-xs text-neutral-500">No image available</div>
      )}
      <div className="mt-2 rounded-lg border border-neutral-800 bg-neutral-900/90 p-3">
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-400">Oracle text</div>
        <div className="mt-1 whitespace-pre-line text-sm leading-5 text-neutral-200">{formatTextSymbols(oracleText) || "No oracle text available."}</div>
      </div>
    </div>
  );

  return (
    <>
      <div
        ref={anchorRef}
        className={anchorClassName}
        onMouseEnter={showDesktopPreview}
        onMouseLeave={scheduleClose}
        onFocus={showDesktopPreview}
        onBlur={scheduleClose}
        onClick={clickToToggle ? togglePreview : undefined}
      >
        {renderTrigger(open)}
      </div>
      {open && typeof document !== "undefined" ? createPortal(preview, document.body) : null}
    </>
  );
}

function PreviewableCardImage({ card, name, className, fallbackClassName, wrapperClassName = "block w-full" }) {
  const imageUrl = cardPreviewUrl(card);
  return (
    <CardHoverPreview
      card={card}
      name={name}
      anchorClassName={wrapperClassName}
      renderTrigger={() => imageUrl ? (
        <img src={imageUrl} alt={name} className={className} loading="lazy" />
      ) : (
        <div className={fallbackClassName}>No image available</div>
      )}
    />
  );
}

function CardPreview({ card, name }) {
  return (
    <CardHoverPreview
      card={card}
      name={name}
      clickToToggle
      anchorClassName="group relative inline-flex"
      renderTrigger={(open) => (
        <button
          type="button"
          aria-expanded={open}
          className="rounded border border-neutral-800 bg-neutral-950/60 px-2 py-1 text-xs text-neutral-300 group-hover:border-amber-500 group-hover:text-amber-200"
        >
          {name}
        </button>
      )}
    />
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
  deckUrl,
  draftDeck,
  loading,
  progress,
  onClipboardPaste,
  onImport,
  onDeckPaste,
  setDeckUrl,
  fullPage = false,
  showTitle = true,
  compact = false,
  sidebar = false,
}) {
  return (
    <div className={fullPage ? "w-full rounded-2xl border border-neutral-800 bg-neutral-950/95 p-6 shadow-2xl shadow-black/40 sm:p-10" : compact ? (sidebar ? "rounded-lg border border-neutral-800 bg-neutral-950/95 p-2 shadow-2xl shadow-black/20" : "rounded-lg border border-neutral-800 bg-neutral-950/95 p-3 shadow-2xl shadow-black/20 sm:p-4") : ""}>
      {showTitle && (
        <div className={fullPage ? "text-center" : ""}>
          <div className="text-[11px] uppercase tracking-[0.18em] text-amber-400">MTG Commander</div>
          <h1 className={`${fullPage ? "mt-2 text-4xl sm:text-5xl" : "mt-1 text-2xl"} font-bold text-neutral-50`}>Deck Analyzer</h1>
          {fullPage && <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-neutral-400">Import a public Moxfield or Archidekt deck to load its cards and begin the full Commander analysis.</p>}
        </div>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          onImport();
        }}
        className={`${showTitle ? (fullPage ? "mt-8" : compact ? "mt-0" : "mt-5") : compact ? "mt-0" : "mt-3"} ${sidebar ? "space-y-2" : "space-y-3"}`}
      >
        <div className={fullPage ? "text-center" : ""}>
          <div className={sidebar ? "text-[10px] uppercase tracking-wide text-neutral-500" : "text-[11px] uppercase tracking-wide text-neutral-500"}>Deck Import</div>
          {!sidebar && <div className="mt-1 text-xs text-neutral-500">Paste a public Moxfield or Archidekt deck link to import and analyze.</div>}
        </div>
        <div className={`grid ${sidebar ? "gap-1.5" : "gap-2"} ${sidebar ? "" : fullPage || compact ? "sm:grid-cols-[minmax(0,1fr)_auto_auto]" : ""}`}>
          <input
            aria-label="Moxfield or Archidekt deck URL"
            value={deckUrl}
            onChange={(event) => setDeckUrl(event.target.value)}
            onPaste={onDeckPaste}
            placeholder="Paste Moxfield or Archidekt URL"
            className={sidebar ? "min-h-9 min-w-0 rounded-lg border border-neutral-800 bg-neutral-900 px-2.5 py-1.5 text-sm text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-amber-500" : "min-h-11 min-w-0 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-base text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-amber-500 sm:text-sm"}
          />
          <button type="button" onClick={onClipboardPaste} disabled={loading} className={sidebar ? "min-h-9 rounded-lg border border-neutral-700 bg-neutral-900 px-2.5 py-1.5 text-xs font-semibold text-neutral-200 transition hover:border-amber-500 hover:text-amber-200 disabled:cursor-not-allowed disabled:text-neutral-600" : "min-h-11 rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-2 text-sm font-semibold text-neutral-200 transition hover:border-amber-500 hover:text-amber-200 disabled:cursor-not-allowed disabled:text-neutral-600"}>
            Paste clipboard
          </button>
          <button type="submit" disabled={loading || !deckUrl.trim()} className={sidebar ? "min-h-9 rounded-lg bg-amber-500 px-2.5 py-1.5 text-xs font-bold text-neutral-950 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400" : "min-h-11 rounded-lg bg-amber-500 px-3 py-2 text-sm font-bold text-neutral-950 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400"}>
            Import & Analyze
          </button>
        </div>

        {!compact && draftDeck && (
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
      </form>
    </div>
  );
}

function InputPanel(props) {
  const { draftDeck, hasAnalysis, sidePanelOpen } = props;

  if (!sidePanelOpen) return null;

  return (
    <aside aria-label="Deck settings" className="border-b border-neutral-800 bg-neutral-950/95 p-3 lg:hidden">
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
    </aside>
  );
}

function HomeDeckHeader({ deck, coreCards, toggleCoreCard }) {
  return (
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
  );
}

function SummaryStrip({ analysis, deck, analysisReady }) {
  const bracket = analysis.bracket;
  const manaFit = analysis.manaFit || analysis.structure?.manaFit;
  const interaction = analysis.structure?.interactionProfile;
  return (
    <section className={panelClass("min-w-0 p-4")}>
      <div className="text-[11px] uppercase tracking-wide text-neutral-500">Deck Snapshot</div>
      <div aria-label="Deck snapshot metrics" className="mt-3 grid grid-cols-2 gap-2 xl:grid-cols-4">
        <Metric label="Main deck" value={calculationValue(analysisReady, `${deck.cardCount}/${deck.expectedMainCount}`)} tone={deck.cardCount === deck.expectedMainCount ? "good" : "warn"} sub="Excludes commander" />
        <Metric label="Mana" value={calculationValue(analysisReady, `${manaFit?.currentRamp ?? 0} ramp`)} tone={manaFit?.status === "good" ? "good" : manaFit?.status === "bad" ? "bad" : "warn"} sub={manaFit ? `Target ${manaFit.rampRange.min}–${manaFit.rampRange.max}` : "Loading"} />
        <Metric label="Answers" value={calculationValue(analysisReady, interaction?.total ?? 0)} tone={interaction?.status === "good" ? "good" : interaction?.status === "bad" ? "bad" : "warn"} sub="Removal and wipes" />
        <Metric label="Power" value={calculationValue(analysisReady, bracket?.rangeLabel)} tone={bracket?.bracket >= 4 ? "bad" : bracket?.bracket === 3 ? "warn" : "good"} sub={analysisReady ? bracket?.label : "Loading"} />
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

function NextStepCard({ step, setActiveTab }) {
  return (
    <article className={`rounded-lg border p-3 sm:p-4 ${priorityClasses(step.priority)}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">{step.title}</h3>
            <span className="rounded border border-current/30 px-1.5 py-0.5 text-[10px] uppercase">{step.priority}</span>
          </div>
          <p className="mt-2 text-sm text-neutral-300">{step.summary}</p>
          <p className="mt-2 text-sm font-medium text-neutral-100">{step.action}</p>
        </div>
        <button
          type="button"
          onClick={() => setActiveTab(step.tab)}
          className="min-h-9 shrink-0 rounded border border-neutral-700 px-3 py-1 text-xs font-semibold text-neutral-100 hover:border-amber-500 hover:text-amber-200"
        >
          Open {TABS.find((tab) => tab.id === step.tab)?.label || "details"}
        </button>
      </div>
    </article>
  );
}

function ScorecardTab({ analysis, settings, setSettings, setActiveTab, analysisReady }) {
  const nextSteps = (analysis.nextSteps || []).slice(0, 3);
  const activeFixes = (analysis.nextSteps || []).filter((step) => step.priority !== "optional").length;
  return (
    <div className="space-y-3 sm:space-y-4">
      <section className={panelClass("p-4 sm:p-5")}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">Overall Score</div>
            <div className={`mt-1 font-bold text-neutral-50 ${analysisReady ? "text-5xl" : "text-3xl"}`}>{calculationValue(analysisReady, analysis.overallScore)}</div>
          </div>
          <Metric label="Next steps" value={calculationValue(analysisReady, activeFixes)} tone={activeFixes ? "warn" : "good"} sub="Decision-ready items" />
        </div>
      </section>

      <section className={panelClass("p-4 sm:p-5")}>
        <div className="flex items-baseline justify-between gap-3">
          <div className="text-[11px] uppercase tracking-wide text-neutral-500">Next Steps</div>
          <div className="text-xs text-neutral-500">One action each</div>
        </div>
        <div className="mt-3 space-y-2">
          {nextSteps.length
            ? nextSteps.map((step) => <NextStepCard key={step.id} step={step} setActiveTab={setActiveTab} />)
            : <div className="rounded border border-emerald-900 bg-emerald-950/30 p-3 text-sm text-emerald-100">No structural fix is active. Use playtest notes for the next change.</div>}
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
        <div className="text-[11px] uppercase tracking-wide text-neutral-500">Three-Stage Plan</div>
        <div className="mt-3 space-y-3">
          {(winPlan?.stages || []).map((stage) => (
            <article key={stage.key} className="rounded-lg border border-neutral-800 bg-neutral-950 p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="font-semibold text-neutral-100">{stage.label}</div>
                <div className="text-xs text-neutral-500">{stage.cards.length} examples</div>
              </div>
              <p className="mt-1 text-sm text-neutral-400">{stage.summary}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {stage.cards.length
                  ? stage.cards.map((card) => <span key={card} className="rounded border border-neutral-800 bg-neutral-900 px-2 py-1 text-xs text-neutral-300">{card}</span>)
                  : <span className="text-xs text-neutral-500">No clear example detected.</span>}
              </div>
            </article>
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
            <details key={cluster.name} className="rounded-lg border border-neutral-800 bg-neutral-950 p-4">
              <summary className="cursor-pointer text-sm font-semibold text-amber-200">{cluster.name}</summary>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {cluster.cards.map((card) => (
                  <span key={card} className="rounded border border-neutral-800 bg-neutral-900 px-2 py-1 text-xs text-neutral-300">{card}</span>
                ))}
              </div>
              {cluster.secondaryCards?.length > 0 && <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-neutral-500"><span>Also tagged here:</span>{cluster.secondaryCards.map((card) => <span key={card} className="rounded border border-neutral-700 px-2 py-0.5 text-neutral-400">{card}</span>)}</div>}
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
  const gaps = (structure.answerGaps || []).filter((gap) => gap.severity === "gap");
  const covered = (structure.answerGaps || []).filter((gap) => gap.severity === "covered");

  return (
    <div className="grid gap-3 sm:gap-4 xl:grid-cols-[1.1fr_0.9fr]">
      <section className={panelClass("p-4 sm:p-5")}>
        <div className="text-[11px] uppercase tracking-wide text-neutral-500">Coverage</div>
        <div className="mt-3 grid gap-2 sm:gap-3 md:grid-cols-2">
          {(structure.roleBalance || []).map((role) => (
            <details key={role.key} className={`rounded-lg border p-3 ${statusClasses(role.status)}`}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                <div>
                  <div className="font-semibold">{role.label}</div>
                  <div className="mt-1 text-xs text-neutral-500">Target {role.target} · {role.status}</div>
                </div>
                <div className="text-2xl font-bold">{role.count}</div>
              </summary>
              <p className="mt-3 text-sm text-neutral-300">{role.detail}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {role.examples.length
                  ? role.examples.map((card) => <span key={card} className="rounded border border-neutral-800 bg-neutral-950/60 px-2 py-1 text-xs text-neutral-300">{card}</span>)
                  : <span className="text-xs text-neutral-500">No clear examples detected.</span>}
              </div>
            </details>
          ))}
        </div>
      </section>

      <div className="space-y-4">
        <section className={panelClass("p-4 sm:p-5")}>
          <div className="text-[11px] uppercase tracking-wide text-neutral-500">Answer Gaps</div>
          <div className="mt-3 space-y-2">
            {gaps.length
              ? gaps.map((gap) => <StatusLine key={gap.key} ok={false}>{gap.message}</StatusLine>)
              : <StatusLine ok>No active answer gap is detected.</StatusLine>}
          </div>
          {covered.length > 0 && (
            <details className="mt-3 rounded border border-neutral-800 bg-neutral-950 p-3">
              <summary className="cursor-pointer text-sm font-semibold text-neutral-300">Covered categories ({covered.length})</summary>
              <div className="mt-3 space-y-2">
                {covered.map((gap) => <StatusLine key={gap.key} ok>{gap.message}</StatusLine>)}
              </div>
            </details>
          )}
        </section>
      </div>
    </div>
  );
}

function PowerTab({ analysis, analysisReady }) {
  const bracket = analysis.bracket;
  const drivers = [
    { key: "game-changers", label: "Game Changers", cards: bracket.gameChangers || [] },
    { key: "fast-mana", label: "Fast Mana", cards: (bracket.speedSignals || []).filter((signal) => signal.type === "fast mana").map((signal) => signal.name) },
    { key: "combos", label: "Compact Combos", cards: (bracket.comboSignals || []).map((combo) => combo.name) },
    { key: "banned", label: "Banned Cards", cards: bracket.bannedCards || [] },
  ];
  const detectedDrivers = drivers.filter((driver) => driver.cards.length);
  const absentDrivers = drivers.filter((driver) => !driver.cards.length).map((driver) => driver.label.toLowerCase());
  const updatedAt = bracket.gameChangerMetadata?.generatedAt
    ? new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${bracket.gameChangerMetadata.generatedAt}T00:00:00Z`))
    : null;
  return (
    <div className="space-y-3 sm:space-y-4">
      <section className={panelClass("p-4 sm:p-5")}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">Commander Bracket</div>
            <div className={`mt-2 font-bold text-neutral-50 ${analysisReady ? "text-3xl sm:text-4xl" : "text-2xl sm:text-3xl"}`}>{calculationValue(analysisReady, bracket.rangeLabel)}</div>
            <div className="mt-1 text-sm text-neutral-400">{analysisReady ? `${bracket.label} · ${Math.round(bracket.confidence * 100)}% confidence` : "Calculating..."}</div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:min-w-[280px]">
            <Metric label="Estimated win" value={calculationValue(analysisReady, `~${bracket.expectedWinTurn}`)} />
            <Metric label="Drivers" value={calculationValue(analysisReady, detectedDrivers.length)} tone={detectedDrivers.length ? "warn" : "good"} />
          </div>
        </div>
      </section>

      <section className={panelClass("p-4 sm:p-5")}>
        <div className="text-[11px] uppercase tracking-wide text-neutral-500">Detected Drivers</div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {detectedDrivers.length
            ? detectedDrivers.map((driver) => (
              <div key={driver.key} className="rounded-lg border border-neutral-800 bg-neutral-950 p-3">
                <div className="text-sm font-semibold text-neutral-100">{driver.label}</div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {driver.cards.map((card) => <span key={card} className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300">{card}</span>)}
                </div>
              </div>
            ))
            : <div className="text-sm text-neutral-500">No {absentDrivers.join(", ")} detected.</div>}
        </div>
        {detectedDrivers.length > 0 && absentDrivers.length > 0 && <p className="mt-4 text-sm text-neutral-500">No {absentDrivers.join(", ")} detected.</p>}
        {updatedAt && <p className="mt-3 text-xs text-neutral-600">Game Changer list updated {updatedAt}.</p>}
      </section>

      <details className={panelClass("p-4 sm:p-5")}>
        <summary className="cursor-pointer text-sm font-semibold text-neutral-200">Details</summary>
        <div className="mt-3 space-y-2">
          {analysisReady ? bracket.reasons.map((reason) => <StatusLine key={reason} ok={bracket.bracket <= 2}>{reason}</StatusLine>) : <StatusLine ok={false}>Calculating...</StatusLine>}
        </div>
      </details>
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
        <div className="text-[11px] uppercase tracking-wide text-neutral-500">Colored Pip Demand</div>
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
        <p className="mt-1 text-xs text-neutral-500">Generic mana in costs: {analysis.genericMana ?? 0}. Generic costs are separate from colored pip demand.</p>
      </section>

      <section className={`${panelClass("p-4 sm:p-5")} xl:col-span-2`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">Curve Bands</div>
            <p className="mt-2 text-sm text-neutral-400">Setup, early, commander turn, midgame, then top end.</p>
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

function cardConclusion(score) {
  const note = score.note || "";
  if (score.protected && score.zone === "commanders") return "Command-zone card; not evaluated as a cut candidate.";
  if (note.includes("identity overlap")) return "Directly overlaps with the commander or marked core cards.";
  if (note.includes("competes with commander turn")) return "Competes with the commander's mana-value turn.";
  if (note.includes("expensive low-synergy")) return "Expensive without enough visible strategic support.";
  if (note.includes("core identity")) return "Protected as a marked core identity card.";
  return "No stronger cut or identity signal is visible.";
}

function CardsTab({ analysis, cardMap, coreCards, toggleCoreCard, roleFilter, setRoleFilter, sortCol, sortDir, setSortCol, setSortDir, analysisReady }) {
  const [expanded, setExpanded] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const coreSet = useMemo(() => new Set((coreCards || []).map(normalizeName)), [coreCards]);
  const expandedSet = useMemo(() => new Set(expanded), [expanded]);
  const shortlistLimit = Math.max(10, analysis.deckSizePlan?.cutsNeeded || 0);
  const cutsByName = useMemo(() => new Map((analysis.cutCandidates || []).slice(0, shortlistLimit).map((candidate) => [normalizeName(candidate.name), candidate])), [analysis.cutCandidates, shortlistLimit]);
  const analyzedNonLandCount = useMemo(() => (analysis.scores || []).length, [analysis.scores]);
  const rows = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();
    const filtered = analysis.scores.filter((score) => {
      if (score.zone === "commanders") return false;
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
          <div className="text-[11px] uppercase tracking-wide text-neutral-500">Card List</div>
          <div className="mt-1 text-sm text-neutral-400">{analyzedNonLandCount} analyzed nonland cards. {rows.length} match the current filters.</div>
        </div>
        <div className="grid gap-2 sm:grid-cols-[minmax(180px,1fr)_160px_auto_auto]">
          <input
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Search cards or roles"
            className="min-h-9 rounded border border-neutral-800 bg-neutral-950 px-3 py-1 text-sm text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-amber-500"
          />
          <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)} className="min-h-9 rounded border border-neutral-800 bg-neutral-950 px-2 py-1 text-sm text-neutral-100">
            <option value="all">All roles</option>
            {ROLE_FILTER_GROUPS.map((group) => <optgroup key={group.label} label={group.label}>{group.filters.map((filter) => <option key={filter.id} value={filter.id}>{filter.label}</option>)}</optgroup>)}
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
                    <div className="mt-1 text-xs text-neutral-500">MV {card?.cmc ?? "-"} · {cardConclusion(score)}</div>
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
              {isExpanded && (
                <div className="mt-3 rounded-lg border border-neutral-800 bg-neutral-950 p-3">
                  <div className="grid gap-3 sm:grid-cols-[120px_1fr]">
                    <PreviewableCardImage
                      card={card}
                      name={score.name}
                      className="w-full rounded-md border border-neutral-800"
                      fallbackClassName="flex aspect-[5/7] items-center justify-center rounded-md border border-neutral-800 text-center text-xs text-neutral-500"
                    />
                    <div>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleCoreCard(score.name);
                        }}
                        className={`min-h-9 rounded border px-3 py-2 text-xs font-semibold ${isCore ? "border-amber-500 bg-amber-500 text-neutral-950" : "border-neutral-700 text-neutral-300 hover:border-amber-500 hover:text-amber-200"}`}
                      >
                        {isCore ? "Remove core mark" : "Set core"}
                      </button>
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
                    <td className="px-3 py-2 text-neutral-400">{cardConclusion(score)}</td>
                  </tr>
                  {isExpanded && (
                    <tr className="border-t border-neutral-800 bg-neutral-950">
                      <td></td>
                      <td colSpan={6} className="px-4 py-4">
                        <div className="grid gap-3 lg:grid-cols-[180px_220px_1fr]">
                          <PreviewableCardImage
                            card={card}
                            name={score.name}
                            className="w-full rounded-md border border-neutral-800"
                            fallbackClassName="flex aspect-[5/7] items-center justify-center rounded-md border border-neutral-800 text-center text-xs text-neutral-500"
                          />
                          <div>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                toggleCoreCard(score.name);
                              }}
                              className={`min-h-9 rounded border px-3 py-2 text-xs font-semibold ${isCore ? "border-amber-500 bg-amber-500 text-neutral-950" : "border-neutral-700 text-neutral-300 hover:border-amber-500 hover:text-amber-200"}`}
                            >
                              {isCore ? "Remove core mark" : "Set core"}
                            </button>
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

function TierListCard({ item, analysisReady, onSelect }) {
  const candidate = item.cutCandidate;
  const decision = item.decision;
  return (
    <button
      type="button"
      onClick={() => candidate && onSelect(item.name)}
      disabled={!candidate}
      aria-label={candidate ? `Review ${item.name} cut details` : `${item.name} is not a cut candidate`}
      className="flex min-w-0 flex-col overflow-hidden rounded border border-neutral-800 bg-neutral-950 text-left shadow-lg enabled:hover:border-amber-500 disabled:cursor-default"
    >
      <div className="border-b border-neutral-800 bg-neutral-900">
        <PreviewableCardImage
          card={item.card}
          name={item.name}
          className="aspect-[5/7] w-full object-cover"
          fallbackClassName="flex aspect-[5/7] w-full items-center justify-center bg-neutral-900 p-3 text-center text-xs text-neutral-500"
        />
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
      </div>
    </button>
  );
}

function DeckTierList({ analysis, cardMap, cutDecisions, onSelect, analysisReady, candidateNames = null }) {
  const tierRows = useMemo(() => {
    const rows = buildTierRows({ analysis, cardMap, cutDecisions });
    if (!candidateNames) return rows;
    return rows
      .map((row) => ({ ...row, cards: row.cards.filter((item) => candidateNames.has(normalizeName(item.name))) }))
      .filter((row) => row.cards.length);
  }, [analysis, cardMap, cutDecisions, candidateNames]);
  const totalCards = tierRows.reduce((sum, row) => sum + row.cards.length, 0);
  return (
    <section className={panelClass("overflow-hidden")}>
      <div className="border-b border-neutral-800 p-4 sm:p-5">
        <div className="text-[11px] uppercase tracking-wide text-neutral-500">Tier List</div>
        <div className="mt-1 text-sm text-neutral-400">{totalCards} {candidateNames ? "cut suggestions" : "cards"} grouped from first cuts to strongest includes. Select a cut candidate for details.</div>
      </div>
      <div className="divide-y divide-neutral-800">
        {tierRows.length ? tierRows.map((row) => {
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
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 min-[1920px]:grid-cols-7">
                {row.cards.length
                  ? row.cards.map((item) => (
                    <TierListCard key={item.name} item={item} analysisReady={analysisReady} onSelect={onSelect} />
                  ))
                  : <div className="flex min-h-40 items-center text-sm text-neutral-500">No cards in this tier.</div>}
              </div>
            </div>
          );
        }) : <div className="p-5 text-sm text-neutral-500">No cut suggestions match this filter.</div>}
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

function LegacyCutsTab({ analysis, cardMap, analysisReady }) {
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

function CutsTab({ analysis, cardMap, analysisReady }) {
  const deckSizePlan = analysis.deckSizePlan || {};
  const requiredCuts = deckSizePlan.cutsNeeded || 0;
  const [cutDecisions, setCutDecisions] = useState({});
  const [showAll, setShowAll] = useState(false);
  const [highConfidenceOnly, setHighConfidenceOnly] = useState(false);
  const [selectedName, setSelectedName] = useState("");
  const [compareA, setCompareA] = useState("");
  const [compareB, setCompareB] = useState("");
  const [exportCopyStatus, setExportCopyStatus] = useState("idle");
  const candidates = analysis.cutCandidates || [];
  const candidateKeys = useMemo(() => new Set(candidates.map((candidate) => normalizeName(candidate.name))), [candidates]);
  const filteredCandidates = useMemo(
    () => candidates.filter((candidate) => !highConfidenceOnly || candidate.confidence === "high"),
    [candidates, highConfidenceOnly],
  );
  const visibleCandidates = showAll ? filteredCandidates : filteredCandidates.slice(0, 10);
  const visibleCandidateNames = useMemo(
    () => new Set(visibleCandidates.map((candidate) => normalizeName(candidate.name))),
    [visibleCandidates],
  );
  const selectedCandidate = candidates.find((candidate) => candidate.name === selectedName) || visibleCandidates[0] || null;
  const acceptedCuts = candidates.filter((candidate) => cutDecisions[normalizeName(candidate.name)] === "cut");
  const keptCandidates = candidates.filter((candidate) => cutDecisions[normalizeName(candidate.name)] === "keep");
  const tierByName = useMemo(
    () => new Map(buildTierRows({ analysis, cardMap, cutDecisions }).flatMap((row) => row.cards.map((item) => [normalizeName(item.name), row.tier]))),
    [analysis, cardMap, cutDecisions],
  );
  const comparisonChoices = visibleCandidates;
  const compareLeft = comparisonChoices.find((candidate) => candidate.name === compareA);
  const compareRight = comparisonChoices.find((candidate) => candidate.name === compareB);
  const deckNeeds = (analysis.nextSteps || []).filter((step) => ["mana", "interaction", "flow", "resilience", "win-plan"].includes(step.category));
  const exportText = [
    "Cuts",
    ...acceptedCuts.map((candidate) => `- ${candidate.name}: ${candidate.cutReason?.[0] || candidate.reasons?.[0] || "Review this slot."}`),
    ...(keptCandidates.length ? ["", "Keep", ...keptCandidates.map((candidate) => `- ${candidate.name}`)] : []),
  ].join("\n");

  useEffect(() => {
    setCutDecisions((current) => Object.fromEntries(Object.entries(current).filter(([name]) => candidateKeys.has(name))));
  }, [candidateKeys]);

  useEffect(() => {
    if (visibleCandidates.some((candidate) => candidate.name === selectedName)) return;
    setSelectedName(visibleCandidates[0]?.name || "");
  }, [selectedName, visibleCandidates]);

  useEffect(() => {
    setExportCopyStatus("idle");
  }, [exportText]);

  const setCandidateDecision = (name, decision) => {
    setCutDecisions((current) => {
      const key = normalizeName(name);
      const next = { ...current };
      if (decision) next[key] = decision;
      else delete next[key];
      return next;
    });
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

  return (
    <div className="space-y-4">
      <section className={panelClass("p-4 sm:p-5")}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">Cut Finder</div>
            <h2 className="mt-1 text-xl font-semibold text-neutral-50">{requiredCuts > 0 ? `Need ${requiredCuts} cut${requiredCuts === 1 ? "" : "s"}` : `Review ${visibleCandidates.length} suggestion${visibleCandidates.length === 1 ? "" : "s"}`}</h2>
            <p className="mt-1 text-sm text-neutral-400">{requiredCuts > 0 ? `${deckSizePlan.totalCards} total cards; target ${deckSizePlan.targetTotal || 100}.` : "No size cuts are required; review only the suggestions worth testing."}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setHighConfidenceOnly((current) => !current)} className={`min-h-9 rounded border px-3 py-1 text-xs font-semibold ${highConfidenceOnly ? "border-amber-500 bg-amber-500 text-neutral-950" : "border-neutral-700 text-neutral-300 hover:border-amber-500"}`}>High confidence</button>
            {filteredCandidates.length > 10 && <button type="button" onClick={() => setShowAll((current) => !current)} className="min-h-9 rounded border border-neutral-700 px-3 py-1 text-xs font-semibold text-neutral-300 hover:border-amber-500 hover:text-amber-200">{showAll ? "Show top 10" : "Show more"}</button>}
          </div>
        </div>
      </section>

      <DeckTierList analysis={analysis} cardMap={cardMap} cutDecisions={cutDecisions} onSelect={setSelectedName} analysisReady={analysisReady} candidateNames={visibleCandidateNames} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
        {false && <section className={panelClass("p-4 sm:p-5")}>
          <div className="flex items-baseline justify-between gap-3">
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">{requiredCuts > 0 ? `Review ${requiredCuts} suggestions` : "Review 10 suggestions"}</div>
            <div className="text-xs text-neutral-500">{filteredCandidates.length} available</div>
          </div>
          <div className="mt-3 space-y-2">
            {visibleCandidates.map((candidate) => {
              const selected = selectedCandidate?.name === candidate.name;
              const tier = tierByName.get(normalizeName(candidate.name)) || "-";
              return (
                <button key={candidate.name} type="button" onClick={() => setSelectedName(candidate.name)} className={`w-full rounded-lg border p-3 text-left ${selected ? "border-amber-500 bg-amber-950/30" : "border-neutral-800 bg-neutral-950 hover:border-neutral-600"}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-neutral-100">{candidate.name}</span>
                    <span className="rounded border border-neutral-700 px-1.5 py-0.5 text-[11px] text-neutral-300">Tier {tier} · {candidate.confidence}</span>
                  </div>
                  <p className="mt-2 text-sm text-neutral-300">{candidate.cutReason?.[0] || candidate.reasons?.[0] || "Review this slot."}</p>
                  <p className="mt-1 text-xs text-neutral-500">Replace with {candidate.replacementNeed}.</p>
                </button>
              );
            })}
            {!visibleCandidates.length && <div className="rounded border border-neutral-800 bg-neutral-950 p-3 text-sm text-neutral-500">No suggestions match this filter.</div>}
          </div>
        </section>}

        <aside className="space-y-4">
          <section className={panelClass("p-4 sm:p-5")}>
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">Suggestion Details</div>
            {selectedCandidate ? (() => {
              const decision = cutDecisions[normalizeName(selectedCandidate.name)];
              const card = findCard(cardMap, selectedCandidate.name);
              const tier = tierByName.get(normalizeName(selectedCandidate.name)) || "-";
              return (
                <div className="mt-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <CardPreview card={card} name={selectedCandidate.name} />
                    <div className="flex gap-2">
                      <span className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300">Tier {tier}</span>
                      <span className={`rounded border px-2 py-1 text-xs uppercase ${confidenceClasses(selectedCandidate.confidence)}`}>{selectedCandidate.confidence}</span>
                    </div>
                  </div>
                  <p className="mt-3 text-sm text-neutral-300">{selectedCandidate.cutReason?.[0] || selectedCandidate.reasons?.[0] || "Review this slot."}</p>
                  <p className="mt-2 text-sm text-neutral-500">Replacement need: {selectedCandidate.replacementNeed}</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button type="button" onClick={() => setCandidateDecision(selectedCandidate.name, decision === "cut" ? null : "cut")} className={`min-h-9 rounded border px-3 py-1 text-xs font-semibold ${decision === "cut" ? "border-rose-500 bg-rose-500 text-neutral-950" : "border-neutral-700 text-neutral-300 hover:border-rose-500 hover:text-rose-200"}`}>{decision === "cut" ? "Cut selected" : "Cut"}</button>
                    <button type="button" onClick={() => setCandidateDecision(selectedCandidate.name, decision === "keep" ? null : "keep")} className={`min-h-9 rounded border px-3 py-1 text-xs font-semibold ${decision === "keep" ? "border-emerald-500 bg-emerald-500 text-neutral-950" : "border-neutral-700 text-neutral-300 hover:border-emerald-500 hover:text-emerald-200"}`}>{decision === "keep" ? "Keep selected" : "Keep"}</button>
                  </div>
                </div>
              );
            })() : <div className="mt-3 text-sm text-neutral-500">Select a cut candidate from the tier list or shortlist.</div>}
          </section>

          <section className={panelClass("p-4")}>
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">Deck Needs</div>
            <div className="mt-3 space-y-2">
              {deckNeeds.length ? deckNeeds.map((step) => <div key={step.id} className="rounded border border-neutral-800 bg-neutral-950 p-3"><div className="font-semibold text-neutral-100">{step.title}</div><div className="mt-1 text-sm text-neutral-400">{step.summary}</div></div>) : <div className="text-sm text-neutral-500">No structural weakness is currently active.</div>}
            </div>
          </section>

          <section className={panelClass("p-4")}>
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">Compare Suggestions</div>
            <div className="mt-3 grid gap-2">
              <input list="cut-shortlist" value={compareA} onChange={(event) => setCompareA(event.target.value)} placeholder="Search first suggestion" className="min-h-10 rounded border border-neutral-800 bg-neutral-950 px-3 text-sm text-neutral-100" />
              <input list="cut-shortlist" value={compareB} onChange={(event) => setCompareB(event.target.value)} placeholder="Search second suggestion" className="min-h-10 rounded border border-neutral-800 bg-neutral-950 px-3 text-sm text-neutral-100" />
              <datalist id="cut-shortlist">{comparisonChoices.map((candidate) => <option key={candidate.name} value={candidate.name} />)}</datalist>
            </div>
            {compareLeft && compareRight && <div className="mt-3 grid gap-2 sm:grid-cols-2">{[compareLeft, compareRight].map((candidate) => <div key={candidate.name} className="rounded border border-neutral-800 bg-neutral-950 p-3"><div className="font-semibold text-neutral-100">{candidate.name}</div><div className="mt-2 text-sm text-neutral-300">{candidate.cutReason?.[0] || candidate.reasons?.[0]}</div><div className="mt-2 text-xs text-neutral-500">Replacement: {candidate.replacementNeed}</div></div>)}</div>}
          </section>

          {Object.keys(cutDecisions).length > 0 && (
            <details className={panelClass("p-4")}>
              <summary className="cursor-pointer text-sm font-semibold text-neutral-200">Export decisions ({acceptedCuts.length} cuts, {keptCandidates.length} keeps)</summary>
              <div className="mt-3 flex justify-end"><button type="button" onClick={copyExportText} className="min-h-9 rounded border border-neutral-700 px-3 py-1 text-xs font-semibold text-neutral-300 hover:border-amber-500">{exportCopyStatus === "copied" ? "Copied" : "Copy decisions"}</button></div>
              {exportCopyStatus === "error" && <div className="mt-2 text-xs text-amber-200">Clipboard access was blocked; copy the text manually.</div>}
              <textarea readOnly value={exportText} className="mt-3 min-h-40 w-full rounded border border-neutral-800 bg-neutral-950 p-3 font-mono text-xs text-neutral-300" />
            </details>
          )}
        </aside>
      </div>
    </div>
  );
}

function ConstructionCandidateCard({ name, sourceLabel, analysis, cardMap, children }) {
  const card = findCard(cardMap, name);
  const candidate = (analysis.sideboardAnalysis || []).find((item) => normalizeName(item.name) === normalizeName(name));
  const roles = getRoleKeys(card).slice(0, 4);

  return (
    <article className="overflow-hidden rounded-xl border border-neutral-700 bg-neutral-950 shadow-lg shadow-black/20">
      <div className="grid min-w-0 gap-0 sm:grid-cols-[minmax(160px,30%)_minmax(0,1fr)]">
        <div className="flex h-[min(46vh,26rem)] min-h-40 w-full items-center justify-center bg-neutral-900 p-2">
          <PreviewableCardImage
            card={card}
            name={name}
            className="h-full w-full object-contain"
            fallbackClassName="flex h-full w-full items-center justify-center p-4 text-center text-xs text-neutral-500"
            wrapperClassName="block h-full w-full"
          />
        </div>
        <div className="flex min-w-0 flex-col p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-amber-400">{sourceLabel || "Candidate card"}</div>
              <div className="text-lg font-bold text-neutral-50">{name}</div>
              <div className="mt-1"><ManaCostDisplay card={card} /></div>
            </div>
            {candidate?.recommendation && (
              <span className={`rounded border px-2 py-0.5 text-xs uppercase ${candidate.recommendation === "add" ? "border-emerald-800 bg-emerald-950/40 text-emerald-200" : "border-amber-800 bg-amber-950/40 text-amber-200"}`}>
                {candidate.recommendation}
              </span>
            )}
          </div>
          {roles.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{roles.map((role) => <RoleChip key={role} role={role} />)}</div>}
          <p className="mt-3 text-sm leading-6 text-neutral-400">{candidate?.reason || "Use the live deck metrics below to judge this card's fit."}</p>
          <div className="mt-auto pt-4">{children}</div>
        </div>
      </div>
    </article>
  );
}

const CONSTRUCTION_ZONE_OPTIONS = [
  { id: "main", label: "Main Deck" },
  { id: "pool", label: "Candidate Pool" },
  { id: "setAside", label: "Set Aside" },
];

function ConstructionZone({ zone, title, count, entries, cardMap, emptyText, tone = "neutral", onMoveStack, draggedStack, activeDropZone, onDragStart, onDragEnd, setActiveDropZone }) {
  const toneClass = tone === "main"
    ? "border-emerald-900/80"
    : tone === "aside"
      ? "border-rose-900/80"
      : "border-amber-900/80";
  const isActiveDropTarget = activeDropZone === zone;
  const dropClass = isActiveDropTarget
    ? tone === "main"
      ? "border-emerald-400 ring-2 ring-emerald-500/60"
      : tone === "aside"
        ? "border-rose-400 ring-2 ring-rose-500/60"
        : "border-amber-400 ring-2 ring-amber-500/60"
    : "";

  const handleDrop = (event) => {
    event.preventDefault();
    if (draggedStack && draggedStack.from !== zone) onMoveStack({ ...draggedStack, to: zone });
    onDragEnd();
  };

  return (
    <section
      className={`rounded-lg border bg-neutral-900/80 transition ${toneClass} ${dropClass}`}
      onDragOver={(event) => {
        if (!draggedStack || draggedStack.from === zone) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setActiveDropZone(zone);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setActiveDropZone(null);
      }}
      onDrop={handleDrop}
    >
      <div className="flex items-center justify-between gap-3 border-b border-neutral-800 px-3 py-2.5">
        <div className="text-xs font-semibold uppercase tracking-wide text-neutral-300">{title}</div>
        <span className="rounded border border-neutral-700 bg-neutral-950 px-2 py-0.5 font-mono text-xs text-neutral-300">{count}</span>
      </div>
      <div className="max-h-60 space-y-1 overflow-y-auto p-2">
        {entries.length ? entries.map((entry) => (
          <div
            key={normalizeName(entry.name)}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", `${zone}:${entry.name}`);
              onDragStart({ name: entry.name, from: zone });
            }}
            onDragEnd={onDragEnd}
            className="flex items-center justify-between gap-2 rounded border border-neutral-800 bg-neutral-950/70 px-2 py-1.5"
          >
            <span aria-hidden="true" className="hidden cursor-grab select-none text-neutral-500 active:cursor-grabbing md:inline">⠿</span>
            <CardPreview card={findCard(cardMap, entry.name)} name={entry.name} />
            <div className="flex shrink-0 items-center gap-1.5">
              {entry.qty > 1 && <span className="font-mono text-xs text-neutral-500">x{entry.qty}</span>}
              <details className="relative">
                <summary aria-label={`Move ${entry.name} to another zone`} className="cursor-pointer rounded border border-neutral-700 px-2 py-1 text-xs font-semibold text-neutral-300 hover:border-amber-500 hover:text-amber-200">Move</summary>
                <div className="absolute right-0 z-20 mt-1 min-w-44 rounded border border-neutral-700 bg-neutral-950 p-1 shadow-xl">
                  {CONSTRUCTION_ZONE_OPTIONS.filter((option) => option.id !== zone).map((option) => (
                    <button key={option.id} type="button" aria-label={`Move ${entry.name} to ${option.label}`} onClick={() => onMoveStack({ name: entry.name, from: zone, to: option.id })} className="block w-full rounded px-2 py-1.5 text-left text-xs text-neutral-200 hover:bg-neutral-800 hover:text-amber-100">{option.label}</button>
                  ))}
                </div>
              </details>
            </div>
          </div>
        )) : <div className="p-3 text-sm text-neutral-500">{emptyText}</div>}
      </div>
    </section>
  );
}

function DeckConstructionTab({ analysis, deck, cardMap, session, onAction, analysisReady }) {
  const [mode, setMode] = useState("versus");
  const [drawnCards, setDrawnCards] = useState([]);
  const [draggedStack, setDraggedStack] = useState(null);
  const [activeDropZone, setActiveDropZone] = useState(null);
  const [moveMainConfirmOpen, setMoveMainConfirmOpen] = useState(false);
  const initialSessionRef = useRef(session.initial);
  const counts = constructionCounts(session);
  const drawCount = mode === "versus" ? 2 : 1;
  const mainSignature = session.main.map((entry) => `${normalizeName(entry.name)}:${entry.qty}`).join("|");
  const poolSignature = session.pool.map((entry) => `${normalizeName(entry.name)}:${entry.qty}`).join("|");
  const draftSignature = `${mode}|${mainSignature}|${poolSignature}`;
  const canMoveMain = counts.main > 0;
  const candidateLandEntries = useMemo(
    () => session.pool.filter((entry) => isLand(findCard(cardMap, entry.name))),
    [cardMap, session.pool],
  );
  const candidateLandCount = candidateLandEntries.reduce((sum, entry) => sum + (Number(entry.qty) || 0), 0);
  const canAddCandidateLands = candidateLandCount > 0;
  const commanderCount = deck.commanders.reduce((sum, entry) => sum + entry.qty, 0);
  const totalDeckCount = counts.main + commanderCount;
  const totalCardsNeeded = Math.max(0, 100 - totalDeckCount);
  const totalCardsOver = Math.max(0, totalDeckCount - 100);
  const totalDeckSub = `${counts.main} main + ${commanderCount} commander = ${totalDeckCount}${totalCardsNeeded ? `; ${totalCardsNeeded} needed` : totalCardsOver ? `; ${totalCardsOver} over target` : ""}`;
  const shouldOfferMainDraft = counts.main > deck.expectedMainCount && counts.pool < 2;

  useEffect(() => {
    if (initialSessionRef.current === session.initial) return;
    initialSessionRef.current = session.initial;
    setMode("versus");
    setDrawnCards([]);
  }, [session.initial]);

  const drawCards = useCallback((sourceSession = session) => {
    const sourceCounts = constructionCounts(sourceSession);
    if (mode === "versus" && sourceCounts.main >= 100) {
      const mainName = drawConstructionCandidates(sourceSession.main, 1)[0];
      const poolName = drawConstructionCandidates(sourceSession.pool, 1)[0];
      setDrawnCards(mainName && poolName
        ? [{ name: mainName, source: "main" }, { name: poolName, source: "pool" }]
        : []);
      return;
    }
    setDrawnCards(drawConstructionCandidates(sourceSession.pool, drawCount).map((name) => ({ name, source: "pool" })));
  }, [drawCount, mode, session.main, session.pool]);

  useEffect(() => {
    drawCards();
  }, [drawCards, draftSignature]);

  const drawnNames = drawnCards.map((card) => card.name);
  const versusNeedsSwap = mode === "versus" && counts.main >= 100;
  const canDraw = mode === "versus" && versusNeedsSwap
    ? counts.main > 0 && counts.pool >= 1
    : counts.pool >= drawCount;

  const refreshAfterDecision = (next) => {
    const nextSession = next || session;
    const zonesUnchanged = nextSession.main === session.main && nextSession.pool === session.pool && nextSession.setAside === session.setAside;
    if (zonesUnchanged) drawCards(nextSession);
    else setDrawnCards([]);
  };

  const handleNeither = () => {
    const next = onAction({ type: "neitherSetAside", cards: drawnCards });
    refreshAfterDecision(next);
  };

  const handleMoveStack = (move) => {
    const next = onAction({ type: "moveStack", ...move });
    if (next !== session) setDrawnCards([]);
    setDraggedStack(null);
    setActiveDropZone(null);
  };

  const endStackDrag = () => {
    setDraggedStack(null);
    setActiveDropZone(null);
  };

  const roleSignals = (analysis.structure?.roleBalance || []);
  const belowTargetSignals = roleSignals.filter((role) => role.status !== "good");

  return (
    <div className="space-y-4">
      <section className={panelClass("p-4 sm:p-5")}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-amber-400">Deck Construction</div>
            <h2 className="mt-1 text-2xl font-bold text-neutral-50">Build from sideboard candidates</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-400">Move stacks between Main, Candidates, and Set Aside. Undo restores the last choice.</p>
          </div>
          <div role="toolbar" aria-label="Build actions" className="flex flex-wrap gap-2">
            <button type="button" onClick={() => onAction({ type: "undo" })} disabled={!session.history.length} className="min-h-10 rounded border border-neutral-700 px-3 py-2 text-sm font-semibold text-neutral-300 hover:border-amber-500 hover:text-amber-200 disabled:cursor-not-allowed disabled:opacity-40">Undo</button>
            <button type="button" onClick={() => { onAction({ type: "restart" }); setMode("versus"); setDrawnCards([]); }} className="min-h-10 rounded border border-neutral-700 px-3 py-2 text-sm font-semibold text-neutral-300 hover:border-rose-700 hover:text-rose-200">Restart draft</button>
            <details className="relative">
              <summary className="min-h-10 cursor-pointer rounded border border-neutral-700 px-3 py-2 text-sm font-semibold text-neutral-300 hover:border-amber-500">Bulk actions</summary>
              <div className="absolute right-0 z-20 mt-1 grid min-w-60 gap-1 rounded border border-neutral-700 bg-neutral-950 p-2 shadow-xl">
                <button type="button" onClick={() => { if (!canMoveMain) return; setMode("versus"); setMoveMainConfirmOpen(true); }} disabled={!canMoveMain} className="min-h-10 rounded border border-amber-800 bg-amber-950/30 px-3 py-2 text-left text-sm font-semibold text-amber-100 hover:border-amber-500 disabled:cursor-not-allowed disabled:opacity-40">Move main to candidates</button>
                <button type="button" onClick={() => { if (!canAddCandidateLands) return; const next = onAction({ type: "addCandidateLands", names: candidateLandEntries.map((entry) => entry.name) }); if (next !== session) setDrawnCards([]); }} disabled={!canAddCandidateLands} title={canAddCandidateLands ? `Move ${candidateLandCount} recognized land${candidateLandCount === 1 ? "" : "s"} to the main deck` : "No recognized land cards in the candidate pool"} className="min-h-10 rounded border border-emerald-800 bg-emerald-950/30 px-3 py-2 text-left text-sm font-semibold text-emerald-100 hover:border-emerald-500 disabled:cursor-not-allowed disabled:opacity-40">Add candidate lands</button>
              </div>
            </details>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-3">
          <Metric label="Deck Size" value={`${totalDeckCount}/100`} tone={totalDeckCount === 100 ? "good" : "warn"} sub={totalDeckSub} />
          <Metric label="Sideboard pool" value={counts.pool} tone={counts.pool ? "neutral" : "warn"} sub="Candidates to review" />
          <Metric label="Set Aside" value={counts.setAside} tone={counts.setAside ? "bad" : "neutral"} sub="Excluded this session" />
        </div>
        <div className="mt-3 rounded border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-300">{session.notice}</div>
        {!canMoveMain && <div className="mt-2 text-xs text-neutral-500">The main deck is empty. There are no main-deck cards to move; command-zone cards remain separate.</div>}
        {moveMainConfirmOpen && (
          <div role="alertdialog" aria-label="Confirm moving main deck to sideboard" className="mt-3 rounded-lg border border-amber-700 bg-amber-950/40 p-3 text-sm text-amber-50">
            <div className="font-semibold">Move the entire current main deck?</div>
            <p className="mt-1 leading-6 text-amber-100/80">This will move all {counts.main} current main-deck cards into the Moxfield sideboard/candidate pool, combine them with the cards already there, and empty the main deck for drafting. Command-zone cards stay separate and are not moved.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={() => { onAction({ type: "moveMainToPool" }); setMode("versus"); setDrawnCards([]); setMoveMainConfirmOpen(false); }} className="min-h-10 rounded bg-amber-500 px-3 py-2 text-sm font-bold text-neutral-950 hover:bg-amber-400">Confirm move</button>
              <button type="button" onClick={() => setMoveMainConfirmOpen(false)} className="min-h-10 rounded border border-neutral-700 px-3 py-2 text-sm font-semibold text-neutral-200 hover:border-neutral-500">Cancel</button>
            </div>
          </div>
        )}
      </section>

      <section className={panelClass("p-4 sm:p-5")}>
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">Draft Mode</div>
            <div className="mt-1 text-sm text-neutral-400">{mode === "pick" ? "Keep the card or set it aside." : "Choose one card for Main, or set aside the card you reject."}</div>
          </div>
          <div className="inline-flex w-fit rounded-lg border border-neutral-800 bg-neutral-950 p-1">
            {[{ id: "pick", label: "Pick One" }, { id: "versus", label: "Versus" }].map((option) => (
              <button key={option.id} type="button" onClick={() => setMode(option.id)} className={`min-h-9 rounded px-3 py-1.5 text-sm font-semibold ${mode === option.id ? "bg-amber-500 text-neutral-950" : "text-neutral-400 hover:text-neutral-100"}`}>{option.label}</button>
            ))}
          </div>
        </div>

        <div className="mt-4">
          {shouldOfferMainDraft && (
            <div className="mb-3 rounded-lg border border-amber-700 bg-amber-950/40 p-4 text-amber-50">
              <div className="font-semibold">Start a fresh draft</div>
              <p className="mt-1 text-sm leading-6 text-amber-100/80">Move the current main deck into Candidates, then rebuild with Versus. The commander stays separate.</p>
              <button type="button" onClick={() => { setMode("versus"); setMoveMainConfirmOpen(true); }} className="mt-3 min-h-11 rounded-lg bg-amber-500 px-3 py-2 text-sm font-bold text-neutral-950 hover:bg-amber-400">Move all main-deck cards to candidate pool</button>
            </div>
          )}
          {drawnCards.length === (mode === "pick" ? 1 : 2) ? (
            <div className={`grid gap-3 ${mode === "versus" ? "xl:grid-cols-2" : "mx-auto max-w-3xl"}`}>
              {drawnCards.map((card, index) => {
                const other = drawnCards[index === 0 ? 1 : 0];
                return (
                  <ConstructionCandidateCard key={`${mode}-${card.source}-${card.name}-${index}`} name={card.name} sourceLabel={card.source === "main" ? "Main deck card" : "Sideboard card"} analysis={analysis} cardMap={cardMap}>
                    {mode === "pick" ? (
                      <div className="grid gap-2 sm:grid-cols-2">
                        <button type="button" onClick={() => onAction({ type: "add", name: card.name })} className="min-h-11 rounded-lg bg-emerald-500 px-3 py-2 text-sm font-bold text-neutral-950 hover:bg-emerald-400">Add to main deck</button>
                        <button type="button" onClick={() => onAction({ type: "setAside", names: [card.name] })} className="min-h-11 rounded-lg border border-rose-800 bg-rose-950/30 px-3 py-2 text-sm font-bold text-rose-100 hover:bg-rose-900/50">Set aside</button>
                      </div>
                    ) : (
                      <div className="grid gap-2 sm:grid-cols-2">
                        <button type="button" onClick={() => refreshAfterDecision(onAction({ type: "versusComparison", chosen: card, other }))} className="min-h-11 rounded-lg bg-emerald-500 px-3 py-2 text-sm font-bold text-neutral-950 hover:bg-emerald-400">Choose this card</button>
                        <button type="button" onClick={() => refreshAfterDecision(onAction({ type: "versusComparisonSetAside", chosen: card, other }))} className="min-h-11 rounded-lg border border-rose-800 bg-rose-950/30 px-3 py-2 text-sm font-bold text-rose-100 hover:bg-rose-900/50">Set aside</button>
                      </div>
                    )}
                  </ConstructionCandidateCard>
                );
              })}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-neutral-700 bg-neutral-950 p-8 text-center">
              <div className="text-sm font-semibold text-neutral-200">{shouldOfferMainDraft ? "Start a fresh draft from the oversized main deck." : counts.pool ? (mode === "versus" ? (versusNeedsSwap ? "Versus needs one main-deck card and one candidate-pool card." : "Versus needs at least two distinct candidate-pool cards.") : "No card drawn yet.") : "Candidate pool complete."}</div>
              <div className="mt-1 text-xs text-neutral-500">{shouldOfferMainDraft ? "Use the action above to start with Candidates." : counts.pool ? (versusNeedsSwap ? "The unchosen card returns to its original zone." : "Use Pick One when one candidate remains.") : "Undo or restart to revisit a decision."}</div>
            </div>
          )}
        </div>

        <div className={`mt-4 flex flex-col gap-2 ${mode === "versus" ? "items-center text-center" : "items-start"}`}>
          <button type="button" onClick={() => drawCards()} disabled={!canDraw} className="min-h-10 w-fit rounded border border-neutral-700 px-3 py-2 text-sm font-semibold text-neutral-300 hover:border-amber-500 hover:text-amber-200 disabled:cursor-not-allowed disabled:opacity-40">{mode === "versus" ? "Skip, redraw draft" : "Draw another card"}</button>
          {mode === "versus" && drawnNames.length === 2 && (
            <div className="flex flex-col items-center gap-1">
              <button type="button" onClick={handleNeither} className="min-h-10 rounded border border-rose-800 bg-rose-950/30 px-3 py-2 text-sm font-semibold text-rose-100 hover:border-rose-400 hover:outline hover:outline-1 hover:outline-rose-500 hover:bg-rose-900/50">Neither — set both aside</button>
              <div className="text-xs text-neutral-500">Both cards move to Set Aside. Undo restores their original zones.</div>
            </div>
          )}
        </div>
      </section>

      <section className={panelClass("p-4 sm:p-5")}>
        <div className="text-[11px] uppercase tracking-wide text-neutral-500">Live Deck Signals</div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          {belowTargetSignals.map((role) => (
            <div key={role.key} className={`rounded border px-3 py-2 ${statusClasses(role.status)}`}>
              <div className="text-xs text-neutral-400">{role.label}</div>
              <div className="mt-1 font-mono text-lg font-bold">{analysisReady ? role.count : "..."} <span className="text-xs font-normal text-neutral-500">/ {role.target}</span></div>
            </div>
          ))}
          {!belowTargetSignals.length && <div className="rounded border border-emerald-900 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-100">All tracked coverage targets are met.</div>}
        </div>
        {roleSignals.some((role) => role.status === "good") && <details className="mt-3 text-sm text-neutral-400"><summary className="cursor-pointer">Show covered signals</summary><div className="mt-2 flex flex-wrap gap-2">{roleSignals.filter((role) => role.status === "good").map((role) => <span key={role.key} className="rounded border border-emerald-900 px-2 py-1 text-xs text-emerald-200">{role.label}: {role.count}</span>)}</div></details>}
      </section>

      <div className="grid gap-3 xl:grid-cols-3">
        <ConstructionZone zone="main" title="Main Deck" count={counts.main} entries={session.main} cardMap={cardMap} emptyText="No main-deck cards yet." tone="main" onMoveStack={handleMoveStack} draggedStack={draggedStack} activeDropZone={activeDropZone} onDragStart={setDraggedStack} onDragEnd={endStackDrag} setActiveDropZone={setActiveDropZone} />
        <ConstructionZone zone="pool" title="Candidates" count={counts.pool} entries={session.pool} cardMap={cardMap} emptyText="No sideboard candidates remain." onMoveStack={handleMoveStack} draggedStack={draggedStack} activeDropZone={activeDropZone} onDragStart={setDraggedStack} onDragEnd={endStackDrag} setActiveDropZone={setActiveDropZone} />
        <ConstructionZone zone="setAside" title="Set Aside" count={counts.setAside} entries={session.setAside} cardMap={cardMap} emptyText="No cards have been excluded." tone="aside" onMoveStack={handleMoveStack} draggedStack={draggedStack} activeDropZone={activeDropZone} onDragStart={setDraggedStack} onDragEnd={endStackDrag} setActiveDropZone={setActiveDropZone} />
      </div>
    </div>
  );
}

function LegacyUpgradesTab({ analysis, analysisReady }) {
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

function UpgradesTab({ analysis, analysisReady }) {
  const candidateAdds = useMemo(() => {
    const byName = new Map();
    for (const candidate of [...(analysis.sideboardAnalysis || []), ...(analysis.consideringAnalysis || [])]) {
      const key = normalizeName(candidate.name);
      const existing = byName.get(key);
      if (!existing || (candidate.recommendation === "add" && existing.recommendation !== "add")) byName.set(key, candidate);
    }
    return [...byName.values()];
  }, [analysis.consideringAnalysis, analysis.sideboardAnalysis]);
  const groups = ["add", "maybe", "skip"].map((recommendation) => ({
    recommendation,
    label: recommendation === "add" ? "Add" : recommendation === "maybe" ? "Maybe" : "Skip",
    cards: candidateAdds.filter((candidate) => candidate.recommendation === recommendation),
  }));

  return (
    <div className="space-y-3 sm:space-y-4">
      <section className={panelClass("p-4 sm:p-5")}>
        <div className="text-[11px] uppercase tracking-wide text-neutral-500">Recommended Swaps</div>
        <div className="mt-3 space-y-3">
          {(analysis.upgrades || []).length
            ? analysis.upgrades.map((upgrade) => (
              <article key={`${upgrade.cut}-${upgrade.add}`} className="rounded-lg border border-neutral-800 bg-neutral-950 p-3 sm:p-4">
                <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                  <div><div className="text-xs text-neutral-500">Cut</div><div className="font-semibold text-rose-200">{upgrade.cut}</div><div className={`text-xs font-mono ${analysisReady ? scoreColor(upgrade.cutScore) : "text-neutral-400"}`}>{analysisReady ? `${upgrade.cutScore > 0 ? "+" : ""}${upgrade.cutScore}` : "Calculating..."}</div></div>
                  <div className="text-neutral-600">to</div>
                  <div><div className="text-xs text-neutral-500">Add</div><div className="font-semibold text-emerald-200">{upgrade.add}</div></div>
                </div>
                <p className="mt-3 text-sm text-neutral-300">{upgrade.reason}</p>
              </article>
            ))
            : <div className="rounded border border-neutral-800 bg-neutral-950 p-3 text-sm text-neutral-500">No add-and-cut pair is available yet.</div>}
        </div>
      </section>

      <section className={panelClass("p-4 sm:p-5")}>
        <div className="text-[11px] uppercase tracking-wide text-neutral-500">Suggested Cards</div>
        <div className="mt-3 grid gap-3 lg:grid-cols-3">
          {groups.map((group) => (
            <div key={group.recommendation} className="rounded-lg border border-neutral-800 bg-neutral-950 p-3">
              <div className={`text-sm font-semibold ${group.recommendation === "add" ? "text-emerald-200" : group.recommendation === "skip" ? "text-neutral-500" : "text-amber-200"}`}>{group.label}</div>
              <div className="mt-3 space-y-2">
                {group.cards.length
                  ? group.cards.map((candidate) => <div key={candidate.name} className="rounded border border-neutral-800 bg-neutral-900/60 p-2"><div className="font-semibold text-neutral-100">{candidate.name}</div><p className="mt-1 text-xs leading-5 text-neutral-400">{candidate.benefit || candidate.reason}</p></div>)
                  : <div className="text-sm text-neutral-600">None.</div>}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function HandCard({ item }) {
  return (
    <article className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950">
      <PreviewableCardImage
        card={item.card}
        name={item.name}
        className="aspect-[5/7] w-full object-cover"
        fallbackClassName="flex aspect-[5/7] w-full items-center justify-center bg-neutral-900 p-3 text-center text-xs text-neutral-500"
      />
      <div className="flex flex-1 flex-col gap-2 p-2.5">
        <div className="text-sm font-semibold leading-tight text-neutral-100">{item.name}</div>
        <div className="mt-auto flex flex-wrap gap-1">
          {item.roles.slice(0, 3).map((role) => <RoleChip key={role} role={role} />)}
        </div>
      </div>
    </article>
  );
}

function LegacyMulliganTab({ analysis, deck, cardMap, coreCards }) {
  const [attempts, setAttempts] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [manualHand, setManualHand] = useState([]);
  const [cardSearch, setCardSearch] = useState("");
  const attemptNumber = useRef(0);

  const recordHand = (hand, source) => {
    const result = analyzeOpeningHand({ deck, hand, cardMap, analysis, coreCards });
    attemptNumber.current += 1;
    const attempt = { id: attemptNumber.current, hand, result, source };
    setAttempts((current) => [attempt, ...current].slice(0, 8));
    setSelectedId(attempt.id);
  };

  const drawHand = () => recordHand(drawOpeningHand(deck), "Random draw");
  const analyzeManualHand = () => {
    if (manualHand.length !== 7) return;
    recordHand(manualHand, "Selected hand");
  };

  const selectedCounts = useMemo(() => manualHand.reduce((counts, entry) => {
    const key = normalizeName(entry.name);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {}), [manualHand]);
  const cardChoices = useMemo(() => {
    const query = normalizeName(cardSearch);
    return [...(deck.main || [])]
      .filter((entry) => !query || normalizeName(entry.name).includes(query))
      .sort((left, right) => left.name.localeCompare(right.name))
      .slice(0, 12);
  }, [cardSearch, deck.main]);

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

      <section className={panelClass("p-4 sm:p-5")}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">Use the cards you actually drew</div>
            <h3 className="mt-1 text-xl font-bold text-neutral-50">Select your opening hand</h3>
            <p className="mt-2 text-sm text-neutral-400">Choose exactly seven cards from this deck. Available copies follow the quantities in the imported decklist.</p>
          </div>
          <span aria-live="polite" className={`shrink-0 rounded-lg border px-3 py-2 font-mono text-sm ${manualHand.length === 7 ? statusClasses("good") : "border-neutral-700 bg-neutral-950 text-neutral-300"}`}>{manualHand.length}/7 selected</span>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)]">
          <div>
            <label htmlFor="opening-hand-search" className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Find a card in your deck</label>
            <input
              id="opening-hand-search"
              type="search"
              value={cardSearch}
              onChange={(event) => setCardSearch(event.target.value)}
              placeholder="Search by card name"
              className="mt-2 min-h-11 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-sm text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-amber-500"
            />
            <div className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1">
              {cardChoices.map((entry) => {
                const selectedCount = selectedCounts[normalizeName(entry.name)] || 0;
                const quantity = Math.max(0, Number(entry.qty) || 0);
                const unavailable = manualHand.length >= 7 || selectedCount >= quantity;
                return (
                  <div key={entry.name} className="flex items-center justify-between gap-3 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2">
                    <div className="min-w-0">
                      <CardPreview card={findCard(cardMap, entry.name)} name={entry.name} />
                      <div className="mt-1 font-mono text-[11px] text-neutral-500">{selectedCount}/{quantity} selected</div>
                    </div>
                    <button type="button" disabled={unavailable} onClick={() => setManualHand((current) => addCardToOpeningHand(deck, current, entry.name))} className="min-h-9 shrink-0 rounded-lg border border-amber-700 px-3 text-sm font-semibold text-amber-200 hover:bg-amber-950/40 disabled:cursor-not-allowed disabled:border-neutral-800 disabled:text-neutral-600">
                      Add
                    </button>
                  </div>
                );
              })}
              {cardChoices.length === 0 && <div className="rounded-lg border border-dashed border-neutral-800 p-5 text-center text-sm text-neutral-500">No cards in this deck match that search.</div>}
            </div>
          </div>

          <div className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Your seven</div>
            <div className="mt-3 space-y-2">
              {manualHand.map((entry, index) => (
                <div key={`${entry.name}-${entry.copyIndex}`} className="flex min-h-10 items-center justify-between gap-3 rounded-lg border border-neutral-800 bg-neutral-900/60 px-3 py-2">
                  <CardPreview card={findCard(cardMap, entry.name)} name={entry.name} />
                  <button type="button" onClick={() => setManualHand((current) => removeCardFromOpeningHand(current, index))} className="rounded px-2 py-1 text-xs font-semibold text-neutral-400 hover:bg-neutral-800 hover:text-red-300" aria-label={`Remove ${entry.name} from opening hand`}>Remove</button>
                </div>
              ))}
              {Array.from({ length: Math.max(0, 7 - manualHand.length) }, (_, index) => <div key={`empty-${index}`} className="flex min-h-10 items-center rounded-lg border border-dashed border-neutral-800 px-3 text-xs text-neutral-600">Empty card slot</div>)}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button type="button" disabled={manualHand.length === 0} onClick={() => setManualHand([])} className="min-h-11 rounded-lg border border-neutral-700 px-3 text-sm font-semibold text-neutral-300 hover:bg-neutral-900 disabled:cursor-not-allowed disabled:text-neutral-700">Clear</button>
              <button type="button" disabled={manualHand.length !== 7} onClick={analyzeManualHand} className="min-h-11 rounded-lg bg-emerald-500 px-3 text-sm font-bold text-neutral-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-neutral-800 disabled:text-neutral-500">Analyze selected hand</button>
            </div>
          </div>
        </div>
      </section>

      {!result ? (
        <section className={panelClass("p-8 text-center")}>
          <div className="text-lg font-semibold text-neutral-200">Ready for a first hand</div>
          <div className="mt-2 text-sm text-neutral-500">Draw a random seven or select the cards you actually drew to grade the hand and find what would best hold it together.</div>
        </section>
      ) : (
        <>
          <section className={panelClass("p-4 sm:p-5")}>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="text-[11px] uppercase tracking-wide text-neutral-500">{selected.source} · Attempt {selected.id}</div>
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
                <span className="font-semibold">#{attempt.id} {attempt.source} · {attempt.result.verdict.label}</span>
                <span className="ml-2 font-mono text-xs text-neutral-500">{attempt.result.score}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function MulliganResult({ selected, result, cardMap }) {
  if (!result) {
    return (
      <section className={panelClass("p-8 text-center")}>
        <div className="text-lg font-semibold text-neutral-200">Ready for a first hand</div>
        <div className="mt-2 text-sm text-neutral-500">Draw a random seven or switch to Manual Hand to grade the cards you actually drew.</div>
      </section>
    );
  }

  return (
    <>
      <section className={panelClass("p-4 sm:p-5")}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">{selected.source} · Attempt {selected.id}</div>
            <div className="mt-1 flex flex-wrap items-center gap-3"><h3 className="text-3xl font-bold text-neutral-50">{result.verdict.label}</h3><span className={`rounded-lg border px-3 py-1 font-mono text-lg font-bold ${statusClasses(result.verdict.status)}`}>{result.score}/100</span></div>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            <Metric label="Sources" value={result.metrics.coloredSources} tone={result.metrics.coloredSources >= 2 && result.metrics.coloredSources <= 4 ? "good" : "bad"} sub={`${result.metrics.lands} lands`} />
            <Metric label="Early" value={result.metrics.earlyPlays} tone={result.metrics.earlyPlays >= 2 ? "good" : "warn"} />
            <Metric label="Ramp" value={result.metrics.ramp} />
            <Metric label="Flow" value={result.metrics.cardFlow} />
            <Metric label="Answers" value={result.metrics.interaction} />
            <Metric label="Engine" value={result.metrics.engineAccess} />
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">{result.cards.map((item, index) => <HandCard key={`${item.name}-${item.copyIndex ?? index}-${index}`} item={item} />)}</div>
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-emerald-900/70 bg-emerald-950/20 p-4"><div className="text-xs font-semibold uppercase tracking-wide text-emerald-300">What works</div><div className="mt-3 space-y-2 text-sm text-neutral-300">{result.strengths.length ? result.strengths.map((item) => <div key={item}>• {item}</div>) : <div>No clear structural strength was detected.</div>}</div></div>
          <div className="rounded-lg border border-amber-900/70 bg-amber-950/20 p-4"><div className="text-xs font-semibold uppercase tracking-wide text-amber-300">Keep risk</div><div className="mt-3 space-y-2 text-sm text-neutral-300">{result.concerns.length ? result.concerns.map((item) => <div key={item}>• {item}</div>) : <div>No major opening-hand weakness was detected.</div>}</div></div>
        </div>
      </section>

      {result.glueNeeds.length > 0 && (
        <section className={panelClass("p-4 sm:p-5")}>
          <div className="text-[11px] uppercase tracking-wide text-neutral-500">What this hand is missing</div>
          <h3 className="mt-1 text-xl font-bold text-neutral-50">What would improve this hand</h3>
          <p className="mt-2 text-sm text-neutral-400">{result.glueSummary}</p>
          <div className="mt-4 grid gap-3 lg:grid-cols-3">
            {result.glueNeeds.map((need) => (
              <article key={need.key} className="rounded-lg border border-neutral-800 bg-neutral-950 p-4">
                <div className="font-semibold text-neutral-100">{need.label}</div>
                <div className="mt-2 text-sm text-neutral-300">{need.detail}</div>
                <div className="mt-2 text-xs text-neutral-500">Best replacement result: {need.examples[0]?.resultingScore ?? result.score}/100</div>
                <div className="mt-4 text-[11px] uppercase tracking-wide text-neutral-500">Examples from this deck</div>
                <div className="mt-2 space-y-2">{need.examples.map((example) => <div key={example.name} className="flex items-center justify-between gap-3 rounded border border-neutral-800 bg-neutral-900/60 px-2.5 py-2"><CardPreview card={findCard(cardMap, example.name)} name={example.name} /><span className="shrink-0 font-mono text-xs text-emerald-300">Result {example.resultingScore}/100</span></div>)}</div>
              </article>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function MulliganTab({ analysis, deck, cardMap, coreCards }) {
  const [mode, setMode] = useState("random");
  const [attempts, setAttempts] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [manualHand, setManualHand] = useState([]);
  const [cardSearch, setCardSearch] = useState("");
  const attemptNumber = useRef(0);

  const recordHand = (hand, source) => {
    const result = analyzeOpeningHand({ deck, hand, cardMap, analysis, coreCards });
    attemptNumber.current += 1;
    const attempt = { id: attemptNumber.current, hand, result, source };
    setAttempts((current) => [attempt, ...current].slice(0, 8));
    setSelectedId(attempt.id);
  };
  const drawHand = () => recordHand(drawOpeningHand(deck), "Random hand");
  const analyzeManualHand = () => manualHand.length === 7 && recordHand(manualHand, "Manual hand");
  const selectedCounts = useMemo(() => manualHand.reduce((counts, entry) => ({ ...counts, [normalizeName(entry.name)]: (counts[normalizeName(entry.name)] || 0) + 1 }), {}), [manualHand]);
  const cardChoices = useMemo(() => {
    const query = normalizeName(cardSearch);
    return [...(deck.main || [])].filter((entry) => !query || normalizeName(entry.name).includes(query)).sort((left, right) => left.name.localeCompare(right.name)).slice(0, 12);
  }, [cardSearch, deck.main]);
  const selected = attempts.find((attempt) => attempt.id === selectedId) || attempts[0];
  const result = selected?.result;

  return (
    <div className="space-y-5">
      <section className={panelClass("p-4 sm:p-5")}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">First-hand testing</div>
            <h3 className="mt-1 text-2xl font-bold text-neutral-50">Opening Hand Lab</h3>
            <p className="mt-2 max-w-2xl text-sm text-neutral-400">Random Hands reshuffle the full main deck. Manual Hand grades the seven cards you selected.</p>
          </div>
          <div className="inline-flex w-fit rounded-lg border border-neutral-800 bg-neutral-950 p-1">
            {[{ id: "random", label: "Random Hand" }, { id: "manual", label: "Manual Hand" }].map((option) => <button key={option.id} type="button" onClick={() => setMode(option.id)} className={`min-h-10 rounded px-3 py-2 text-sm font-semibold ${mode === option.id ? "bg-amber-500 text-neutral-950" : "text-neutral-400 hover:text-neutral-100"}`}>{option.label}</button>)}
          </div>
        </div>
        {mode === "random" && <button type="button" onClick={drawHand} className="mt-4 min-h-12 rounded-lg bg-amber-500 px-5 py-3 font-bold text-neutral-950 hover:bg-amber-400">{attempts.length ? "Draw fresh seven" : "Draw opening hand"}</button>}
        {mode === "manual" && <div className="mt-4 text-sm text-neutral-400">Select exactly seven cards, then analyze that hand.</div>}
      </section>

      <MulliganResult selected={selected} result={result} cardMap={cardMap} />

      {mode === "manual" && (
        <section className={panelClass("p-4 sm:p-5")}>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><div className="text-[11px] uppercase tracking-wide text-neutral-500">Manual Hand</div><h3 className="mt-1 text-xl font-bold text-neutral-50">Select your seven</h3></div><span aria-live="polite" className={`shrink-0 rounded-lg border px-3 py-2 font-mono text-sm ${manualHand.length === 7 ? statusClasses("good") : "border-neutral-700 bg-neutral-950 text-neutral-300"}`}>{manualHand.length}/7 selected</span></div>
          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)]">
            <div><label htmlFor="opening-hand-search" className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Find a card in your deck</label><input id="opening-hand-search" type="search" value={cardSearch} onChange={(event) => setCardSearch(event.target.value)} placeholder="Search by card name" className="mt-2 min-h-11 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-sm text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-amber-500" /><div className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1">{cardChoices.map((entry) => { const selectedCount = selectedCounts[normalizeName(entry.name)] || 0; const unavailable = manualHand.length >= 7 || selectedCount >= (Number(entry.qty) || 0); return <div key={entry.name} className="flex items-center justify-between gap-3 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2"><div className="min-w-0"><CardPreview card={findCard(cardMap, entry.name)} name={entry.name} /><div className="mt-1 font-mono text-[11px] text-neutral-500">{selectedCount}/{entry.qty} selected</div></div><button type="button" disabled={unavailable} onClick={() => setManualHand((current) => addCardToOpeningHand(deck, current, entry.name))} className="min-h-9 shrink-0 rounded-lg border border-amber-700 px-3 text-sm font-semibold text-amber-200 hover:bg-amber-950/40 disabled:cursor-not-allowed disabled:border-neutral-800 disabled:text-neutral-600">Add</button></div>; })}</div></div>
            <div className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-3"><div className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Seven-slot hand</div><div aria-label={`${manualHand.length} of 7 selected hand slots`} className="mt-3 grid grid-cols-7 gap-1">{Array.from({ length: 7 }, (_, index) => { const entry = manualHand[index]; return <div key={entry ? `${entry.name}-${entry.copyIndex}` : `slot-${index}`} className={`aspect-[5/7] min-w-0 rounded border p-1 text-[9px] leading-tight ${entry ? "border-amber-700 bg-neutral-900 text-neutral-200" : "border-dashed border-neutral-700 bg-neutral-950 text-neutral-700"}`}>{entry ? <><div className="line-clamp-4">{entry.name}</div><button type="button" onClick={() => setManualHand((current) => removeCardFromOpeningHand(current, index))} className="mt-1 text-[9px] text-rose-300">Remove</button></> : null}</div>; })}</div><div className="mt-3 grid grid-cols-2 gap-2"><button type="button" disabled={manualHand.length === 0} onClick={() => setManualHand([])} className="min-h-11 rounded-lg border border-neutral-700 px-3 text-sm font-semibold text-neutral-300 hover:bg-neutral-900 disabled:cursor-not-allowed disabled:text-neutral-700">Clear</button><button type="button" disabled={manualHand.length !== 7} onClick={analyzeManualHand} className="min-h-11 rounded-lg bg-emerald-500 px-3 text-sm font-bold text-neutral-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-neutral-800 disabled:text-neutral-500">Analyze hand</button></div></div>
          </div>
        </section>
      )}

      {attempts.length > 1 && <section className={panelClass("p-4 sm:p-5")}><div className="text-[11px] uppercase tracking-wide text-neutral-500">Recent independent attempts</div><div className="mt-3 flex flex-wrap gap-2">{attempts.map((attempt) => <button key={attempt.id} type="button" onClick={() => setSelectedId(attempt.id)} className={`rounded-lg border px-3 py-2 text-left text-sm ${selected?.id === attempt.id ? "border-amber-500 bg-amber-950/30 text-amber-100" : "border-neutral-800 bg-neutral-950 text-neutral-300"}`}><span className="font-semibold">#{attempt.id} {attempt.source} · {attempt.result.verdict.label}</span><span className="ml-2 font-mono text-xs text-neutral-500">{attempt.result.score}</span></button>)}</div></section>}
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

function TabIcon({ tabId }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0">
      {(TAB_ICON_PATHS[tabId] || []).map((path) => <path key={path} d={path} />)}
    </svg>
  );
}

function TabButton({ tab, activeTab, setActiveTab, mobile = false, vertical = false }) {
  const sizeClass = mobile ? "min-h-12 min-w-0 justify-center px-1 py-2 text-xs" : vertical ? "min-h-9 w-full justify-start px-2.5 py-1.5 text-left text-[13px]" : "min-h-10 px-3 py-2 text-sm";
  return (
    <button
      key={tab.id}
      type="button"
      data-mobile-tab={mobile ? tab.id : undefined}
      data-desktop-tab={vertical ? tab.id : undefined}
      aria-current={activeTab === tab.id ? "page" : undefined}
      onClick={() => setActiveTab(tab.id)}
      className={`${sizeClass} inline-flex shrink-0 items-center ${vertical ? "gap-1.5" : "gap-2"} rounded-lg font-semibold ${activeTab === tab.id ? "bg-amber-500 text-neutral-950" : "text-neutral-400 hover:bg-neutral-900 hover:text-neutral-100"}`}
    >
      <TabIcon tabId={tab.id} />
      <span>{tab.label}</span>
    </button>
  );
}

function DesktopSidebar({ activeTab, setActiveTab, inputProps }) {
  return (
    <aside className="sticky top-0 z-40 hidden h-screen flex-col border-r border-neutral-800 bg-neutral-950/95 lg:flex">
      <div className="border-b border-neutral-800 p-2">
        <InputControls {...inputProps} compact showTitle={false} sidebar />
      </div>
      <nav aria-label="Analysis sections" className="min-h-0 flex-1 overflow-y-auto p-2">
        <div className="space-y-3">
          {TAB_GROUPS.map((group) => (
            <section key={group.id}>
              <div className="px-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-600">{group.label}</div>
              <div className="space-y-1">{group.tabs.map((tab) => <TabButton key={tab.id} tab={tab} activeTab={activeTab} setActiveTab={setActiveTab} vertical />)}</div>
            </section>
          ))}
          {SHOW_DEBUG && <section><div className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-600">Development</div><TabButton tab={{ id: "debug", label: "Debug" }} activeTab={activeTab} setActiveTab={setActiveTab} vertical /></section>}
        </div>
      </nav>
    </aside>
  );
}

function TabletTabNav({ activeTab, setActiveTab }) {
  return (
    <nav aria-label="Section groups" className="sticky top-0 z-20 -mx-3 hidden grid-cols-4 gap-2 border-b border-neutral-800 bg-neutral-950/95 px-3 py-2 backdrop-blur sm:-mx-5 sm:px-5 md:grid lg:hidden">
      <TabButton tab={{ id: "scorecard", label: "Home" }} activeTab={activeTab} setActiveTab={setActiveTab} />
      <details className="relative">
        <summary className="flex min-h-10 cursor-pointer list-none items-center justify-center rounded-lg px-3 py-2 text-sm font-semibold text-neutral-400 hover:bg-neutral-900 hover:text-neutral-100">Analysis</summary>
        <div className="absolute right-0 z-30 mt-1 grid min-w-44 gap-1 rounded-lg border border-neutral-700 bg-neutral-950 p-1 shadow-xl">
          {TAB_GROUPS[0].tabs.filter((tab) => tab.id !== "scorecard").map((tab) => <TabButton key={tab.id} tab={tab} activeTab={activeTab} setActiveTab={setActiveTab} />)}
        </div>
      </details>
      {TAB_GROUPS.filter((group) => group.id !== "analysis").map((group) => (
        <details key={group.id} className="relative">
          <summary className="flex min-h-10 cursor-pointer list-none items-center justify-center rounded-lg px-3 py-2 text-sm font-semibold text-neutral-400 hover:bg-neutral-900 hover:text-neutral-100">{group.label}</summary>
          <div className="absolute left-0 z-30 mt-1 grid min-w-44 gap-1 rounded-lg border border-neutral-700 bg-neutral-950 p-1 shadow-xl">
            {group.tabs.map((tab) => <TabButton key={tab.id} tab={tab} activeTab={activeTab} setActiveTab={setActiveTab} />)}
          </div>
        </details>
      ))}
    </nav>
  );
}

function MobileTabBar({ activeTab, setActiveTab }) {
  const primaryTabs = [
    { id: "scorecard", label: "Home" },
    { id: "construct", label: "Build" },
    { id: "mulligan", label: "Mulligan" },
    { id: "cuts", label: "Cuts" },
  ];
  const moreTabs = TABS.filter((tab) => !primaryTabs.some((primary) => primary.id === tab.id));

  return (
    <nav aria-label="Mobile sections" className="fixed inset-x-0 bottom-0 z-50 grid grid-cols-5 gap-1 border-t border-neutral-800 bg-neutral-950/95 px-2 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-2 shadow-2xl backdrop-blur md:hidden">
      {primaryTabs.map((tab) => <TabButton key={tab.id} tab={tab} activeTab={activeTab} setActiveTab={setActiveTab} mobile />)}
      <details className="relative">
        <summary className={`flex min-h-12 cursor-pointer list-none items-center justify-center rounded-lg px-2 py-2 text-xs font-semibold ${moreTabs.some((tab) => tab.id === activeTab) ? "bg-amber-500 text-neutral-950" : "text-neutral-400 hover:bg-neutral-900 hover:text-neutral-100"}`}>More</summary>
        <div className="absolute bottom-full right-0 z-30 mb-2 grid min-w-44 gap-1 rounded-lg border border-neutral-700 bg-neutral-950 p-1 shadow-xl">
          {moreTabs.map((tab) => <TabButton key={tab.id} tab={tab} activeTab={activeTab} setActiveTab={setActiveTab} />)}
        </div>
      </details>
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

function Dashboard({ analysis, deck, cardMap, notFound, cardDataLoading, cardDataProgress, activeTab, setActiveTab, analysisSettings, setAnalysisSettings, coreCards, toggleCoreCard, constructionSession, onConstructionAction }) {
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
        {(cardDataLoading || notFound.length > 0) && (
          <div className="space-y-4">
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
          </div>
        )}

        <TabletTabNav activeTab={activeTab} setActiveTab={setActiveTab} />

        {activeTab === "scorecard" && (
          <header className="space-y-4">
            <HomeDeckHeader deck={deck} coreCards={coreCards} toggleCoreCard={toggleCoreCard} />
            <SummaryStrip analysis={analysis} deck={deck} analysisReady={analysisReady} />
          </header>
        )}

        {activeTab === "construct" ? (
          <DeckConstructionTab analysis={analysis} deck={deck} cardMap={cardMap} session={constructionSession} onAction={onConstructionAction} analysisReady={analysisReady} />
        ) : !analysisReady ? (
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
            {SHOW_DEBUG && activeTab === "debug" && <DebugTab analysis={analysis} deck={deck} cardMap={cardMap} notFound={notFound} />}
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
  const [deckUrl, setDeckUrl] = useState("");
  const [remoteAnalysis, setRemoteAnalysis] = useState(null);
  const [deckModel, setDeckModel] = useState(null);
  const [cardMap, setCardMap] = useState({});
  const [notFound, setNotFound] = useState([]);
  const [analysisSettings, setAnalysisSettings] = useState(DEFAULT_ANALYSIS_SETTINGS);
  const [coreCards, setCoreCards] = useState([]);
  const [constructionSession, setConstructionSession] = useState(null);
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
  const constructionSessionRef = useRef(null);
  const constructionRevisionRef = useRef(0);

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

    const parsedDeck = parseDecklist(deckText, { commanderInput: commanderText, companionInput: companionText });
    if (!parsedDeck.commanders.length) throw new Error("Could not identify a commander.");
    if (!parsedDeck.main.length) throw new Error("No main-deck cards parsed.");

    const nextConstructionSession = createConstructionSession(parsedDeck);
    const allNames = deckLookupNames(parsedDeck);
    const seedResults = seedScryfallResults(allNames);
    const seededDeck = validateCommandZone(parsedDeck, seedResults, findCard, getCardText);

    const runId = analysisRunIdRef.current + 1;
    analysisRunIdRef.current = runId;
    setRemoteAnalysis(null);
    setNotFound([]);
    setCardDataLoading(false);
    setCardDataProgress("");
    constructionSessionRef.current = nextConstructionSession;
    constructionRevisionRef.current += 1;
    setConstructionSession(nextConstructionSession);

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
        const constructedDeck = applyConstructionSession(validatedDeck, constructionSessionRef.current);
        setCardMap(scryfall.results);
        setNotFound(scryfall.notFound);
        setDeckModel(constructedDeck);
        setCoreCards((current) => current.filter((name) => constructedDeck.main.some((entry) => normalizeName(entry.name) === normalizeName(name))));
        setCardDataProgress(scryfall.notFound.length
          ? `Loaded card data with ${scryfall.notFound.length} unmatched card${scryfall.notFound.length === 1 ? "" : "s"}.`
          : `Loaded card data for ${allNames.length} unique cards.`);

        const analysisRevision = constructionRevisionRef.current;
        const nextRemoteAnalysis = await runRemoteAnalysis(buildAnalysisPrompt(constructedDeck, scryfall.results));
        if (analysisRunIdRef.current === runId && constructionRevisionRef.current === analysisRevision) setRemoteAnalysis(nextRemoteAnalysis);
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

  const importDeckUrl = useCallback(async (inputUrl, options = {}) => {
    const targetUrl = String(inputUrl || "").trim();
    if (!targetUrl || importInFlightRef.current === targetUrl) return;
    importInFlightRef.current = targetUrl;
    lastAutoImportRef.current = targetUrl;
    setLoading(true);
    setError(null);
    setDeckUrl(targetUrl);
    try {
      setProgress(options.auto ? "Importing deck..." : "Fetching deck...");

      const res = await fetch(`/api/import/deck?url=${encodeURIComponent(targetUrl)}`);
      const data = await res.json();
      if (!res.ok || data.error) {
        const detail = data.details?.length ? ` ${data.details.join(" ")}` : "";
        throw new Error(`${data.error || "Deck import failed."}${detail}`);
      }

      const importedCommanderInput = data.commanders?.length ? data.commanders.join(" + ") : cmdInput;
      const importedCompanionInput = data.companions?.length ? data.companions[0] : companionInput;
      const importedDeckText = data.deckText || "";

      setProgress("Analyzing imported deck...");
      await analyzeDeckValues({
        deckText: importedDeckText,
        commanderText: importedCommanderInput,
        companionText: importedCompanionInput,
      });
      if (data.commanders?.length) setCmdInput(importedCommanderInput);
      if (data.companions?.length) setCompanionInput(importedCompanionInput);
      setDeckInput(importedDeckText);
      setSidePanelOpen(false);
    } catch (importError) {
      setError(importError.message);
    } finally {
      importInFlightRef.current = "";
      setLoading(false);
      setProgress("");
    }
  }, [analyzeDeckValues, cmdInput, companionInput]);

  const handleDeckImport = useCallback(() => {
    return importDeckUrl(deckUrl);
  }, [deckUrl, importDeckUrl]);

  const handleDeckPaste = useCallback((event) => {
    const url = extractSupportedDeckUrl(event.clipboardData?.getData("text") || "");
    if (!url) return;
    event.preventDefault();
    lastAutoImportRef.current = url;
    importDeckUrl(url, { auto: true });
  }, [importDeckUrl]);

  const handleConstructionAction = useCallback((action) => {
    const current = constructionSessionRef.current;
    if (!current) return current;

    let next = current;
    if (action.type === "add") next = addCandidateToMain(current, action.name);
    else if (action.type === "addCandidateLands") next = addCandidateLandsToMain(current, action.names);
    else if (action.type === "moveStack") next = moveConstructionStack(current, action);
    else if (action.type === "moveMainToPool") next = moveMainToCandidatePool(current);
    else if (action.type === "setAside") next = setAsideCandidates(current, action.names);
    else if (action.type === "versus") next = chooseVersusCandidate(current, action.winnerName, action.loserName);
    else if (action.type === "versusSetAside") next = setAsideVersusCandidate(current, action.chosenName, action.otherName);
    else if (action.type === "versusComparison") next = chooseVersusComparison(current, action.chosen, action.other);
    else if (action.type === "versusComparisonSetAside") next = setAsideVersusComparison(current, action.chosen, action.other);
    else if (action.type === "neitherSetAside") next = setAsideVersusPair(current, action.cards);
    else if (action.type === "undo") next = undoConstructionAction(current);
    else if (action.type === "restart") next = restartConstructionSession(current);
    if (next === current) return next;

    const zonesChanged = next.main !== current.main || next.pool !== current.pool || next.setAside !== current.setAside;
    constructionSessionRef.current = next;
    setConstructionSession(next);
    if (!zonesChanged) return next;

    constructionRevisionRef.current += 1;
    setRemoteAnalysis(null);
    setDeckModel((currentDeck) => applyConstructionSession(currentDeck, next));
    setCoreCards((currentCards) => currentCards.filter((name) => next.main.some((entry) => normalizeName(entry.name) === normalizeName(name))));
    return next;
  }, []);

  const handleClipboardPaste = useCallback(async () => {
    setError(null);
    try {
      if (!navigator.clipboard?.readText) throw new Error("Clipboard access is not available in this browser.");
      const clipboardText = await navigator.clipboard.readText();
      const url = extractSupportedDeckUrl(clipboardText);
      if (!url) throw new Error("The clipboard does not contain a valid Moxfield or Archidekt deck link.");
      setDeckUrl(url);
      lastAutoImportRef.current = url;
      await importDeckUrl(url, { auto: true });
    } catch (clipboardError) {
      setError(clipboardError.message || "Clipboard access was blocked. Paste the deck link into the field instead.");
    }
  }, [importDeckUrl]);

  useEffect(() => {
    const url = extractSupportedDeckUrl(deckUrl);
    if (!url || url !== deckUrl.trim() || loading || lastAutoImportRef.current === url) return undefined;
    const timer = window.setTimeout(() => {
      lastAutoImportRef.current = url;
      importDeckUrl(url, { auto: true });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [deckUrl, importDeckUrl, loading]);

  const inputProps = {
    error,
    deckUrl,
    draftDeck: deckModel || draftDeck,
    loading,
    progress,
    onClipboardPaste: handleClipboardPaste,
    onImport: handleDeckImport,
    onDeckPaste: handleDeckPaste,
    setDeckUrl,
  };

  if (!analysis || !deckModel) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-950 px-4 py-10 text-neutral-100 sm:px-6">
        <main className="w-full max-w-4xl">
          <InputControls {...inputProps} fullPage />
        </main>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-neutral-950 text-neutral-100 lg:grid lg:grid-cols-[256px_minmax(0,1fr)]">
      <DesktopSidebar activeTab={activeTab} setActiveTab={setActiveTab} inputProps={inputProps} />
      <button
        type="button"
        onClick={() => setSidePanelOpen((open) => !open)}
        aria-label={sidePanelOpen ? "Close deck settings" : "Open deck settings"}
        title={sidePanelOpen ? "Close deck settings" : "Open deck settings"}
        className="absolute left-2 top-2 z-40 inline-flex h-10 w-10 flex-col items-center justify-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-900 text-neutral-100 shadow-lg hover:border-amber-500 lg:hidden"
      >
        <span className="h-0.5 w-5 rounded bg-current" />
        <span className="h-0.5 w-5 rounded bg-current" />
        <span className="h-0.5 w-5 rounded bg-current" />
      </button>
      <InputPanel
        hasAnalysis={Boolean(analysis)}
        sidePanelOpen={sidePanelOpen}
        {...inputProps}
      />
      <Dashboard analysis={analysis} deck={deckModel} cardMap={cardMap} notFound={notFound} cardDataLoading={cardDataLoading} cardDataProgress={cardDataProgress} activeTab={activeTab} setActiveTab={setActiveTab} analysisSettings={analysisSettings} setAnalysisSettings={setAnalysisSettings} coreCards={coreCards} toggleCoreCard={toggleCoreCard} constructionSession={constructionSession} onConstructionAction={handleConstructionAction} />
    </div>
  );
}
