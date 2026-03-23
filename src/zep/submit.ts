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
}

interface YamlFile {
  entries: YamlEntry[];
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
