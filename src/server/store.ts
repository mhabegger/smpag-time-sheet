/**
 * File-based per-day store: data/days/YYYY-MM-DD.json
 * Human-inspectable, no DB. Writes are atomic (tmp + rename).
 */

import { mkdir, readFile, writeFile, rename, readdir } from "fs/promises";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import type { DayRecord } from "../lib/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "../../data/days");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function fileFor(date: string): string {
  if (!DATE_RE.test(date)) throw new Error(`Invalid date: ${date}`);
  return resolve(DATA_DIR, `${date}.json`);
}

export function emptyRecord(date: string): DayRecord {
  return { date, status: "missing", suggestions: [], nonWork: [] };
}

export async function loadDay(date: string): Promise<DayRecord | null> {
  try {
    const raw = await readFile(fileFor(date), "utf-8");
    return JSON.parse(raw) as DayRecord;
  } catch {
    return null;
  }
}

let tmpSeq = 0;

export async function saveDay(record: DayRecord): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  const target = fileFor(record.date);
  // unique tmp name — concurrent saves must not race on the same tmp file
  const tmp = `${target}.${process.pid}.${tmpSeq++}.tmp`;
  await writeFile(tmp, JSON.stringify(record, null, 2), "utf-8");
  await rename(tmp, target);
}

/** Update a day record with a mutator (creates it when missing). */
export async function updateDay(
  date: string,
  mutate: (r: DayRecord) => void
): Promise<DayRecord> {
  const record = (await loadDay(date)) ?? emptyRecord(date);
  mutate(record);
  await saveDay(record);
  return record;
}

/** All stored records keyed by date. */
export async function loadAllDays(): Promise<Map<string, DayRecord>> {
  const out = new Map<string, DayRecord>();
  let files: string[];
  try {
    files = await readdir(DATA_DIR);
  } catch {
    return out;
  }
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    const date = f.replace(/\.json$/, "");
    if (!DATE_RE.test(date)) continue;
    const rec = await loadDay(date);
    if (rec) out.set(date, rec);
  }
  return out;
}
