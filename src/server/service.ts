/**
 * High-level services consumed by the server functions: dashboard aggregation,
 * day detail, entry editing, and the submit path.
 */

import {
  addDays,
  endOfMonth,
  format,
  parseISO,
  startOfMonth,
  subMonths,
} from "date-fns";
import {
  getDayActivities,
  getUsageRange,
} from "./manictime.js";
import { renderTimelineText, hhmm } from "../manictime/timeline-lib.js";
import { listThumbStrip } from "./screenshots.js";
import { getDayCalendar } from "./calendar.js";
import {
  getAttendancesByDay,
  toEntryViews,
  getProjectOptions,
  submitEntries,
  type WebSubmitResult,
} from "./zep.js";
import { loadAllDays, loadDay, updateDay, emptyRecord } from "./store.js";
import { queueStatus, isQueued } from "./queue.js";
import { backendSummary, type ModelTier } from "./llm.js";
import { editEntries, type EditOutcome } from "./analyzer.js";
import { timeToMin } from "../lib/utils.js";
import type {
  ChatRef,
  DashboardData,
  DayDetail,
  DayOverview,
  DayRecord,
  DayStatus,
  SuggestedEntry,
  TimelineBucket,
} from "../lib/types.js";
import type { Dump } from "../manictime/timeline-lib.js";
import { endMinutes, ZEP_END_OF_DAY, type SubmitEntry } from "../zep/submit-lib.js";

/* ------------------------------------------------------------------ */
/* Dump cache — past days are immutable, today gets a short TTL.       */
/* ------------------------------------------------------------------ */

interface DumpCacheEntry {
  at: number;
  fetchedOn: string; // "today" at fetch time — a dump fetched on its own day is partial
  dump: Dump;
}
const g = globalThis as { __tsDumpCache?: Map<string, DumpCacheEntry> };
const dumpCache = (g.__tsDumpCache ??= new Map<string, DumpCacheEntry>());

/** Drop a day's cached dump so the next load re-queries ManicTime. */
export function invalidateDayDump(date: string): void {
  dumpCache.delete(date);
}

export async function getDayDump(date: string): Promise<Dump> {
  const today = format(new Date(), "yyyy-MM-dd");
  const cached = dumpCache.get(date);
  const fresh =
    cached &&
    (date === today
      ? Date.now() - cached.at < 60_000
      : cached.fetchedOn !== date); // partial snapshot from the day itself → refetch
  if (cached && fresh) return cached.dump;

  const dump = await getDayActivities(date);
  dumpCache.set(date, { at: Date.now(), fetchedOn: today, dump });
  // simple LRU cap
  while (dumpCache.size > 12) {
    const oldest = dumpCache.keys().next().value;
    if (oldest === undefined) break;
    dumpCache.delete(oldest);
  }
  return dump;
}

/* ------------------------------------------------------------------ */
/* Dashboard                                                           */
/* ------------------------------------------------------------------ */

export function defaultRangeStart(): string {
  if (process.env.TIMESHEET_RANGE_START) return process.env.TIMESHEET_RANGE_START;
  return format(startOfMonth(subMonths(new Date(), 3)), "yyyy-MM-dd");
}

function suggestionMinutes(record: DayRecord | undefined): number {
  if (!record) return 0;
  return record.suggestions.reduce(
    (s, e) => s + Math.max(0, timeToMin(e.to) - timeToMin(e.from)),
    0
  );
}

function resolveStatus(opts: {
  record: DayRecord | null;
  activeMin: number;
  zepMin: number;
}): DayStatus {
  const { record, activeMin, zepMin } = opts;
  // "analyzing" is only real while the in-memory queue actually holds the
  // date — a stale on-disk "analyzing" (server restarted mid-queue) falls
  // through to the derived status below.
  if (record?.status === "analyzing" && isQueued(record.date)) return "analyzing";
  if (record?.status === "error") return "error";
  if (record?.status === "ignored") return "ignored";
  // A submit only fully settles the day when no suggestions are left to review.
  if (record?.submitResult && record.suggestions.length === 0) return "submitted";

  const covered = zepMin > 0 && zepMin >= activeMin * 0.6;
  if (covered) return "submitted";
  if (record && record.suggestions.length > 0) return "analyzed";
  // Analyzed with nothing left to book (all private/away, or every row
  // removed) → the day is settled, never "suggestions ready".
  if (record?.analysis && (record.status === "analyzed" || record.status === "empty"))
    return zepMin > 0 ? "submitted" : "empty";
  if (activeMin < 15) return zepMin > 0 ? "submitted" : "empty";
  if (zepMin > 0) return "partial";
  return "missing";
}

/**
 * Self-heal stale statuses: records left in "analyzing" by a dead queue
 * (server restart), and "analyzed" days with nothing left to book.
 */
async function reconcileStaleAnalyzing(record: DayRecord): Promise<DayRecord> {
  if (record.status === "analyzed" && record.suggestions.length === 0 && record.analysis) {
    return updateDay(record.date, (r) => {
      if (r.status === "analyzed" && r.suggestions.length === 0) r.status = "empty";
    });
  }
  if (record.status !== "analyzing" || isQueued(record.date)) return record;
  return updateDay(record.date, (r) => {
    r.status = r.suggestions.length > 0 ? "analyzed" : r.error ? "error" : "missing";
  });
}

export async function getDashboardData(
  rangeStart?: string
): Promise<DashboardData> {
  const start = rangeStart ?? defaultRangeStart();
  const end = format(new Date(), "yyyy-MM-dd");

  const [usage, zepByDay, records] = await Promise.all([
    getUsageRange(start, end),
    getAttendancesByDay(start, end),
    loadAllDays(),
  ]);

  const days: DayOverview[] = [];
  for (
    let d = parseISO(start);
    format(d, "yyyy-MM-dd") <= end;
    d = addDays(d, 1)
  ) {
    const date = format(d, "yyyy-MM-dd");
    const record = records.get(date) ?? null;
    const activeMin = Math.round(usage.get(date)?.activeMin ?? 0);
    const zepList = zepByDay.get(date) ?? [];
    const zepMin = zepList.reduce(
      (s, a) =>
        s + Math.max(0, endMinutes(a.to) - timeToMin(a.from.slice(0, 5))),
      0
    );

    days.push({
      date,
      weekday: (d.getDay() + 6) % 7,
      status: resolveStatus({ record, activeMin, zepMin }),
      activeMinutes: activeMin,
      zepMinutes: zepMin,
      suggestedMinutes: suggestionMinutes(record ?? undefined),
      hasContext: !!record?.context,
    });
  }

  return {
    rangeStart: start,
    rangeEnd: end,
    days,
    queue: queueStatus(),
    llmBackend: backendSummary(),
  };
}

/** Data for a single month (the dashboard shows one month at a time). */
export async function getMonthData(month?: string): Promise<import("../lib/types.js").MonthData> {
  const today = format(new Date(), "yyyy-MM-dd");
  const currentMonth = today.slice(0, 7);
  const m = /^\d{4}-\d{2}$/.test(month ?? "") ? month! : currentMonth;

  const monthStart = `${m}-01`;
  const lastDom = endOfMonth(parseISO(monthStart));
  const monthEndFull = format(lastDom, "yyyy-MM-dd");
  const monthEnd = monthEndFull > today ? today : monthEndFull;

  // Future months have nothing to show.
  const isFuture = monthStart > today;

  const [usage, zepByDay, records] = isFuture
    ? [new Map(), new Map(), await loadAllDays()]
    : await Promise.all([
        getUsageRange(monthStart, monthEnd),
        getAttendancesByDay(monthStart, monthEnd),
        loadAllDays(),
      ]);

  const days: DayOverview[] = [];
  const stats = { missing: 0, partial: 0, analyzed: 0, submitted: 0, unbookedMin: 0 };

  if (!isFuture) {
    for (
      let d = parseISO(monthStart);
      format(d, "yyyy-MM-dd") <= monthEnd;
      d = addDays(d, 1)
    ) {
      const date = format(d, "yyyy-MM-dd");
      const record = records.get(date) ?? null;
      const activeMin = Math.round((usage as Map<string, { activeMin: number }>).get(date)?.activeMin ?? 0);
      const zepList = (zepByDay as Map<string, { from: string; to: string }[]>).get(date) ?? [];
      const zepMin = zepList.reduce(
        (s, a) => s + Math.max(0, endMinutes(a.to) - timeToMin(a.from.slice(0, 5))),
        0
      );
      const status = resolveStatus({ record, activeMin, zepMin });
      days.push({
        date,
        weekday: (d.getDay() + 6) % 7,
        status,
        activeMinutes: activeMin,
        zepMinutes: zepMin,
        suggestedMinutes: suggestionMinutes(record ?? undefined),
        hasContext: !!record?.context,
      });
      if (status === "missing" || status === "error") stats.missing++;
      else if (status === "partial") stats.partial++;
      else if (status === "analyzed") stats.analyzed++;
      else if (status === "submitted") stats.submitted++;
      if (status === "missing" || status === "partial" || status === "error")
        stats.unbookedMin += Math.max(0, activeMin - zepMin);
    }
  }

  return {
    month: m,
    monthStart,
    monthEnd,
    today,
    days,
    hasPrev: true, // ManicTime may hold older data; let the user page back freely
    hasNext: m < currentMonth,
    stats,
    queue: queueStatus(),
    llmBackend: backendSummary(),
  };
}

/* ------------------------------------------------------------------ */
/* Day detail                                                          */
/* ------------------------------------------------------------------ */

export async function getDayDetail(date: string): Promise<DayDetail> {
  const today = format(new Date(), "yyyy-MM-dd");
  let record = (await loadDay(date)) ?? emptyRecord(date);
  record = await reconcileStaleAnalyzing(record);

  const [dumpResult, zepByDay, screenshots, calendar] = await Promise.allSettled([
    getDayDump(date),
    getAttendancesByDay(date, date),
    listThumbStrip(date, 1), // one per minute — thumbnails load lazily via /shot
    getDayCalendar(date),
  ]);

  let timeline: TimelineBucket[] = [];
  let gaps: { from: string; to: string; minutes: number }[] = [];
  let firstActive: string | null = null;
  let lastActive: string | null = null;
  let activeMinutes = 0;

  if (dumpResult.status === "fulfilled") {
    const t = renderTimelineText(dumpResult.value, 15);
    timeline = t.buckets.map((b) => ({
      start: hhmm(b.start),
      minutes: 15,
      activeMin: Math.round(b.activeSec / 60),
      topApps: [...b.appNames.entries()]
        .sort((a, c) => c[1] - a[1])
        .slice(0, 3)
        .map(([n]) => n),
      titles: b.titles.slice(0, 8),
      context: b.context.slice(0, 6),
    }));
    gaps = t.gaps.map((gp) => ({
      from: hhmm(gp.from),
      to: hhmm(gp.to),
      minutes: gp.minutes,
    }));
    firstActive = t.firstActive ? hhmm(t.firstActive) : null;
    lastActive = t.lastActive ? hhmm(t.lastActive) : null;
    activeMinutes = Math.round(
      t.buckets.reduce((s, b) => s + b.activeSec, 0) / 60
    );
  }

  const zepEntries =
    zepByDay.status === "fulfilled"
      ? await toEntryViews(date, zepByDay.value.get(date) ?? [])
      : [];

  return {
    record,
    timeline,
    gaps,
    firstActive,
    lastActive,
    activeMinutes,
    zepEntries,
    screenshots: screenshots.status === "fulfilled" ? screenshots.value : [],
    calendar:
      calendar.status === "fulfilled" ? calendar.value : { status: "error", events: [] },
    isToday: date === today,
  };
}

/* ------------------------------------------------------------------ */
/* Mutations                                                           */
/* ------------------------------------------------------------------ */

export async function saveContext(
  date: string,
  context: string
): Promise<DayRecord> {
  return updateDay(date, (r) => {
    r.context = context.trim() || undefined;
  });
}

export async function saveEntries(
  date: string,
  suggestions: SuggestedEntry[],
  nonWork?: DayRecord["nonWork"]
): Promise<DayRecord> {
  return updateDay(date, (r) => {
    r.suggestions = [...suggestions].sort(
      (a, b) => timeToMin(a.from) - timeToMin(b.from)
    );
    if (nonWork) r.nonWork = nonWork;
    if ((r.status === "missing" || r.status === "empty") && suggestions.length > 0)
      r.status = "analyzed";
  });
}

export async function setIgnored(
  date: string,
  ignored: boolean
): Promise<DayRecord> {
  return updateDay(date, (r) => {
    r.status = ignored ? "ignored" : r.suggestions.length ? "analyzed" : "missing";
  });
}

/** Convert "HH:mm" UI times to ZEP "HH:mm:ss". */
function toZepTime(t: string): string {
  return `${t}:00`;
}

/** One submit at a time per day — prevents duplicate POSTs on double-clicks. */
const gLocks = globalThis as { __tsSubmitLocks?: Set<string> };
const submitLocks = (gLocks.__tsSubmitLocks ??= new Set<string>());

/**
 * Submit the given entries (the exact state the user reviewed in the dialog).
 * The client sends full entry payloads so pending debounced autosaves can
 * never cause a mismatch between what was shown and what is booked.
 */
export async function submitDay(
  date: string,
  entries: SuggestedEntry[]
): Promise<{ record: DayRecord; result: WebSubmitResult }> {
  if (entries.length === 0) throw new Error("No entries selected");
  if (submitLocks.has(date))
    throw new Error(`A submit for ${date} is already in progress`);
  submitLocks.add(date);
  try {
    const submitList: SubmitEntry[] = entries.map((s) => ({
      date,
      from: toZepTime(s.from),
      to: s.to === "23:59" ? ZEP_END_OF_DAY : toZepTime(s.to),
      project: s.project,
      task: s.task,
      subtask: s.subtask,
      billable: s.billable,
      note: s.note,
    }));

    const result = await submitEntries(submitList);

    const submittedIds = new Set(
      entries.filter((_, i) => result.outcomes[i]?.outcome === "submitted").map((e) => e.id)
    );

    const updated = await updateDay(date, (r) => {
      if (result.submitted > 0) {
        r.submitResult = {
          submittedAt: new Date().toISOString(),
          submitted: result.submitted,
          skipped: result.skipped.length,
          // keep only the display fields — candidates/index are transient UI data
          errors: result.errors.map(({ entry, error }) => ({ entry, error })),
        };
        // Entries that went into ZEP are no longer suggestions to review;
        // skipped/errored ones stay visible for another attempt.
        r.suggestions = r.suggestions.filter((s) => !submittedIds.has(s.id));
        r.status = r.suggestions.length === 0 ? "submitted" : "analyzed";
      }
    });

    return { record: updated, result };
  } finally {
    submitLocks.delete(date);
  }
}

export async function getOptions(date: string) {
  return getProjectOptions(date);
}

export async function chatEditDay(
  date: string,
  instruction: string,
  current: { entries: SuggestedEntry[]; nonWork: DayRecord["nonWork"] },
  refs: ChatRef[],
  tier: ModelTier
): Promise<EditOutcome> {
  return editEntries(date, instruction, current, refs, tier);
}
