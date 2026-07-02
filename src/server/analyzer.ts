/**
 * The per-day analysis pipeline:
 *   ManicTime activities -> 15-min timeline text
 *   + screenshot OCR samples
 *   + existing ZEP entries
 *   + monthly ZEP project list
 *   + user context notes / locked entries
 *   -> one structured LLM call -> validated, snapped suggestions -> day store
 */

import { format, parseISO } from "date-fns";
import { renderTimelineText } from "../manictime/timeline-lib.js";
import { getDayActivities } from "./manictime.js";
import { getOcrSamples } from "./screenshots.js";
import {
  getAttendancesByDay,
  toEntryViews,
  getProjectLeafListText,
  getProjectOptions,
} from "./zep.js";
import { loadDay, updateDay, emptyRecord } from "./store.js";
import { CLASSIFICATION_RULES, EDIT_RULES } from "./rules.js";
import { runAnalysis, runEditOps, type ModelTier, DEFAULT_TIER } from "./llm.js";
import type { ChatRef } from "../lib/types.js";
import { timeToMin, minToTime, snap15 } from "../lib/utils.js";
import type {
  DayRecord,
  SuggestedEntry,
  NonWorkSegment,
  ZepEntryView,
} from "../lib/types.js";

export { sanitizeEntries, sanitizeNonWork, entryStartMin, entryEndMin };

let idCounter = 0;
function newId(): string {
  idCounter = (idCounter + 1) % 1000;
  return `e${Date.now().toString(36)}${idCounter}`;
}

const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

function weekdayName(date: string): string {
  const d = parseISO(date);
  // date-fns getDay: 0=Sunday
  const idx = (d.getDay() + 6) % 7;
  return WEEKDAYS[idx];
}

const END_OF_DAY = 24 * 60 - 1; // "23:59"

function entryStartMin(t: string): number {
  return timeToMin(t);
}
function entryEndMin(t: string): number {
  return t === "23:59" ? END_OF_DAY : timeToMin(t);
}

/** Snap and sanitize LLM entries: 15-min alignment, ordering, no overlaps. */
function sanitizeEntries(
  raw: {
    from: string;
    to: string;
    project: string;
    task: string;
    subtask: string | null;
    note: string;
    billable: boolean | null;
    confidence: number;
    reasoning: string | null;
  }[],
  blocked: { from: string; to: string }[],
  validKeys: Set<string>,
  validProjects: Set<string>
): SuggestedEntry[] {
  const entries: SuggestedEntry[] = [];

  const parsed = raw
    .map((e) => {
      let fromMin = snap15(timeToMin(e.from), "down");
      let toMin = e.to === "23:59" ? END_OF_DAY : snap15(timeToMin(e.to), "up");
      if (toMin > END_OF_DAY) toMin = END_OF_DAY;
      if (fromMin < 0) fromMin = 0;
      return { ...e, fromMin, toMin };
    })
    .filter((e) => e.toMin - e.fromMin >= 14)
    .sort((a, b) => a.fromMin - b.fromMin);

  // Blocked ranges (existing ZEP entries / user-locked entries), snapped
  // OUTWARD to 15-min boundaries so trimmed suggestions stay aligned even
  // when a ZEP entry itself has odd minutes.
  const blockedRanges = blocked
    .map((b) => ({
      from: snap15(entryStartMin(b.from), "down"),
      to: Math.min(END_OF_DAY, snap15(entryEndMin(b.to), "up")),
    }))
    .sort((a, b) => a.from - b.from);

  const isLongEnough = (a: number, b: number) =>
    b - a >= 15 || (b === END_OF_DAY && b - a >= 14);

  let cursor = 0;
  for (const e of parsed) {
    // Slice [max(from,cursor), to] into segments not covered by blocked
    // ranges (a blocked range in the middle splits the entry - keep BOTH sides).
    let s = Math.max(e.fromMin, cursor);
    const segments: [number, number][] = [];
    for (const b of blockedRanges) {
      if (s >= e.toMin) break;
      if (b.to <= s) continue;
      if (b.from >= e.toMin) break;
      if (b.from > s) segments.push([s, Math.min(b.from, e.toMin)]);
      s = Math.max(s, b.to);
    }
    if (s < e.toMin) segments.push([s, e.toMin]);

    const knownProject = validProjects.has(e.project);
    const knownTask = validKeys.has(`${e.project} ${e.subtask ?? e.task}`);
    let reasoning = e.reasoning ?? undefined;
    let confidence = Math.max(0, Math.min(100, Math.round(e.confidence)));
    if (!knownProject || !knownTask) {
      confidence = Math.min(confidence, 30);
      reasoning = `${reasoning ? reasoning + " - " : ""}${
        !knownProject
          ? `project "${e.project}" not found in ZEP list`
          : `task "${e.subtask ?? e.task}" not found in project`
      }; fix before submitting`;
    }

    for (const [a, b] of segments) {
      if (!isLongEnough(a, b)) continue;
      entries.push({
        id: newId(),
        from: minToTime(a),
        to: b === END_OF_DAY ? "23:59" : minToTime(b),
        project: e.project,
        task: e.task,
        subtask: e.subtask ?? undefined,
        note: e.note,
        billable: e.billable ?? undefined,
        confidence,
        reasoning,
      });
      cursor = Math.max(cursor, b);
    }
  }
  return entries;
}

/** Does an entry overlap any of the given minute ranges? */
function overlapsAny(
  e: SuggestedEntry,
  ranges: { from: number; to: number }[]
): boolean {
  const a = entryStartMin(e.from);
  const b = entryEndMin(e.to);
  return ranges.some((r) => r.from < b && r.to > a);
}

function sanitizeNonWork(
  raw: { from: string; to: string; kind: NonWorkSegment["kind"]; note: string | null }[]
): NonWorkSegment[] {
  return raw
    .map((s) => ({
      from: minToTime(Math.max(0, snap15(timeToMin(s.from), "down"))),
      to:
        s.to === "23:59"
          ? "23:59"
          : minToTime(Math.min(24 * 60 - 15, snap15(timeToMin(s.to), "up"))),
      kind: s.kind,
      note: s.note ?? undefined,
    }))
    .filter((s) => timeToMin(s.to) > timeToMin(s.from))
    .sort((a, b) => timeToMin(a.from) - timeToMin(b.from));
}

function fmtZepEntries(entries: ZepEntryView[]): string {
  if (entries.length === 0) return "(none)";
  return entries
    .map(
      (e) =>
        `- ${e.from}-${e.to} ${e.project} / ${e.task}${e.billable ? " (billable)" : ""}${e.note ? ` — ${e.note}` : ""}`
    )
    .join("\n");
}

function fmtLocked(entries: SuggestedEntry[]): string {
  return entries
    .map(
      (e) =>
        `- ${e.from}-${e.to} ${e.project} / ${e.subtask ? `${e.task}/${e.subtask}` : e.task} — ${e.note}`
    )
    .join("\n");
}

export async function analyzeDay(
  date: string,
  tier: ModelTier = DEFAULT_TIER
): Promise<DayRecord> {
  const prior = (await loadDay(date)) ?? emptyRecord(date);
  const locked = prior.suggestions.filter((s) => s.locked);

  await updateDay(date, (r) => {
    r.status = "analyzing";
    r.error = undefined;
  });

  try {
    const today = format(new Date(), "yyyy-MM-dd");
    const isToday = date === today;

    const [dump, ocr, zepByDay, projectListText, options] = await Promise.all([
      getDayActivities(date),
      getOcrSamples(date, 30),
      getAttendancesByDay(date, date),
      getProjectLeafListText(date),
      getProjectOptions(date),
    ]);

    const timeline = renderTimelineText(dump, 15);
    const activeMinutes = Math.round(
      timeline.buckets.reduce((s, b) => s + b.activeSec, 0) / 60
    );

    if (timeline.buckets.length === 0 || activeMinutes < 10) {
      return await updateDay(date, (r) => {
        r.status = "empty";
        r.analysis = {
          analyzedAt: new Date().toISOString(),
          model: "none",
          activeMinutes,
          summary: "No meaningful computer activity recorded on this day.",
        };
      });
    }

    const zepEntries = await toEntryViews(date, zepByDay.get(date) ?? []);

    const ocrText =
      ocr
        .filter((s) => s.text.length > 0)
        .map(
          (s) =>
            `[${s.time}] ${s.text.length > 300 ? s.text.slice(0, 300) + "…" : s.text}`
        )
        .join("\n") || "(no screenshots / OCR available)";

    const prompt = [
      CLASSIFICATION_RULES,
      `\n## Day to classify\n${weekdayName(date)}, ${date}${isToday ? " (TODAY — the day is still in progress; classify only what happened so far, do not speculate about the rest)" : ""}`,
      prior.context
        ? `\n## User-provided context for this day (AUTHORITATIVE)\n${prior.context}`
        : "",
      locked.length
        ? `\n## Locked entries (already confirmed by the user — do NOT re-emit or overlap these, classify only the remaining time)\n${fmtLocked(locked)}`
        : "",
      `\n## Already tracked in ZEP (do NOT overlap these)\n${fmtZepEntries(zepEntries)}`,
      `\n## Available ZEP projects and BOOKABLE leaf tasks (use the exact task name shown — never a parent/heading)\n${projectListText}`,
      `\n## Activity timeline (15-min windows, apps + window titles + <ctx: websites/documents>)\n${timeline.text}`,
      `\n## Screenshot OCR samples\n${ocrText}`,
      `\nNow produce the timesheet entries and non-work segments for the ENTIRE active period shown above.`,
    ]
      .filter(Boolean)
      .join("\n");

    const { result, backendLabel } = await runAnalysis(prompt, tier);

    const validKeys = new Set(
      options.map((o) => `${o.projectName} ${o.taskName}`)
    );
    const validProjects = new Set(options.map((o) => o.projectName));

    const blocked = [
      ...zepEntries.map((e) => ({ from: e.from, to: e.to })),
      ...locked.map((e) => ({ from: e.from, to: e.to })),
    ];

    const suggestions = sanitizeEntries(
      result.entries,
      blocked,
      validKeys,
      validProjects
    );
    const nonWork = sanitizeNonWork(result.nonWork);

    return await updateDay(date, (r) => {
      r.status = "analyzed";
      // Re-read locked entries at WRITE time — the user may have pinned or
      // edited entries while the (slow) LLM call was running. New suggestions
      // overlapping a freshly locked entry are dropped.
      // Protect both pinned AND approved/verified entries from being wiped.
      const freshLocked = r.suggestions.filter((s) => s.locked || s.approved);
      const lockedRanges = freshLocked.map((s) => ({
        from: entryStartMin(s.from),
        to: entryEndMin(s.to),
      }));
      const kept = suggestions.filter((s) => !overlapsAny(s, lockedRanges));
      r.suggestions = [...freshLocked, ...kept].sort(
        (a, b) => timeToMin(a.from) - timeToMin(b.from)
      );
      r.nonWork = nonWork;
      r.analysis = {
        analyzedAt: new Date().toISOString(),
        model: backendLabel,
        firstActive: timeline.firstActive
          ? format(timeline.firstActive, "HH:mm")
          : undefined,
        lastActive: timeline.lastActive
          ? format(timeline.lastActive, "HH:mm")
          : undefined,
        activeMinutes,
        summary: result.summary,
        partialUntil:
          isToday && timeline.lastActive
            ? format(timeline.lastActive, "HH:mm")
            : undefined,
      };
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return await updateDay(date, (r) => {
      r.status = "error";
      r.error = message;
    });
  }
}

/* ------------------------------------------------------------------ */
/* Chat-to-edit: apply a natural-language instruction to the entries. */
/* ------------------------------------------------------------------ */

export interface EditOutcome {
  reply: string;
  suggestions: SuggestedEntry[];
  nonWork: NonWorkSegment[];
}

function fmtEntriesForEdit(
  entries: SuggestedEntry[],
  frozen: Set<number>,
  referenced: Set<number>
): string {
  if (entries.length === 0) return "(none yet)";
  return entries
    .map((e, i) => {
      const row = i + 1;
      const tags = [
        frozen.has(row) ? "[FROZEN — do not change or remove]" : "",
        referenced.has(row) ? "[USER IS REFERRING TO THIS ROW]" : "",
      ]
        .filter(Boolean)
        .join(" ");
      return `Row ${row}: ${e.from}-${e.to} | ${e.project} / ${e.subtask ? `${e.task}/${e.subtask}` : e.task}${e.billable === undefined ? "" : e.billable ? " (billable)" : " (non-bill)"} | ${e.note}${tags ? `  ${tags}` : ""}`;
    })
    .join("\n");
}

/** Snap a "HH:mm" to a 15-min boundary, keeping the "23:59" sentinel. */
function snapTimeStr(t: string, dir: "down" | "up" | "nearest" = "nearest"): string {
  if (t === "23:59") return "23:59";
  if (!/^\d{1,2}:\d{2}$/.test(t)) return t;
  return minToTime(Math.max(0, Math.min(24 * 60 - 15, snap15(timeToMin(t), dir))));
}

/** Cap confidence + annotate when a project/task pair isn't bookable. */
function validateNames(
  e: SuggestedEntry,
  validKeys: Set<string>,
  validProjects: Set<string>
): SuggestedEntry {
  const knownProject = validProjects.has(e.project);
  const knownTask = validKeys.has(`${e.project} ${e.subtask ?? e.task}`);
  if (knownProject && knownTask) return e;
  return {
    ...e,
    confidence: Math.min(e.confidence, 30),
    reasoning: `${e.reasoning ? e.reasoning + " — " : ""}${
      !knownProject
        ? `project "${e.project}" not found in ZEP list`
        : `task "${e.subtask ?? e.task}" not found in project`
    }; fix before submitting`,
  };
}

type EditOp = {
  op: "set" | "add" | "remove";
  row: number | null;
  from: string | null;
  to: string | null;
  project: string | null;
  task: string | null;
  subtask: string | null;
  note: string | null;
  billable: boolean | null;
};

/** Apply operations to the entry list, touching only the rows they name. */
function applyOperations(
  entries: SuggestedEntry[],
  ops: EditOp[],
  frozen: Set<number>,
  validKeys: Set<string>,
  validProjects: Set<string>
): { entries: SuggestedEntry[]; applied: number } {
  const list = entries.map((e) => ({ ...e }));
  const removed = new Set<number>();
  const added: SuggestedEntry[] = [];
  let applied = 0;

  for (const op of ops) {
    if (op.op === "add") {
      if (!op.from || !op.to || !op.project || !op.task) continue;
      added.push(
        validateNames(
          {
            id: newId(),
            from: snapTimeStr(op.from, "down"),
            to: op.to === "23:59" ? "23:59" : snapTimeStr(op.to, "up"),
            project: op.project,
            task: op.task,
            subtask: op.subtask ?? undefined,
            note: op.note ?? "",
            billable: op.billable ?? undefined,
            confidence: 100,
            locked: true,
            approved: false,
          },
          validKeys,
          validProjects
        )
      );
      applied++;
      continue;
    }
    const row = op.row;
    if (!row || row < 1 || row > list.length) continue;
    if (frozen.has(row)) continue; // never touch frozen rows
    if (op.op === "remove") {
      removed.add(row);
      applied++;
    } else {
      const e = list[row - 1];
      if (op.from) e.from = snapTimeStr(op.from, "nearest");
      if (op.to) e.to = op.to === "23:59" ? "23:59" : snapTimeStr(op.to, "nearest");
      if (op.project) {
        e.project = op.project;
        if (op.task) e.task = op.task;
        e.subtask = op.subtask ?? undefined;
      } else if (op.task) {
        e.task = op.task;
        e.subtask = op.subtask ?? undefined;
      }
      if (op.note != null) e.note = op.note;
      if (op.billable !== null) e.billable = op.billable;
      e.approved = false; // it changed — needs re-verification
      e.locked = true;
      list[row - 1] = validateNames(e, validKeys, validProjects);
      applied++;
    }
  }

  const result = list
    .filter((_, i) => !removed.has(i + 1))
    .concat(added)
    .sort((a, b) => timeToMin(a.from) - timeToMin(b.from));
  return { entries: result, applied };
}

/**
 * Apply a natural-language instruction to the entries as a set of targeted
 * operations. Rows the AI does not name stay byte-identical; approved rows are
 * frozen unless the user explicitly referenced them.
 */
export async function editEntries(
  date: string,
  instruction: string,
  current: { entries: SuggestedEntry[]; nonWork: NonWorkSegment[] },
  refs: ChatRef[] = [],
  tier: ModelTier = DEFAULT_TIER
): Promise<EditOutcome> {
  const record = (await loadDay(date)) ?? emptyRecord(date);
  const entries = [...current.entries].sort(
    (a, b) => timeToMin(a.from) - timeToMin(b.from)
  );

  const gapRefsPresent = refs.some((r) => r.kind === "gap");
  const [dump, zepByDay, projectListText, options] = await Promise.all([
    // Only fetch/parse the (large) timeline when the user references a gap —
    // for row edits the numbered list is enough, and a lean prompt keeps fast
    // models reliable at emitting operations.
    gapRefsPresent ? getDayActivities(date).catch(() => null) : Promise.resolve(null),
    getAttendancesByDay(date, date),
    getProjectLeafListText(date),
    getProjectOptions(date),
  ]);
  const zepEntries = await toEntryViews(date, zepByDay.get(date) ?? []);
  const timeline = dump ? renderTimelineText(dump, 15) : null;

  // referenced entry rows (1-based) — these are explicitly editable even if approved
  const refIds = new Set(refs.filter((r) => r.kind === "entry").map((r) => (r as { id: string }).id));
  const referenced = new Set<number>();
  entries.forEach((e, i) => {
    if (refIds.has(e.id)) referenced.add(i + 1);
  });
  const frozen = new Set<number>();
  entries.forEach((e, i) => {
    if (e.approved && !referenced.has(i + 1)) frozen.add(i + 1);
  });
  const gapRefs = refs.filter((r) => r.kind === "gap") as {
    from: string;
    to: string;
  }[];

  const prompt = [
    `You edit a timesheet by emitting OPERATIONS. The user reviews ${weekdayName(date)}, ${date} and gives an instruction to change SOME rows.`,
    EDIT_RULES,
    `\n## How to respond
- Emit one operation per change: "set" (modify a row by number — include only the fields that change), "add" (new entry), or "remove" (delete a row by number).
- Change ONLY what the instruction asks. Do NOT emit operations for rows you are not changing.
- NEVER set or remove a row marked [FROZEN]. Rows marked [USER IS REFERRING TO THIS ROW] are the ones the instruction is about.
- You MUST emit at least one operation to carry out the instruction — a "reply" alone changes nothing.`,
    record.context ? `\n## User context for the day\n${record.context}` : "",
    `\n## Current entries (row-numbered)\n${fmtEntriesForEdit(entries, frozen, referenced)}`,
    gapRefs.length
      ? `\n## Gaps the user referenced (likely wants "add" operations to fill these)\n${gapRefs.map((g) => `- ${g.from}-${g.to}`).join("\n")}`
      : "",
    zepEntries.length
      ? `\n## Already in ZEP (do NOT overlap)\n${fmtZepEntries(zepEntries)}`
      : "",
    `\n## Available ZEP projects and BOOKABLE leaf tasks (use the exact leaf task name — never a parent/heading)\n${projectListText}`,
    timeline ? `\n## Activity timeline for reference (15-min windows)\n${timeline.text}` : "",
    `\n## The user's instruction\n"${instruction}"`,
  ]
    .filter(Boolean)
    .join("\n");

  const { result } = await runEditOps(prompt, tier);

  const validKeys = new Set(options.map((o) => `${o.projectName} ${o.taskName}`));
  const validProjects = new Set(options.map((o) => o.projectName));

  const { entries: next, applied } = applyOperations(
    entries,
    result.operations as EditOp[],
    frozen,
    validKeys,
    validProjects
  );

  await updateDay(date, (r) => {
    r.suggestions = next;
    if (r.status === "missing" || r.status === "empty") r.status = "analyzed";
  });

  const reply =
    applied === 0
      ? `${result.reply || "No change"} (no rows changed)`
      : result.reply;
  return { reply, suggestions: next, nonWork: current.nonWork };
}
