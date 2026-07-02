import { readFileSync } from "fs";
import { resolve } from "path";
import { parse } from "yaml";
import { ZepClient } from "./client.js";
import { ZepProjectStore } from "./projects.js";
import { AttendanceManager } from "./attendances.js";
import {
  validateAlignment,
  resolveEntry,
  type SubmitEntry,
} from "./submit-lib.js";
import type { CreateAttendanceInput } from "./types.js";

interface YamlFile {
  entries: SubmitEntry[];
}

const file = process.argv[2];
if (!file) {
  console.error("Usage: npx tsx src/zep/submit.ts <entries.yaml>");
  process.exit(1);
}

const raw = readFileSync(resolve(file), "utf-8");
const data = parse(raw) as YamlFile;

// Hard invariant: every time must land on a 15-minute boundary (:00/:15/:30/:45).
const alignErrors = validateAlignment(data.entries);
if (alignErrors.length) {
  console.error(
    `✗ ${alignErrors.length} time(s) not aligned to 15-min boundaries — fix pending.yaml and resubmit:`
  );
  alignErrors.forEach((l) => console.error(`  ${l}`));
  process.exit(1);
}

const client = new ZepClient();
const store = new ZepProjectStore(client);
await store.init();
const mgr = new AttendanceManager(client);

// Resolve project/task names to IDs
const inputs: CreateAttendanceInput[] = [];
for (const e of data.entries) {
  let resolved;
  try {
    resolved = resolveEntry(store, e);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
  resolved.warnings.forEach((w) => console.warn(`⚠ ${w}`));
  inputs.push(resolved.input);

  const taskLabel = e.subtask ? `${e.task}/${e.subtask}` : e.task;
  console.log(
    `  ${e.from}-${e.to} ${e.project}/${taskLabel} (${resolved.input.project_id}/${resolved.input.project_task_id}) ${resolved.input.billable ? "billable" : "non-bill"} ${e.note || ""}`
  );
}

console.log(`\nSubmitting ${inputs.length} entries...`);
const result = await mgr.submit(inputs);

console.log(`\n✓ Submitted: ${result.submitted.length}`);
if (result.skipped.length)
  console.log(`⊘ Skipped (conflict): ${result.skipped.length}`);
if (result.errors.length) {
  console.log(`✗ Errors: ${result.errors.length}`);
  result.errors.forEach((e) =>
    console.log(
      `  ${e.entry.from}-${e.entry.to}: ${e.error}\n  payload: ${JSON.stringify(e.entry)}`
    )
  );
}
