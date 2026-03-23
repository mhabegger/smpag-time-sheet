/**
 * Time rounding utilities for 15-minute slot boundaries.
 * ZEP tracks time in 15-min increments: :00, :15, :30, :45
 */

/** Round a time string (HH:mm or HH:mm:ss) down to the nearest 15-min boundary */
export function roundDown(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const roundedMin = Math.floor(m / 15) * 15;
  return `${String(h).padStart(2, "0")}:${String(roundedMin).padStart(2, "0")}`;
}

/** Round a time string up to the nearest 15-min boundary */
export function roundUp(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const roundedMin = Math.ceil(m / 15) * 15;
  if (roundedMin >= 60) {
    return `${String(h + 1).padStart(2, "0")}:00`;
  }
  return `${String(h).padStart(2, "0")}:${String(roundedMin).padStart(2, "0")}`;
}

/** Round to nearest 15-min boundary */
export function roundNearest(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const roundedMin = Math.round(m / 15) * 15;
  if (roundedMin >= 60) {
    return `${String(h + 1).padStart(2, "0")}:00`;
  }
  return `${String(h).padStart(2, "0")}:${String(roundedMin).padStart(2, "0")}`;
}

/** Convert HH:mm to total minutes since midnight */
export function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/** Convert total minutes to HH:mm */
export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Calculate duration in minutes between two HH:mm times */
export function durationMinutes(from: string, to: string): number {
  return timeToMinutes(to) - timeToMinutes(from);
}

/** Generate all 15-min slot boundaries between two times */
export function generateSlotBoundaries(from: string, to: string): string[] {
  const startMin = timeToMinutes(from);
  const endMin = timeToMinutes(to);
  const boundaries: string[] = [];

  for (let m = startMin; m <= endMin; m += 15) {
    boundaries.push(minutesToTime(m));
  }

  return boundaries;
}

/** Format duration in minutes as "Xh Ym" */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}
