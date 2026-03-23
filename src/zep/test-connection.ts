/**
 * Quick test script to verify ZEP API connectivity.
 * Run with: npx tsx src/zep/test-connection.ts
 */
import { ZepClient } from "./client.js";
import { ZepProjectStore } from "./projects.js";
import { AttendanceManager } from "./attendances.js";
import { getEnv } from "../config/env.js";
import { format } from "date-fns";

async function main() {
  const env = getEnv();
  console.log(`ZEP Instance: ${env.ZEP_INSTANCE}`);
  console.log(`ZEP Base URL: ${env.ZEP_BASE_URL}`);
  console.log(`Employee ID: ${env.ZEP_EMPLOYEE_ID}\n`);

  const client = new ZepClient();
  const store = new ZepProjectStore(client);
  const attendance = new AttendanceManager(client);

  // Test 1: Fetch projects
  console.log("--- Fetching projects ---");
  await store.init(true);
  const projects = store.getProjects();
  console.log(`Found ${projects.length} bookable projects:\n`);

  for (const p of projects) {
    const tasks = store.getTasks(p.id);
    const activities = store.getActivities(p.id);
    console.log(`  ${p.name} (${tasks.length} tasks, ${activities.length} activities)`);
    for (const t of tasks) {
      const indent = t.parent_id ? "      " : "    ";
      console.log(`${indent}- ${t.name}`);
    }
  }

  // Test 2: Fetch today's attendances
  const today = format(new Date(), "yyyy-MM-dd");
  console.log(`\n--- Attendances for ${today} ---`);
  const entries = await attendance.getExisting(today);
  if (entries.length === 0) {
    console.log("No entries for today.");
  } else {
    for (const e of entries) {
      console.log(`  ${e.from}-${e.to} Project:${e.project_id} Task:${e.project_task_id}`);
    }
  }

  console.log("\nZEP connection test complete.");
}

main().catch((err) => {
  console.error("Connection test failed:", err.message);
  if (err.response) {
    console.error("Status:", err.response.status);
    console.error("Data:", JSON.stringify(err.response.data, null, 2));
  }
  process.exit(1);
});
