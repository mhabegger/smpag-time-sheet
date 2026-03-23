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
  projects: ZepProject[];
  tasks: Record<number, ZepTask[]>; // projectId -> tasks
  activities: Record<number, ZepActivity[]>; // projectId -> activities
}

export class ZepProjectStore {
  private client: ZepClient;
  private cache: ProjectCache | null = null;

  constructor(client: ZepClient) {
    this.client = client;
  }

  /** Load cache from disk or fetch fresh */
  async init(forceRefresh = false): Promise<void> {
    if (!forceRefresh) {
      const loaded = await this.loadCacheFromDisk();
      if (loaded) {
        this.cache = loaded;
        return;
      }
    }
    await this.refresh();
  }

  /** Refresh cache from ZEP API */
  async refresh(): Promise<void> {
    const projects = await this.client.getProjects();
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

  /** Get tasks for a project */
  getTasks(projectId: number): ZepTask[] {
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

  /** Get flat list of all project->task entries for display/autocomplete */
  getAllProjectTaskEntries(): ProjectTaskEntry[] {
    const entries: ProjectTaskEntry[] = [];
    for (const project of this.getProjects()) {
      const tasks = this.getTasks(project.id);
      for (const task of tasks) {
        entries.push({
          projectId: project.id,
          projectName: project.name,
          taskId: task.id,
          taskName: task.name,
          taskPath: `${project.name} -> ${task.name}`,
          billable: project.default_billability?.name === "billable",
        });
      }
    }
    return entries;
  }

  /** Format project list as readable text for Claude skill */
  formatProjectList(): string {
    const lines: string[] = ["# Available ZEP Projects and Tasks\n"];
    for (const project of this.getProjects()) {
      lines.push(`## ${project.name} (ID: ${project.id})`);
      const tasks = this.getTasks(project.id);
      for (const task of tasks) {
        const indent = task.parent_id ? "    " : "  ";
        lines.push(`${indent}- ${task.name} (ID: ${task.id})`);
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
      const raw = await readFile(CACHE_FILE, "utf-8");
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
      await writeFile(CACHE_FILE, JSON.stringify(this.cache, null, 2));
    } catch {
      // Non-critical: cache write failure
    }
  }
}
