import { getEnv } from "../config/env.js";
import { ZepClient } from "./client.js";
import type { ZepAttendance, CreateAttendanceInput } from "./types.js";
import { endMinutes } from "./submit-lib.js";

export interface TimeConflict {
  existing: ZepAttendance;
  proposed: CreateAttendanceInput;
  overlapMinutes: number;
}

export interface SubmitResult {
  submitted: ZepAttendance[];
  skipped: CreateAttendanceInput[];
  errors: Array<{ entry: CreateAttendanceInput; error: string }>;
}

export class AttendanceManager {
  private client: ZepClient;

  constructor(client: ZepClient) {
    this.client = client;
  }

  /** Get existing entries for the user on a given date */
  async getExisting(date: string): Promise<ZepAttendance[]> {
    const env = getEnv();
    return this.client.getAttendances(date, env.ZEP_EMPLOYEE_ID);
  }

  /** Find conflicts between proposed entries and existing ones */
  findConflicts(
    existing: ZepAttendance[],
    proposed: CreateAttendanceInput[]
  ): TimeConflict[] {
    const conflicts: TimeConflict[] = [];

    for (const entry of proposed) {
      for (const ex of existing) {
        const overlap = this.getOverlapMinutes(
          entry.from,
          entry.to,
          ex.from,
          ex.to
        );
        if (overlap > 0) {
          conflicts.push({ existing: ex, proposed: entry, overlapMinutes: overlap });
        }
      }
    }

    return conflicts;
  }

  /** Submit entries to ZEP, skipping slots that already have entries */
  async submit(
    entries: CreateAttendanceInput[],
    skipConflicts = true
  ): Promise<SubmitResult> {
    if (entries.length === 0) return { submitted: [], skipped: [], errors: [] };

    // Conflicts are checked per date (a YAML batch may span multiple days).
    const dates = [...new Set(entries.map((e) => e.date))];
    const conflictSet = new Set<string>();
    for (const date of dates) {
      const existing = await this.getExisting(date);
      const sameDay = entries.filter((e) => e.date === date);
      const conflicts = this.findConflicts(existing, sameDay);
      for (const c of conflicts)
        conflictSet.add(`${c.proposed.date}|${c.proposed.from}-${c.proposed.to}`);
    }

    const result: SubmitResult = { submitted: [], skipped: [], errors: [] };

    for (const entry of entries) {
      const key = `${entry.date}|${entry.from}-${entry.to}`;
      if (skipConflicts && conflictSet.has(key)) {
        result.skipped.push(entry);
        continue;
      }

      try {
        const created = await this.client.createAttendance(entry);
        result.submitted.push(created);
      } catch (err: unknown) {
        const axiosData = (err as any).response?.data;
        const msg = axiosData
          ? JSON.stringify(axiosData)
          : err instanceof Error ? err.message : String(err);
        result.errors.push({ entry, error: msg });
      }
    }

    return result;
  }

  /** Calculate overlap in minutes between two time ranges (HH:mm:ss format) */
  private getOverlapMinutes(
    from1: string,
    to1: string,
    from2: string,
    to2: string
  ): number {
    const toMin = (t: string) => {
      const [h, m] = t.split(":").map(Number);
      return h * 60 + m;
    };
    const start = Math.max(toMin(from1), toMin(from2));
    const end = Math.min(endMinutes(to1), endMinutes(to2));
    return Math.max(0, end - start);
  }
}
