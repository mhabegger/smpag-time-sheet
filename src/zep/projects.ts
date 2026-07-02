import { readFile, writeFile, mkdir } from "fs/promises";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { ZepClient } from "./client.js";
import type {
  ZepProject,
  ZepTask,
  ZepActivity,
  ProjectTaskEntry,
} from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = resolve(__dirname, "../../.cache");
const CACHE_FILE = resolve(CACHE_DIR, "zep-projects.json");
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

interface ProjectCache {
  timestamp: string;
  dateRange?: string; // "YYYY-MM-DD:YYYY-MM-DD" used for this cache
  projects: ZepProject[];
  tasks: Record<number, ZepTask[]>; // projectId -> tasks
  activities: Record<number, ZepActivity[]>; // projectId -> activities
}

/** Get first and last day of the month for a given date string (YYYY-MM-DD) */
function getMonthRange(date: string): { startDate: string; endDate: string } {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = d.getMonth();
  const startDate = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month + 1, 0).getDate();
  const endDate = `${year}-${String(month + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { startDate, endDate };
}

/** Determine billability from the project's default_billability name.
 *  "Fakturierbar..." = billable, "Not billable..." = non-billable */
export function isBillable(project: ZepProject): boolean {
  const name = project.default_billability?.name?.toLowerCase() ?? "";
  return name.startsWith("fakturierbar");
}

/** Whether the user can override the billable flag for this project */
export function isBillableUserChangeable(project: ZepProject): boolean {
  const name = project.default_billability?.name ?? "";
  return name.includes("änderbar") && !name.includes("nicht änderbar");
}

export class ZepProjectStore {
  private client: ZepClient;
  private cache: ProjectCache | null = null;
  private cacheFile: string;

  constructor(client: ZepClient, cacheFile?: string) {
    this.client = client;
    this.cacheFile = cacheFile ?? CACHE_FILE;
  }

  /** Load cache from disk or fetch fresh. Pass a date (YYYY-MM-DD) to filter projects active in that month. */
  async init(forceRefresh = false, date?: string): Promise<void> {
    const dateRange = date ? getMonthRange(date) : undefined;
    const rangeKey = dateRange ? `${dateRange.startDate}:${dateRange.endDate}` : undefined;

    if (!forceRefresh) {
      const loaded = await this.loadCacheFromDisk();
      if (loaded && (!rangeKey || loaded.dateRange === rangeKey)) {
        this.cache = loaded;
        return;
      }
    }
    await this.refresh(dateRange);
  }

  /** Refresh cache from ZEP API */
  async refresh(dateRange?: { startDate: string; endDate: string }): Promise<void> {
    const projects = await this.client.getProjects(dateRange?.startDate, dateRange?.endDate);
    const bookable = projects.filter((p) => p.status.bookable);

    const tasks: Record<number, ZepTask[]> = {};
    const activities: Record<number, ZepActivity[]> = {};

    for (const project of bookable) {
      tasks[project.id] = await this.client.getProjectTasks(project.id);
      activities[project.id] = await this.client.getProjectActivities(
        project.id
      );
    }

    this.cache = {
      timestamp: new Date().toISOString(),
      dateRange: dateRange ? `${dateRange.startDate}:${dateRange.endDate}` : undefined,
      projects: bookable,
      tasks,
      activities,
    };

    await this.saveCacheToDisk();
  }

  /** Get all bookable projects */
  getProjects(): ZepProject[] {
    return this.cache?.projects ?? [];
  }

  /** Get tasks for a project (only active ones — excludes erledigt/on hold) */
  getTasks(projectId: number): ZepTask[] {
    const tasks = this.cache?.tasks[projectId] ?? [];
    return tasks.filter((t) => !t.status || t.status === "in Arbeit");
  }

  /** Get ALL tasks for a project including completed/on-hold (for display). */
  getAllTasks(projectId: number): ZepTask[] {
    return this.cache?.tasks[projectId] ?? [];
  }

  /** Get activities for a project */
  getActivities(projectId: number): ZepActivity[] {
    return this.cache?.activities[projectId] ?? [];
  }

  /** Find project by name (partial match, case-insensitive) */
  findProject(query: string): ZepProject | undefined {
    const q = query.toLowerCase();
    return this.getProjects().find(
      (p) =>
        p.name.toLowerCase() === q ||
        p.name.toLowerCase().includes(q)
    );
  }

  /** Find task within a project by name (partial match) */
  findTask(projectId: number, query: string): ZepTask | undefined {
    const q = query.toLowerCase();
    return this.getTasks(projectId).find(
      (t) =>
        t.name.toLowerCase() === q ||
        t.name.toLowerCase().includes(q)
    );
  }

  /** Get flat list of all project->task entries for display/autocomplete (leaf tasks only) */
  getAllProjectTaskEntries(): ProjectTaskEntry[] {
    const entries: ProjectTaskEntry[] = [];
    for (const project of this.getProjects()) {
      const tasks = this.getTasks(project.id);
      for (const task of tasks) {
        // Skip parent tasks that have children — only leaf tasks are bookable
        const hasChildren = tasks.some((t) => t.parent_id === task.id);
        if (hasChildren) continue;

        const parent = task.parent_id
          ? tasks.find((t) => t.id === task.parent_id)
          : null;
        const taskPath = parent
          ? `${project.name} / ${parent.name} / ${task.name}`
          : `${project.name} / ${task.name}`;

        entries.push({
          projectId: project.id,
          projectName: project.name,
          taskId: task.id,
          taskName: task.name,
          taskPath,
          billable: isBillable(project),
        });
      }
    }
    return entries;
  }

  /** Format project list as readable text for Claude skill */
  formatProjectList(): string {
    const lines: string[] = ["# Available ZEP Projects and Tasks\n"];
    for (const project of this.getProjects()) {
      const billTag = isBillable(project) ? "billable" : "non-billable";
      lines.push(`## ${project.name} (ID: ${project.id}) [${billTag}]`);
      const tasks = this.getTasks(project.id);
      for (const task of tasks) {
        const hasChildren = tasks.some((t) => t.parent_id === task.id);
        const indent = task.parent_id ? "    " : "  ";
        const desc = task.description ? ` — ${task.description}` : "";
        const suffix = hasChildren ? " [PARENT - book to subtask]" : "";
        lines.push(`${indent}- ${task.name} (ID: ${task.id})${desc}${suffix}`);
      }
      const acts = this.getActivities(project.id);
      if (acts.length > 0) {
        lines.push(`  Activities: ${acts.map((a) => a.name).join(", ")}`);
      }
      lines.push("");
    }
    return lines.join("\n");
  }

  private async loadCacheFromDisk(): Promise<ProjectCache | null> {
    try {
      const raw = await readFile(this.cacheFile, "utf-8");
      const cache: ProjectCache = JSON.parse(raw);
      const age = Date.now() - new Date(cache.timestamp).getTime();
      if (age > CACHE_MAX_AGE_MS) return null;
      return cache;
    } catch {
      return null;
    }
  }

  private async saveCacheToDisk(): Promise<void> {
    try {
      await mkdir(CACHE_DIR, { recursive: true });
      await writeFile(this.cacheFile, JSON.stringify(this.cache, null, 2));
    } catch {
      // Non-critical: cache write failure
    }
  }
}
