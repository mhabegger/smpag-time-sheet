/**
 * Screenshot access for the web UI: thumbnail strips, raw JPEG responses for
 * the /shot route, and OCR samples.
 */

import { readdir, readFile } from "fs/promises";
import { resolve, normalize, relative, isAbsolute } from "path";
import { parseISO } from "date-fns";
import { getEnv } from "../config/env.js";
import { verifyDayScreenshots } from "../manictime/screenshot-verify.js";
import type { OcrSample, ScreenshotThumb } from "../lib/types.js";

/**
 * Screenshot filename pattern:
 * {YYYY-MM-DD}_{HH-MM-SS}_{tz-offset}_{width}_{height}_{seqId}_{changeFlag}.jpg
 * Thumbnails end with `.thumbnail.jpg`.
 */
function parseStamp(filename: string): { time: string } | null {
  const m = filename.match(/^\d{4}-\d{2}-\d{2}_(\d{2})-(\d{2})-\d{2}_/);
  if (!m) return null;
  return { time: `${m[1]}:${m[2]}` };
}

function screenshotsRoot(): string {
  return normalize(resolve(getEnv().MANICTIME_SCREENSHOTS_PATH));
}

/**
 * List one thumbnail per `stepMinutes` across the day (keeps the strip small).
 */
export async function listThumbStrip(
  date: string,
  stepMinutes = 15
): Promise<ScreenshotThumb[]> {
  const dir = resolve(screenshotsRoot(), date);
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }

  const thumbs = files
    .filter((f) => f.endsWith(".thumbnail.jpg"))
    .map((f) => ({ file: f, stamp: parseStamp(f) }))
    .filter((x): x is { file: string; stamp: { time: string } } => !!x.stamp)
    .sort((a, b) => a.file.localeCompare(b.file));

  const out: ScreenshotThumb[] = [];
  let lastSlot = -1;
  for (const t of thumbs) {
    const [h, m] = t.stamp.time.split(":").map(Number);
    const slot = Math.floor((h * 60 + m) / stepMinutes);
    if (slot === lastSlot) continue;
    lastSlot = slot;
    out.push({
      time: t.stamp.time,
      thumbPath: resolve(dir, t.file),
      path: resolve(dir, t.file.replace(".thumbnail.jpg", ".jpg")),
    });
  }
  return out;
}

/** Resolve a screenshot path, refusing anything outside the screenshots root. */
export function containedPath(path: string): string {
  const abs = normalize(resolve(path));
  // proper containment check: relative path must not escape the root
  const rel = relative(screenshotsRoot(), abs);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error("Path outside the screenshots directory");
  }
  return abs;
}

/**
 * Raw JPEG response for the /shot route. Screenshots never change once
 * written, so the browser may cache them indefinitely — re-opening or
 * paging back through a day is then instant.
 */
export async function screenshotResponse(path: string | null): Promise<Response> {
  if (!path) return new Response("missing ?p=", { status: 400 });
  let abs: string;
  try {
    abs = containedPath(path);
  } catch {
    return new Response("forbidden", { status: 403 });
  }
  try {
    const buf = await readFile(abs);
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Length": String(buf.length),
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response("not found", { status: 404 });
  }
}

/** OCR one screenshot every `intervalMinutes` across the day. */
export async function getOcrSamples(
  date: string,
  intervalMinutes = 30
): Promise<OcrSample[]> {
  try {
    const d = parseISO(date);
    const samples = await verifyDayScreenshots(d, intervalMinutes);
    return samples.map((s) => ({ time: s.time, path: s.path, text: s.ocrText }));
  } catch {
    return []; // screenshots are supplementary, never fail the pipeline
  }
}
