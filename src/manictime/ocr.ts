/**
 * Windows OCR wrapper — uses WinRT OcrEngine via PowerShell.
 * Batch-processes multiple images in a single PowerShell invocation.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const OCR_SCRIPT = resolve(__dirname, "ocr.ps1");

export interface OcrResult {
  path: string;
  text: string;
  error: string | null;
}

/**
 * Run Windows OCR on one or more image files.
 * Returns extracted text for each image.
 */
export async function ocrImages(imagePaths: string[]): Promise<OcrResult[]> {
  if (imagePaths.length === 0) return [];

  // Join paths with | delimiter for the PowerShell script
  const pathsArg = imagePaths.join("|");

  try {
    const { stdout } = await execFileAsync(
      "powershell",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        OCR_SCRIPT,
        "-ImagePaths",
        pathsArg,
      ],
      { timeout: 60_000, maxBuffer: 10 * 1024 * 1024 }
    );

    const parsed = JSON.parse(stdout.trim());
    // PowerShell outputs a single object (not array) when there's only one result
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch (err: any) {
    return imagePaths.map((p) => ({
      path: p,
      text: "",
      error: err.message || "OCR failed",
    }));
  }
}

/**
 * Run OCR on images and return a compact text summary.
 * Each entry includes the filename timestamp and extracted text.
 */
export async function ocrScreenshotsToText(
  imagePaths: string[]
): Promise<string> {
  const results = await ocrImages(imagePaths);

  return results
    .filter((r) => r.text.trim().length > 0)
    .map((r) => {
      // Extract timestamp from filename (YYYY-MM-DD_HH-MM-SS)
      const match = r.path.match(/(\d{2})-(\d{2})-(\d{2})_\d{2}-\d{2}_/);
      const time = match ? `${match[1]}:${match[2]}:${match[3]}` : "??:??";
      return `[${time}] ${r.text.trim()}`;
    })
    .join("\n");
}
