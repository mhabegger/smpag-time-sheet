/** End-to-end analyzer smoke test. Run: npx tsx scripts/smoke-analyze.ts 2026-06-30 */
import { analyzeDay } from "../src/server/analyzer.js";

const date = process.argv[2] || "2026-06-30";
console.log(`Analyzing ${date}...`);
const t0 = Date.now();
const rec = await analyzeDay(date);
console.log(`Done in ${Math.round((Date.now() - t0) / 1000)}s`);
console.log(`status=${rec.status}`);
if (rec.error) console.log(`ERROR: ${rec.error}`);
console.log(`summary: ${rec.analysis?.summary}`);
console.log(`model: ${rec.analysis?.model}, active: ${rec.analysis?.activeMinutes}m`);
console.log(`\nEntries (${rec.suggestions.length}):`);
for (const e of rec.suggestions) {
  console.log(
    `  ${e.from}-${e.to} ${e.project} / ${e.subtask ? e.task + "/" + e.subtask : e.task} [${e.confidence}%]${e.billable === undefined ? "" : e.billable ? " billable" : " non-bill"}\n    ${e.note}${e.reasoning ? `\n    ~ ${e.reasoning}` : ""}`
  );
}
console.log(`\nNon-work (${rec.nonWork.length}):`);
for (const s of rec.nonWork) console.log(`  ${s.from}-${s.to} ${s.kind}${s.note ? ` (${s.note})` : ""}`);
process.exit(0);
