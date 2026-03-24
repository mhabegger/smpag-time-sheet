import { readFileSync } from "fs";
import { resolve } from "path";
import { parse } from "yaml";
import { ZepClient } from "./client.js";
import { ZepProjectStore } from "./projects.js";
import { AttendanceManager } from "./attendances.js";
import { getEnv } from "../config/env.js";
import type { CreateAttendanceInput } from "./types.js";

interface YamlEntry {
  date: string;
  from: string;
  to: string;
  project: string;
  task: string;
  billable: boolean;
  note?: string;
  color?: string;
}

interface YamlFile {
  entries: YamlEntry[];
}

/** Auto-assign color based on project/task classification */
function getEntryColor(e: YamlEntry): string {
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

const file = process.argv[2];
if (!file) {
  console.error("Usage: npx tsx src/zep/submit.ts <entries.yaml>");
  process.exit(1);
}

const raw = readFileSync(resolve(file), "utf-8");
const data = parse(raw) as YamlFile;

const env = getEnv();
const client = new ZepClient();
const store = new ZepProjectStore(client);
await store.init();
const mgr = new AttendanceManager(client);

// Resolve project/task names to IDs
const inputs: CreateAttendanceInput[] = [];
for (const e of data.entries) {
  const proj = store.getProjects().find((p) => p.name === e.project);
  if (!proj) {
    console.error(`Project not found: ${e.project}`);
    process.exit(1);
  }
  const task = store.getTasks(proj.id).find(
    (t) => t.name === e.task && t.parent_id === null
  ) ?? store.getTasks(proj.id).find((t) => t.name === e.task);
  if (!task) {
    console.error(`Task not found: ${e.task} in project ${e.project}`);
    process.exit(1);
  }

  inputs.push({
    employee_id: env.ZEP_EMPLOYEE_ID,
    date: e.date,
    from: e.from,
    to: e.to,
    project_id: proj.id,
    project_task_id: task.id,
    activity_id: "S",
    billable: e.billable,
    note: e.note,
    color: e.color || getEntryColor(e),
  });

  console.log(
    `  ${e.from}-${e.to} ${e.project}/${e.task} (${proj.id}/${task.id}) ${e.billable ? "billable" : ""} ${e.note || ""}`
  );
}

console.log(`\nSubmitting ${inputs.length} entries...`);
const result = await mgr.submit(inputs);

console.log(`\n✓ Submitted: ${result.submitted.length}`);
if (result.skipped.length)
  console.log(`⊘ Skipped (conflict): ${result.skipped.length}`);
if (result.errors.length) {
  console.log(`✗ Errors: ${result.errors.length}`);
  result.errors.forEach((e) => console.log(`  ${e.entry.from}-${e.entry.to}: ${e.error}\n  payload: ${JSON.stringify(e.entry)}`));
}
