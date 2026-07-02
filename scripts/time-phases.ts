/** Time each analysis phase. Run: npx tsx scripts/time-phases.ts 2026-06-30 */
import { getDayActivities } from "../src/server/manictime.js";
import { getOcrSamples } from "../src/server/screenshots.js";
import { getAttendancesByDay, getProjectListText } from "../src/server/zep.js";
import { renderTimelineText } from "../src/manictime/timeline-lib.js";

const date = process.argv[2] || "2026-06-30";
const t = (label: string, ms: number) => console.log(`${label}: ${(ms / 1000).toFixed(1)}s`);

let s = Date.now();
const dump = await getDayActivities(date);
t("manictime dump", Date.now() - s);
const tl = renderTimelineText(dump, 15);
console.log(`  timeline text ${tl.text.length} chars, ${tl.buckets.length} buckets`);

s = Date.now();
const ocr30 = await getOcrSamples(date, 30);
t("OCR @30min", Date.now() - s);
console.log(`  ${ocr30.length} samples, ${ocr30.filter((x) => x.text).length} with text`);

s = Date.now();
const ocr60 = await getOcrSamples(date, 60);
t("OCR @60min", Date.now() - s);
console.log(`  ${ocr60.length} samples`);

s = Date.now();
const zep = await getAttendancesByDay(date, date);
t("zep attendances", Date.now() - s);

s = Date.now();
const proj = await getProjectListText(date);
t("project list (cached)", Date.now() - s);
console.log(`  ${proj.length} chars`);
process.exit(0);
