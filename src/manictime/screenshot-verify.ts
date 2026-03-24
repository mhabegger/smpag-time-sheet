/**
 * Screenshot verification — samples screenshots across a work day,
 * runs OCR, and returns a summary to cross-check activity classification.
 *
 * Usage:
 *   npx tsx src/manictime/screenshot-verify.ts 2026-03-24 [intervalMinutes]
 */

import { findScreenshots } from "./screenshots.js";
import { ocrImages, OcrResult } from "./ocr.js";
import { parseISO, startOfDay, endOfDay, addMinutes, format } from "date-fns";

export interface ScreenshotSample {
  time: string; // HH:mm
  path: string;
  ocrText: string;
}

/**
 * Sample screenshots evenly across the active part of the day and OCR them.
 * Returns one sample per `intervalMinutes` (default 30).
 */
export async function verifyDayScreenshots(
  date: Date,
  intervalMinutes = 30
): Promise<ScreenshotSample[]> {
  const dayStart = startOfDay(date);
  const dayEnd = endOfDay(date);

  // Find all full-size screenshots for the day (not thumbnails — too small for OCR)
  const allScreenshots = await findScreenshots(date, dayStart, dayEnd, false);
  if (allScreenshots.length === 0) return [];

  const firstTime = allScreenshots[0].timestamp;
  const lastTime = allScreenshots[allScreenshots.length - 1].timestamp;

  // Pick one screenshot per interval window (the middle one in each window)
  const samplePaths: { time: string; path: string }[] = [];
  let cursor = firstTime;

  while (cursor <= lastTime) {
    const windowEnd = addMinutes(cursor, intervalMinutes);
    const windowShots = allScreenshots.filter(
      (s) => s.timestamp >= cursor && s.timestamp < windowEnd
    );
    if (windowShots.length > 0) {
      const mid = windowShots[Math.floor(windowShots.length / 2)];
      samplePaths.push({
        time: format(mid.timestamp, "HH:mm"),
        path: mid.path,
      });
    }
    cursor = windowEnd;
  }

  if (samplePaths.length === 0) return [];

  // Batch OCR all sampled screenshots
  const ocrResults = await ocrImages(samplePaths.map((s) => s.path));
  const ocrMap = new Map<string, OcrResult>();
  for (const r of ocrResults) {
    ocrMap.set(r.path, r);
  }

  return samplePaths.map((s) => ({
    time: s.time,
    path: s.path,
    ocrText: ocrMap.get(s.path)?.text?.trim() || "",
  }));
}

/**
 * Format verification results as a compact text block for the LLM prompt.
 */
export function formatVerificationSummary(
  samples: ScreenshotSample[]
): string {
  if (samples.length === 0) return "No screenshots found for this day.";

  const lines = samples
    .filter((s) => s.ocrText.length > 0)
    .map((s) => {
      // Truncate long OCR text to keep prompt compact
      const text =
        s.ocrText.length > 300
          ? s.ocrText.substring(0, 300) + "..."
          : s.ocrText;
      return `**${s.time}** — ${text}`;
    });

  return [
    `Screenshot OCR samples (${lines.length} of ${samples.length}):`,
    ...lines,
  ].join("\n");
}

// CLI entry point
if (process.argv[1]?.includes("screenshot-verify")) {
  const dateArg = process.argv[2] || format(new Date(), "yyyy-MM-dd");
  const interval = parseInt(process.argv[3] || "30", 10);

  console.log(`Sampling screenshots for ${dateArg} every ${interval}min...`);

  const date = parseISO(dateArg);
  const samples = await verifyDayScreenshots(date, interval);

  console.log(formatVerificationSummary(samples));
  console.log(`\nTotal samples: ${samples.length}`);
}
