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
 * Hard invariant: every time must land on a 15-minute boundary (:00/:15/:30/:45)
 * with zero seconds. The only allowed exception is the end-of-day sentinel
 * "23:59:00" (ZEP rejects "24:00:00"/"00:00:00" as an end time).
 * Returns an error string or null when valid.
 */
export function alignmentError(t: string, isEnd: boolean): string | null {
  if (isEnd && t === "23:59:00") return null;
  const m = /^(\d{2}):(\d{2}):(\d{2})$/.exec(t);
  if (!m) return `"${t}" is not HH:mm:ss`;
  const hh = +m[1];
  const mm = +m[2];
  const ss = +m[3];
  if (hh > 23) return `"${t}" is not a valid time (ZEP rejects 24:00:00 — use 23:59:00)`;
  if (isEnd && t === "00:00:00")
    return `"00:00:00" is not a valid end time (use 23:59:00 for end of day)`;
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
      toMinutes(e.to) <= toMinutes(e.from)
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
  // When a subtask is given, the task field names the parent — use it to
  // disambiguate duplicate leaf names across different parents.
  if (e.subtask && candidates.length > 1) {
    const narrowed = candidates.filter((t) => {
      const parent = activeTasks.find((p) => p.id === t.parent_id);
      return parent?.name === e.task;
    });
    if (narrowed.length > 0) candidates = narrowed;
  }
  const resolvedTask =
    candidates.length === 1
      ? candidates[0]
      : candidates.find((t) => t.parent_id !== null) ?? candidates[0];

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
      to: e.to,
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
