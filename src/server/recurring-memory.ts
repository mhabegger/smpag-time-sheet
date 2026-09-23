/**
 * User-approved, reusable facts for the timesheet analyzer.
 *
 * This is deliberately separate from source-controlled classification rules:
 * it is personal local data, human-readable, and only changes after an
 * explicit action in the UI.
 */
import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "../../data");
const MEMORY_FILE = resolve(DATA_DIR, "recurring-rules.md");
const HEADER = "# Recurring timesheet rules\n\n";

export async function loadRecurringMemory(): Promise<string> {
  try {
    return (await readFile(MEMORY_FILE, "utf-8")).trim();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw err;
  }
}

/** Add one rule, unless that exact rule was already approved previously. */
export async function addRecurringRule(
  rule: string
): Promise<{ added: boolean; memory: string }> {
  const clean = rule.replace(/\s+/g, " ").trim();
  if (!clean || clean.length > 240) {
    throw new Error("A recurring rule must be between 1 and 240 characters.");
  }

  const current = await loadRecurringMemory();
  const normalized = clean.toLocaleLowerCase();
  const alreadyPresent = current
    .split("\n")
    .some((line) => line.replace(/^[-*]\s*/, "").trim().toLocaleLowerCase() === normalized);
  if (alreadyPresent) return { added: false, memory: current };

  const next = `${current || HEADER}${current ? "\n" : ""}- ${clean}\n`;
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(MEMORY_FILE, next, "utf-8");
  return { added: true, memory: next.trim() };
}
