/**
 * Shared ZEP submission logic — used by both the CLI (`submit.ts`) and the
 * web app. Resolves project/task names to IDs, validates 15-minute alignment,
 * determines billability and entry colors.
 */

import { ZepProjectStore, isBillable, isBillableUserChangeable } from "./projects.js";
import { getEnv } from "../config/env.js";
import type { CreateAttendanceInput } from "./types.js";

export interface SubmitEntry {
  date: string;
  from: string; // HH:mm:ss
  to: string; // HH:mm:ss
  project: string;
  task: string;
  subtask?: string;
  billable?: boolean;
  note?: string;
  color?: string;
}

/** Auto-assign color based on project/task classification */
export function getEntryColor(e: SubmitEntry): string {
  const proj = e.project;
  const task = e.task;

  // Scrum ceremonies (SMPAG 1.1)
  if (proj === "26__SMPAG" && task === "1.1") return "#EADFF7";

  // Non-billable admin/coordination/mail (SMPAG 2/mp, admi, etc.)
  if (proj === "26__SMPAG" && (task === "mp" || task === "admi" || task.startsWith("2")))
    return "#C0C0C0";

  // Internal / SMPAG (R&D, strategy, etc.)
  if (proj === "26__SMPAG") return "#fbb6b9";

  // deliver.media product work
  if (proj.includes("deliver.media")) return "#D9F4F9";

  // CH Media projects (A200811 SCTE, P80133 TVR, etc.)
  if (proj.startsWith("A200811") || proj.startsWith("P80133")) return "#73D8EA";

  // Any other billable
  if (e.billable) return "#86DFA7";

  // Default gray for non-billable
  return "#C0C0C0";
}

/**
 * End of day as ZEP stores it: `to` = "00:00:00" on the SAME date. ZEP now
 * enforces its minute grid, so the old "23:59:00" sentinel is rejected (422);
 * "23:59:00" is still accepted as input and converted when submitting.
 */
export const ZEP_END_OF_DAY = "00:00:00";

/** Minutes for an END time — "00:00"/"23:59" (end of day) count as 24:00. */
export function endMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  if ((h === 0 && m === 0) || (h === 23 && m === 59)) return 24 * 60;
  return h * 60 + m;
}

/**
 * Hard invariant: every time must land on a 15-minute boundary (:00/:15/:30/:45)
 * with zero seconds. End of day is "00:00:00" (or the legacy "23:59:00",
 * converted on submit). Returns an error string or null when valid.
 */
export function alignmentError(t: string, isEnd: boolean): string | null {
  if (isEnd && (t === "23:59:00" || t === ZEP_END_OF_DAY)) return null;
  const m = /^(\d{2}):(\d{2}):(\d{2})$/.exec(t);
  if (!m) return `"${t}" is not HH:mm:ss`;
  const hh = +m[1];
  const mm = +m[2];
  const ss = +m[3];
  if (hh > 23) return `"${t}" is not a valid time (ZEP rejects 24:00:00 — use 00:00:00 for end of day)`;
  if (ss !== 0) return `"${t}" has non-zero seconds`;
  if (mm % 15 !== 0) return `"${t}" is not on a 15-min boundary (:00/:15/:30/:45)`;
  return null;
}

function toMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/** Validate alignment of a batch; returns a list of human-readable problems. */
export function validateAlignment(entries: SubmitEntry[]): string[] {
  const errors: string[] = [];
  for (const e of entries) {
    for (const err of [alignmentError(e.from, false), alignmentError(e.to, true)]) {
      if (err)
        errors.push(`${e.date} ${e.from}-${e.to} (${e.project}/${e.task}): ${err}`);
    }
    if (
      /^\d{2}:\d{2}:\d{2}$/.test(e.from) &&
      /^\d{2}:\d{2}:\d{2}$/.test(e.to) &&
      endMinutes(e.to) <= toMinutes(e.from)
    ) {
      errors.push(
        `${e.date} ${e.from}-${e.to} (${e.project}/${e.task}): "to" must be after "from"`
      );
    }
  }
  return errors;
}

export interface ResolvedEntry {
  input: CreateAttendanceInput;
  warnings: string[];
}

/** One way an ambiguous task name could be booked. */
export interface TaskCandidate {
  /** Value for SubmitEntry.task (parent name when the leaf sits under one). */
  task: string;
  /** Value for SubmitEntry.subtask (the leaf name) when a parent exists. */
  subtask?: string;
  /** Display path, e.g. "1.6 musiccompanion / testing". */
  path: string;
}

/**
 * Thrown when a task name matches several leaf tasks and no candidate is a
 * clearly better fit — the caller must ask the user instead of guessing.
 */
export class AmbiguousTaskError extends Error {
  constructor(
    readonly project: string,
    readonly taskName: string,
    readonly candidates: TaskCandidate[]
  ) {
    super(
      `Task "${taskName}" is ambiguous in ${project} — candidates: ${candidates
        .map((c) => `"${c.path}"`)
        .join(", ")}. Pick one (set the parent as task and "${taskName}" as subtask).`
    );
    this.name = "AmbiguousTaskError";
  }
}

/** Normalized similarity (1 = identical) used to pick the closest parent match. */
export function nameSimilarity(a: string, b: string): number {
  const s = a.toLowerCase().trim();
  const t = b.toLowerCase().trim();
  if (!s || !t) return 0;
  if (s === t) return 1;
  if (s.includes(t) || t.includes(s)) return 0.85;
  // Levenshtein distance, normalized by the longer string.
  const d: number[] = Array.from({ length: t.length + 1 }, (_, j) => j);
  for (let i = 1; i <= s.length; i++) {
    let prev = d[0];
    d[0] = i;
    for (let j = 1; j <= t.length; j++) {
      const cur = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (s[i - 1] === t[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return 1 - d[t.length] / Math.max(s.length, t.length);
}

/**
 * Resolve one entry's project/task names to IDs using a loaded project store.
 * Throws Error with a helpful message when the project or task cannot be
 * resolved (or the task is a parent).
 */
export function resolveEntry(
  store: ZepProjectStore,
  e: SubmitEntry
): ResolvedEntry {
  const env = getEnv();
  const warnings: string[] = [];

  const proj = store.getProjects().find((p) => p.name === e.project);
  if (!proj) throw new Error(`Project not found: ${e.project}`);

  const activeTasks = store
    .getTasks(proj.id)
    .filter((t) => !t.status || t.status === "in Arbeit");

  const targetName = e.subtask ?? e.task;
  let candidates = activeTasks.filter((t) => t.name === targetName);
  const parentOf = (t: (typeof activeTasks)[number]) =>
    activeTasks.find((p) => p.id === t.parent_id);

  // When a subtask is given, the task field names the parent — use it to
  // disambiguate duplicate leaf names across different parents.
  if (e.subtask && candidates.length > 1) {
    const narrowed = candidates.filter((t) => parentOf(t)?.name === e.task);
    if (narrowed.length > 0) {
      candidates = narrowed;
    } else {
      // No exact parent match — pick the closest parent name, but only when
      // it's clearly the best fit; otherwise stay ambiguous and ask.
      const scored = candidates
        .map((t) => ({ t, score: nameSimilarity(parentOf(t)?.name ?? "", e.task) }))
        .sort((a, b) => b.score - a.score);
      if (
        scored[0].score >= 0.6 &&
        (scored.length === 1 || scored[0].score - scored[1].score >= 0.2)
      ) {
        candidates = [scored[0].t];
        warnings.push(
          `${e.project}: no parent named "${e.task}" — booked "${targetName}" under closest match "${parentOf(scored[0].t)?.name ?? "(top level)"}"`
        );
      }
    }
  }

  if (candidates.length > 1) {
    // NEVER pick silently — hours would land on the wrong ZEP task.
    throw new AmbiguousTaskError(
      e.project,
      targetName,
      candidates.map((t) => {
        const parent = parentOf(t);
        return {
          task: parent?.name ?? t.name,
          subtask: parent ? t.name : undefined,
          path: parent
            ? `${parent.name} / ${t.name}`
            : `${t.name}${t.description ? ` — ${t.description}` : ""}`,
        };
      })
    );
  }

  const resolvedTask = candidates[0];
  if (!resolvedTask) {
    throw new Error(
      `Task not found: "${targetName}" in project ${e.project} (active tasks only)`
    );
  }

  const hasChildren = activeTasks.some((t) => t.parent_id === resolvedTask.id);
  if (hasChildren) {
    const children = activeTasks
      .filter((t) => t.parent_id === resolvedTask.id)
      .map((t) => `${t.name} (${t.description || ""})`);
    throw new Error(
      `Task "${targetName}" has subtasks — book to a leaf task instead. Subtasks: ${children.join(", ")}`
    );
  }

  const projectBillable = isBillable(proj);
  const userCanChange = isBillableUserChangeable(proj);
  let billable = projectBillable;

  if (e.billable !== undefined && e.billable !== projectBillable) {
    if (!userCanChange) {
      warnings.push(
        `${e.project}: billable=${e.billable} requested but project is ${projectBillable ? "billable" : "non-billable"} (locked). Using project default.`
      );
    } else {
      warnings.push(
        `${e.project}: billable=${e.billable} overrides project default (${projectBillable ? "billable" : "non-billable"}).`
      );
      billable = e.billable;
    }
  }

  return {
    input: {
      employee_id: env.ZEP_EMPLOYEE_ID,
      date: e.date,
      from: e.from,
      to: e.to === "23:59:00" ? ZEP_END_OF_DAY : e.to,
      project_id: proj.id,
      project_task_id: resolvedTask.id,
      activity_id: "S",
      billable,
      note: e.note,
      color: e.color || getEntryColor(e),
    },
    warnings,
  };
}
