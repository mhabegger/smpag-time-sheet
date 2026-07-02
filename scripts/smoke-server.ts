/** Smoke test for the web server data layer. Run: npx tsx scripts/smoke-server.ts */
import { getUsageRange, getDayActivities } from "../src/server/manictime.js";
import { renderTimelineText } from "../src/manictime/timeline-lib.js";
import { getAttendancesByDay, getProjectListText } from "../src/server/zep.js";
import { listThumbStrip } from "../src/server/screenshots.js";

const date = process.argv[2] || "2026-06-30";

console.log("1) usage range June...");
const usage = await getUsageRange("2026-06-25", "2026-06-30");
for (const [d, u] of usage) console.log(`   ${d}: active ${Math.round(u.activeMin)}m`);

console.log(`2) day dump ${date}...`);
const dump = await getDayActivities(date);
const t = renderTimelineText(dump, 15);
console.log(
  `   buckets=${t.buckets.length} first=${t.firstActive?.toTimeString().slice(0, 5)} last=${t.lastActive?.toTimeString().slice(0, 5)} textLen=${t.text.length}`
);
console.log(t.text.split("\n").slice(0, 6).join("\n"));

console.log("3) ZEP attendances range...");
const byDay = await getAttendancesByDay("2026-06-25", "2026-06-30");
for (const [d, list] of byDay) console.log(`   ${d}: ${list.length} entries`);

console.log("4) ZEP project list for month...");
const text = await getProjectListText(date);
console.log(`   length=${text.length}, first line: ${text.split("\n")[1] ?? ""}`);

console.log("5) screenshot strip...");
const thumbs = await listThumbStrip(date, 60);
console.log(`   ${thumbs.length} thumbs (hourly): ${thumbs.slice(0, 5).map((x) => x.time).join(", ")}`);

console.log("OK");
process.exit(0);
