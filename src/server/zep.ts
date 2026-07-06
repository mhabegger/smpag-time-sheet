/**
 * ZEP access for the web app: singleton client, per-month project caches,
 * attendance range queries with name resolution, and the submit path.
 */

import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { ZepClient } from "../zep/client.js";
import { ZepProjectStore, isBillable } from "../zep/projects.js";
import { AttendanceManager } from "../zep/attendances.js";
import {
  AmbiguousTaskError,
  resolveEntry,
  validateAlignment,
  type SubmitEntry,
  type TaskCandidate,
} from "../zep/submit-lib.js";
import { getEnv } from "../config/env.js";
import type { ZepAttendance, CreateAttendanceInput } from "../zep/types.js";
import type { ProjectTaskOption, ZepEntryView } from "../lib/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = resolve(__dirname, "../../.cache");

let _client: ZepClient | null = null;
export function zepClient(): ZepClient {
  if (!_client) _client = new ZepClient();
  return _client;
}

/** Per-month project stores (projects active in that month), lazily loaded. */
const monthStores = new Map<string, Promise<ZepProjectStore>>();
// Which months are currently being force-refreshed from ZEP + when each last finished.
const g = globalThis as {
  __tsProjRefreshing?: Set<string>;
  __tsProjLastRefreshed?: Map<string, string>;
  __tsProjWarmed?: boolean;
};
const refreshing = (g.__tsProjRefreshing ??= new Set<string>());
const lastRefreshed = (g.__tsProjLastRefreshed ??= new Map<string, string>());

function cacheFileFor(month: string): string {
  return resolve(CACHE_DIR, `zep-projects-${month}.json`);
}

/** Get the month's store — loads from the local cache (fast) when present. */
export function getMonthStore(month: string): Promise<ZepProjectStore> {
  let p = monthStores.get(month);
  if (!p) {
    p = (async () => {
      const store = new ZepProjectStore(zepClient(), cacheFileFor(month));
      await store.init(false, `${month}-15`);
      return store;
    })();
    p.catch(() => monthStores.delete(month)); // don't poison the cache on failure
    monthStores.set(month, p);
  }
  return p;
}

export function storeForDate(date: string): Promise<ZepProjectStore> {
  return getMonthStore(date.slice(0, 7));
}

/**
 * Force-fetch a month's projects+tasks from ZEP (rewrites the disk cache) and
 * swap the fresh store in ONLY when it's ready — so ongoing reads keep serving
 * the cached store instantly while this ~30s refresh runs in the background.
 */
export async function refreshMonth(month: string): Promise<void> {
  if (refreshing.has(month)) return; // already in progress
  refreshing.add(month);
  try {
    const fresh = new ZepProjectStore(zepClient(), cacheFileFor(month));
    await fresh.init(true, `${month}-15`);
    monthStores.set(month, Promise.resolve(fresh));
    lastRefreshed.set(month, new Date().toISOString());
  } catch {
    // keep the existing cache; the client can retry via Refresh
  } finally {
    refreshing.delete(month);
  }
}

export function projectRefreshStatus(): {
  refreshing: string[];
  lastRefreshed: Record<string, string>;
} {
  return {
    refreshing: [...refreshing],
    lastRefreshed: Object.fromEntries(lastRefreshed),
  };
}

/** On server start, refresh the current month's projects in the background so
 *  the dropdowns reflect current ZEP data without blocking the first load. */
export function warmProjectsOnStartup(): void {
  if (g.__tsProjWarmed) return;
  g.__tsProjWarmed = true;
  const cur = new Date().toISOString().slice(0, 7);
  void refreshMonth(cur);
}
warmProjectsOnStartup();

/** "HH:mm:ss" -> minutes */
function toMin(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

const hhmm = (t: string) => t.slice(0, 5);

/** Attendances for a date range grouped by day (this employee only). */
export async function getAttendancesByDay(
  startDate: string,
  endDate: string
): Promise<Map<string, ZepAttendance[]>> {
  const env = getEnv();
  const all = await zepClient().getAttendancesRange(
    startDate,
    endDate,
    env.ZEP_EMPLOYEE_ID
  );
  const byDay = new Map<string, ZepAttendance[]>();
  for (const a of all) {
    const date = a.date.slice(0, 10);
    const list = byDay.get(date) ?? [];
    list.push(a);
    byDay.set(date, list);
  }
  for (const list of byDay.values())
    list.sort((a, b) => a.from.localeCompare(b.from));
  return byDay;
}

export function attendanceMinutes(list: ZepAttendance[]): number {
  return list.reduce((sum, a) => sum + Math.max(0, toMin(a.to) - toMin(a.from)), 0);
}

/** Resolve attendance rows to display entries using the month's project cache. */
export async function toEntryViews(
  date: string,
  list: ZepAttendance[]
): Promise<ZepEntryView[]> {
  let store: ZepProjectStore | null = null;
  try {
    store = await storeForDate(date);
  } catch {
    store = null;
  }
  return list.map((a) => {
    const proj = store?.getProjects().find((p) => p.id === a.project_id);
    // Use unfiltered task list so completed tasks still resolve to names
    const task = proj
      ? store!.getAllTasks(proj.id).find((t) => t.id === a.project_task_id)
      : undefined;
    return {
      id: a.id,
      from: hhmm(a.from),
      to: hhmm(a.to),
      project: proj?.name ?? String(a.project_id),
      task: task?.name ?? String(a.project_task_id),
      billable: a.billable,
      note: a.note,
    };
  });
}

/** Flat project/task options for the editor combobox (leaf tasks only). */
export async function getProjectOptions(
  date: string
): Promise<ProjectTaskOption[]> {
  const store = await storeForDate(date);
  const out: ProjectTaskOption[] = [];
  for (const project of store.getProjects()) {
    const tasks = store.getTasks(project.id);
    for (const task of tasks) {
      const hasChildren = tasks.some((t) => t.parent_id === task.id);
      if (hasChildren) continue;
      const parent = task.parent_id
        ? tasks.find((t) => t.id === task.parent_id)
        : null;
      out.push({
        projectName: project.name,
        projectDescription: project.description ?? undefined,
        taskName: task.name,
        parentName: parent?.name ?? undefined,
        taskPath: parent
          ? `${project.name} / ${parent.name} / ${task.name}`
          : `${project.name} / ${task.name}`,
        billable:
          project.default_billability?.name?.toLowerCase().startsWith("fakturierbar") ??
          false,
        taskDescription: task.description ?? undefined,
      });
    }
  }
  return out;
}

/**
 * Leaf-only project/task list for the LLM prompt: only BOOKABLE leaf task
 * names are shown (parents/headings are omitted so the model can't book to
 * a parent like "1.6 musiccompanion." instead of the leaf "musiccompanion."),
 * with the project description so it can map customer names (e.g. "CH Media"
 * → P80133).
 */
export async function getProjectLeafListText(date: string): Promise<string> {
  const store = await storeForDate(date);
  const lines: string[] = [
    "Book ONLY to the exact leaf task names listed under each project. Never use a parent/heading name.",
  ];
  for (const project of store.getProjects()) {
    const tasks = store.getTasks(project.id);
    const bill = isBillable(project) ? "billable" : "non-billable";
    lines.push(
      `\n## ${project.name}${project.description ? ` — ${project.description}` : ""} [${bill}]`
    );
    for (const task of tasks) {
      const hasChildren = tasks.some((t) => t.parent_id === task.id);
      if (hasChildren) continue; // skip parents/headings
      const parent = task.parent_id
        ? tasks.find((t) => t.id === task.parent_id)
        : null;
      const ctx = parent ? ` (under ${parent.name})` : "";
      const desc = task.description ? ` — ${task.description}` : "";
      lines.push(`  - ${task.name}${ctx}${desc}`);
    }
  }
  return lines.join("\n");
}

/** Compact project list text for the LLM prompt (same as list-projects CLI). */
export async function getProjectListText(date: string): Promise<string> {
  const store = await storeForDate(date);
  return store.formatProjectList();
}

export type EntryOutcome = "submitted" | "skipped" | "error";

export interface SubmitError {
  entry: string;
  error: string;
  /** Index into the submitted entries array (for mapping back to UI rows). */
  index?: number;
  /** Present when the task name was ambiguous — ways it could be booked. */
  candidates?: TaskCandidate[];
}

export interface WebSubmitResult {
  submitted: number;
  skipped: { from: string; to: string }[];
  errors: SubmitError[];
  warnings: string[];
  /** Outcome per input entry, in the same order as the input array. */
  outcomes: { outcome: EntryOutcome; error?: string }[];
}

/**
 * Submit entries for one day to ZEP with per-entry outcomes. Validates
 * 15-min alignment and intra-batch overlaps, resolves names, skips conflicts
 * with existing entries. NEVER call without user confirmation.
 */
export async function submitEntries(
  entries: SubmitEntry[]
): Promise<WebSubmitResult> {
  if (entries.length === 0)
    return { submitted: 0, skipped: [], errors: [], warnings: [], outcomes: [] };

  const alignErrors = validateAlignment(entries);
  if (alignErrors.length) {
    throw new Error(`Not 15-min aligned:\n${alignErrors.join("\n")}`);
  }

  // Reject overlapping entries within the batch itself.
  const endMin = (t: string) => (t === "23:59:00" ? 24 * 60 : toMin(t));
  const sorted = [...entries].sort((a, b) => toMin(a.from) - toMin(b.from));
  for (let i = 1; i < sorted.length; i++) {
    if (toMin(sorted[i].from) < endMin(sorted[i - 1].to)) {
      throw new Error(
        `Entries overlap: ${sorted[i - 1].from.slice(0, 5)}–${sorted[i - 1].to.slice(0, 5)} and ${sorted[i].from.slice(0, 5)}–${sorted[i].to.slice(0, 5)}. Fix the times first.`
      );
    }
  }

  const store = await storeForDate(entries[0].date);
  const warnings: string[] = [];
  const errors: SubmitError[] = [];
  const resolved: (CreateAttendanceInput | null)[] = entries.map((e, index) => {
    try {
      const r = resolveEntry(store, e);
      warnings.push(...r.warnings);
      return r.input;
    } catch (err) {
      errors.push({
        entry: `${e.from.slice(0, 5)}–${e.to.slice(0, 5)} ${e.project}/${e.task}`,
        error: err instanceof Error ? err.message : String(err),
        index,
        candidates: err instanceof AmbiguousTaskError ? err.candidates : undefined,
      });
      return null;
    }
  });
  if (errors.length) {
    // Name resolution failed — abort before submitting anything
    return {
      submitted: 0,
      skipped: [],
      errors,
      warnings,
      outcomes: entries.map(() => ({ outcome: "error" as const })),
    };
  }

  const inputs = resolved as CreateAttendanceInput[];
  const mgr = new AttendanceManager(zepClient());
  const existing = await mgr.getExisting(entries[0].date);
  const conflicts = mgr.findConflicts(existing, inputs);
  const conflictSet = new Set(
    conflicts.map((c) => `${c.proposed.from}-${c.proposed.to}`)
  );

  const outcomes: { outcome: EntryOutcome; error?: string }[] = [];
  const skipped: { from: string; to: string }[] = [];
  const submitErrors: SubmitError[] = [];
  let submitted = 0;

  for (const input of inputs) {
    if (conflictSet.has(`${input.from}-${input.to}`)) {
      outcomes.push({ outcome: "skipped" });
      skipped.push({ from: input.from.slice(0, 5), to: input.to.slice(0, 5) });
      continue;
    }
    try {
      await zepClient().createAttendance(input);
      outcomes.push({ outcome: "submitted" });
      submitted++;
    } catch (err) {
      const axiosData = (err as { response?: { data?: unknown } }).response?.data;
      const msg = axiosData
        ? JSON.stringify(axiosData)
        : err instanceof Error
          ? err.message
          : String(err);
      outcomes.push({ outcome: "error", error: msg });
      submitErrors.push({
        entry: `${input.from.slice(0, 5)}–${input.to.slice(0, 5)}`,
        error: msg,
      });
    }
  }

  return { submitted, skipped, errors: submitErrors, warnings, outcomes };
}
