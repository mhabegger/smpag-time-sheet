/**
 * Parse a saved ManicTime `get_combined_activities` JSON dump into a clean,
 * readable, chronological timeline of ACTIVE work blocks.
 *
 * Why this exists:
 *   A full day of combined activities is too large to return inline from the
 *   MCP tool, so it gets written to a file. This script turns that file into a
 *   compact timeline deterministically — so the timesheet skill never has to
 *   improvise ad-hoc shell parsing (which triggers permission prompts).
 *
 * Usage:
 *   npx tsx src/manictime/parse-timeline.ts <path-to-dump.json> [maxGapMin]
 *
 * The core logic lives in ./timeline-lib.ts (shared with the web app).
 */

import { readFileSync } from "fs";
import { renderTimelineText, type Dump } from "./timeline-lib.js";

const file = process.argv[2];
if (!file) {
  console.error(
    "Usage: npx tsx src/manictime/parse-timeline.ts <dump.json> [bucketMin]"
  );
  process.exit(1);
}
const bucketMin = parseFloat(process.argv[3] || "15");

const dump = JSON.parse(readFileSync(file, "utf-8")) as Dump;
console.log(renderTimelineText(dump, bucketMin).text);
