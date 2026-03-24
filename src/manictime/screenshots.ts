import { readdir } from "fs/promises";
import { resolve } from "path";
import { format } from "date-fns";
import { getEnv } from "../config/env.js";

/**
 * Screenshot filename pattern:
 * {YYYY-MM-DD}_{HH-MM-SS}_{tz-offset}_{width}_{height}_{seqId}_{changeFlag}.jpg
 * Example: 2026-03-23_22-42-26_01-00_2322_1494_2124497_1.jpg
 */

interface Screenshot {
  path: string;
  timestamp: Date;
  isThumbnail: boolean;
}

/** Parse timestamp from a ManicTime screenshot filename */
function parseScreenshotFilename(
  filename: string
): { timestamp: Date; isThumbnail: boolean } | null {
  const isThumbnail = filename.includes(".thumbnail.");

  // Match: YYYY-MM-DD_HH-MM-SS_TZ
  const match = filename.match(
    /^(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})_(\d{2})-(\d{2})_/
  );
  if (!match) return null;

  const [, datePart, hours, minutes, seconds, tzHours, tzMinutes] = match;
  const isoString = `${datePart}T${hours}:${minutes}:${seconds}+${tzHours}:${tzMinutes}`;
  const timestamp = new Date(isoString);

  if (isNaN(timestamp.getTime())) return null;
  return { timestamp, isThumbnail };
}

/**
 * Find screenshots within a time range for a given date.
 * Returns full-size images only (not thumbnails).
 */
export async function findScreenshots(
  date: Date,
  fromTime: Date,
  toTime: Date,
  thumbnails = false
): Promise<Screenshot[]> {
  const env = getEnv();
  const dateStr = format(date, "yyyy-MM-dd");
  const dir = resolve(env.MANICTIME_SCREENSHOTS_PATH, dateStr);

  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return []; // Directory doesn't exist for this date
  }

  const screenshots: Screenshot[] = [];

  for (const file of files) {
    if (!file.endsWith(".jpg")) continue;

    const parsed = parseScreenshotFilename(file);
    if (!parsed) continue;
    if (!thumbnails && parsed.isThumbnail) continue;
    if (thumbnails && !parsed.isThumbnail) continue;

    if (parsed.timestamp >= fromTime && parsed.timestamp <= toTime) {
      screenshots.push({
        path: resolve(dir, file),
        timestamp: parsed.timestamp,
        isThumbnail: parsed.isThumbnail,
      });
    }
  }

  return screenshots.sort(
    (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
  );
}

/**
 * Sample a few screenshots from a time range (for OCR or Claude vision).
 * Returns start, middle, and end screenshots.
 */
export async function sampleScreenshots(
  date: Date,
  fromTime: Date,
  toTime: Date,
  count = 3
): Promise<string[]> {
  const all = await findScreenshots(date, fromTime, toTime, true);
  if (all.length === 0) return [];
  if (all.length <= count) return all.map((s) => s.path);

  if (count === 1) return [all[Math.floor(all.length / 2)].path];

  const indices: number[] = [];
  for (let i = 0; i < count; i++) {
    indices.push(Math.floor((i / (count - 1)) * (all.length - 1)));
  }

  return [...new Set(indices)].map((i) => all[i].path);
}
