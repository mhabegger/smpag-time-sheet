import type { DayStatus } from "./types";

export const STATUS_META: Record<
  DayStatus,
  { label: string; cellClass: string; dotClass: string }
> = {
  empty: {
    label: "No activity",
    cellClass: "bg-secondary/25 text-muted-foreground/50",
    dotClass: "bg-muted-foreground/30",
  },
  missing: {
    label: "Missing — needs timesheet",
    cellClass: "bg-bad/15 ring-1 ring-bad/40 hover:bg-bad/25",
    dotClass: "bg-bad",
  },
  analyzing: {
    label: "Analyzing…",
    cellClass: "bg-info/15 ring-1 ring-info/50 animate-pulse",
    dotClass: "bg-info",
  },
  analyzed: {
    label: "Suggestions ready — review & submit",
    cellClass: "bg-warn/15 ring-1 ring-warn/50 hover:bg-warn/25",
    dotClass: "bg-warn",
  },
  partial: {
    label: "Partially tracked in ZEP",
    cellClass: "bg-warn/10 ring-1 ring-warn/30 hover:bg-warn/20",
    dotClass: "bg-warn/70",
  },
  submitted: {
    label: "Tracked in ZEP",
    cellClass: "bg-ok/12 ring-1 ring-ok/30 hover:bg-ok/20",
    dotClass: "bg-ok",
  },
  ignored: {
    label: "Ignored (not booking this day)",
    cellClass: "bg-secondary/40 text-muted-foreground/60 hover:bg-secondary/60",
    dotClass: "bg-muted-foreground/50",
  },
  error: {
    label: "Analysis failed",
    cellClass: "bg-destructive/20 ring-1 ring-destructive/60 hover:bg-destructive/30",
    dotClass: "bg-destructive",
  },
};

/** Brand colors requested by the user for the two main employers. */
const FIXED_PROJECT_COLORS: { match: (p: string) => boolean; color: string }[] = [
  { match: (p) => p === "26__SMPAG", color: "#e31f28" }, // SwissMediaPartners = red
  { match: (p) => p.includes("deliver.media"), color: "#16259D" }, // deliver.media = blue
];

/**
 * Color per project. SMPAG = red, deliver.media = blue (brand colors); every
 * other project gets a deterministic, well-spread hue so it's stable across
 * days and visually distinct from the two brand colors.
 */
export function projectColor(project: string): string {
  if (!project) return "oklch(0.5 0.02 260)";
  for (const f of FIXED_PROJECT_COLORS) if (f.match(project)) return f.color;
  let h = 0;
  for (let i = 0; i < project.length; i++)
    h = (h * 31 + project.charCodeAt(i)) >>> 0;
  // avoid the red (~25) and blue (~265) brand hues so other projects stand apart
  const hue = (60 + (h % 170)) % 360; // 60..230, skipping red & deep blue
  return `oklch(0.68 0.15 ${hue})`;
}
