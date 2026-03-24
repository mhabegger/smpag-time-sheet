/**
 * Query ZEP attendances for a specific date.
 * Usage: npx tsx src/zep/query-date.ts 2026-03-17
 */
import { ZepClient } from "./client.js";
import { AttendanceManager } from "./attendances.js";
import { ZepProjectStore } from "./projects.js";

const date = process.argv[2];
if (!date) {
  console.error("Usage: npx tsx src/zep/query-date.ts YYYY-MM-DD");
  process.exit(1);
}

const client = new ZepClient();
const mgr = new AttendanceManager(client);
const store = new ZepProjectStore(client);
await store.init();

const entries = await mgr.getExisting(date);
console.log(`ZEP entries for ${date}: ${entries.length}`);

for (const e of entries) {
  const proj = store.getProjects().find((p) => p.id === e.project_id);
  const tasks = proj ? store.getTasks(proj.id) : [];
  const task = tasks.find((t) => t.id === e.project_task_id);
  console.log(
    `  ${e.from}-${e.to} | ${proj?.name || e.project_id} / ${task?.name || e.project_task_id} | ${e.billable ? "billable" : "non-bill"} | ${e.note || "(no note)"}`
  );
}
