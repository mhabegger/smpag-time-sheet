/**
 * File-based per-day store: data/days/YYYY-MM-DD.json
 * Human-inspectable, no DB. Writes are atomic (tmp + rename).
 */

import { mkdir, readFile, writeFile, rename, readdir, rm } from "fs/promises";
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
  const file = fileFor(date);
  let raw: string;
  try {
    raw = await readFile(file, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  try {
    return JSON.parse(raw) as DayRecord;
  } catch {
    // Corrupt file (truncated write, manual edit). Move it aside so the next
    // updateDay can't overwrite what's left of it with an empty record.
    const aside = `${file}.corrupt-${Date.now()}`;
    try {
      await rename(file, aside);
      console.error(`[store] ${date}.json is corrupt — moved to ${aside}`);
    } catch {
      console.error(`[store] ${date}.json is corrupt and could not be moved aside`);
    }
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
  await renameWithRetry(tmp, target);
}

/**
 * Windows refuses to replace a file that another handle has open at that
 * instant (EPERM/EACCES/EBUSY) — e.g. the dashboard polling loadAllDays()
 * while the queue saves a day, or an antivirus scan. Such locks last
 * milliseconds, so retry with a short backoff instead of failing the write.
 */
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      const transient = code === "EPERM" || code === "EACCES" || code === "EBUSY";
      if (!transient || attempt >= 12) {
        await rm(from, { force: true }).catch(() => {});
        throw err;
      }
      await new Promise((r) => setTimeout(r, Math.min(20 * 2 ** attempt, 500)));
    }
  }
}

// Per-date write lock: updateDay is a read-modify-write, so concurrent
// writers (analyzer finishing vs. UI autosave, submit vs. re-analysis) must
// be serialized or one silently overwrites the other. globalThis so the
// chain survives Vite HMR like the other server singletons.
const gLocks = globalThis as { __tsDayWriteChain?: Map<string, Promise<void>> };
const writeChain = (gLocks.__tsDayWriteChain ??= new Map<string, Promise<void>>());

/** Update a day record with a mutator (creates it when missing).
 *  Serialized per date — concurrent updates run one after another, each
 *  seeing the previous one's result. */
export function updateDay(
  date: string,
  mutate: (r: DayRecord) => void
): Promise<DayRecord> {
  const run = async (): Promise<DayRecord> => {
    const record = (await loadDay(date)) ?? emptyRecord(date);
    mutate(record);
    await saveDay(record);
    return record;
  };
  const prev = writeChain.get(date) ?? Promise.resolve();
  const result = prev.then(run, run); // run regardless of the previous outcome
  const tail = result.then(
    () => undefined,
    () => undefined
  );
  writeChain.set(date, tail);
  void tail.then(() => {
    if (writeChain.get(date) === tail) writeChain.delete(date);
  });
  return result;
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
