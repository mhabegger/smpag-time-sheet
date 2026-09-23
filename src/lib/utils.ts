import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** "HH:mm:ss" or "HH:mm" -> minutes since midnight */
export function timeToMin(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/** minutes since midnight -> "HH:mm" */
export function minToTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * End of day. Stored as the "23:59" sentinel (day files, analyzer, server —
 * submitted to ZEP as 00:00) but always SHOWN as "24:00" so it's explicit.
 */
export const END_OF_DAY = "23:59";

/** Minutes for an END time — the end-of-day sentinel counts as 24:00. */
export function endMinOf(t: string): number {
  return t === END_OF_DAY ? 24 * 60 : timeToMin(t);
}

/** "HH:mm" for display: the end-of-day sentinel reads "24:00". */
export function fmtTime(t: string): string {
  return t === END_OF_DAY ? "24:00" : t;
}

/** minutes -> "7h 45m" */
export function fmtDuration(min: number): string {
  if (min <= 0) return "0m";
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

/** Snap minutes to a 15-minute boundary */
export function snap15(min: number, dir: "down" | "up" | "nearest" = "nearest"): number {
  if (dir === "down") return Math.floor(min / 15) * 15;
  if (dir === "up") return Math.ceil(min / 15) * 15;
  return Math.round(min / 15) * 15;
}
