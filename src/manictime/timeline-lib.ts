/**
 * Core logic for turning a ManicTime `get_combined_activities` dump into a
 * clean, chronological timeline of ACTIVE work blocks bucketed into
 * clock-aligned windows.
 *
 * Shared by the parse-timeline CLI (used by the /timesheet skill) and the
 * web app's analysis pipeline.
 */

export type Table = { columns: string[]; rows: unknown[][] };
export type Dump = Record<string, Table>;

/** Computer-usage state names that mean the user was NOT actively working. */
const INACTIVE_STATES = new Set([
  "away",
  "session lock",
  "power off",
  "awayfromcomputer",
  "inactive",
  "monitor off",
  "screensaver",
]);
const ACTIVE_STATE = "active";
/** All known ComputerUsage state names (active + inactive). */
const STATE_NAMES = new Set([ACTIVE_STATE, ...INACTIVE_STATES]);

type Kind = "app" | "web" | "doc" | "state" | "other";

interface Tl {
  activityName: string;
  groupName: string;
  groupKey: string | null;
  kind: Kind;
  stateName?: string;
}

/** Find the first matching column name — ManicTime's MCP renamed several
 *  columns mid-2026 (groupName→name, groupKey→key, activityName→name,
 *  timelineActivityRefs→activityRefs), so accept both generations. */
function col(table: Table, names: string | string[], fallback: number): number {
  for (const name of Array.isArray(names) ? names : [names]) {
    const i = table.columns.indexOf(name);
    if (i !== -1) return i;
  }
  return fallback;
}

function classify(
  summaryType: string | undefined,
  groupName: string,
  groupKey: string | null
): Kind {
  if (summaryType) {
    switch (summaryType) {
      case "Application":
        return "app";
      case "WebSite":
        return "web";
      case "Document":
        return "doc";
      case "ComputerUsage":
        return "state";
      default:
        return "other";
    }
  }
  if (groupKey && /\.exe/i.test(groupKey)) return "app";
  if (!groupKey && STATE_NAMES.has(groupName.toLowerCase())) return "state";
  return "other";
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}
export function hhmm(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export interface Block {
  start: Date;
  end: Date;
  appNames: Map<string, number>; // name -> seconds
  titles: string[];
  context: string[];
}

export function loadBlocks(dump: Dump): {
  blocks: Block[];
  firstActive: Date | null;
  lastActive: Date | null;
} {
  const ca = dump.combinedActivities;
  // "timelineActivities" (pre-2026 MCP) / "activities" (current MCP)
  const ta = dump.timelineActivities ?? dump.activities;
  const gr = dump.groups;
  if (!ca || !ta || !gr) {
    throw new Error(
      "Dump missing combinedActivities/activities/groups tables"
    );
  }

  const gRef = col(gr, "ref", 0);
  const gName = col(gr, ["groupName", "name"], 1);
  const gKey = col(gr, ["groupKey", "key"], 2);
  // Current MCP carries the summary type on the group.
  const gSummaryIdx = gr.columns.indexOf("summaryType");
  const groupMap = new Map<
    number,
    { name: string; key: string | null; summaryType?: string }
  >();
  for (const r of gr.rows) {
    groupMap.set(r[gRef] as number, {
      name: (r[gName] as string) ?? "",
      key: (r[gKey] as string | null) ?? null,
      summaryType:
        gSummaryIdx !== -1 ? ((r[gSummaryIdx] as string) ?? undefined) : undefined,
    });
  }

  let stMap: Map<number, string> | null = null;
  if (dump.summaryTypes) {
    stMap = new Map();
    const sRef = col(dump.summaryTypes, "ref", 0);
    const sType = col(dump.summaryTypes, "summaryType", 1);
    for (const r of dump.summaryTypes.rows)
      stMap.set(r[sRef] as number, r[sType] as string);
  }

  const tRef = col(ta, "ref", 0);
  const tName = col(ta, ["activityName", "name"], 1);
  const tGroup = col(ta, "groupRef", 2);
  const tSummaryIdx = ta.columns.indexOf("summaryType");
  const tlMap = new Map<number, Tl>();
  for (const r of ta.rows) {
    const ref = r[tRef] as number;
    const group = groupMap.get(r[tGroup] as number) ?? { name: "", key: null };
    let summaryType: string | undefined;
    if (tSummaryIdx !== -1) {
      const v = r[tSummaryIdx];
      summaryType = typeof v === "string" ? v : stMap?.get(v as number);
    }
    if (!summaryType) summaryType = group.summaryType;
    const kind = classify(summaryType, group.name, group.key);
    tlMap.set(ref, {
      activityName: (r[tName] as string) ?? "",
      groupName: group.name,
      groupKey: group.key,
      kind,
      stateName: kind === "state" ? group.name.toLowerCase() : undefined,
    });
  }

  const cStart = col(ca, "startTime", 0);
  const cEnd = col(ca, "endTime", 1);
  const cRefs = col(ca, ["timelineActivityRefs", "activityRefs"], 2);
  const rows = [...ca.rows].sort(
    (a, b) =>
      new Date(a[cStart] as string).getTime() -
      new Date(b[cStart] as string).getTime()
  );

  const raw: Block[] = [];
  let firstActive: Date | null = null;
  let lastActive: Date | null = null;

  for (const r of rows) {
    const start = new Date(r[cStart] as string);
    const end = new Date(r[cEnd] as string);
    const seconds = (end.getTime() - start.getTime()) / 1000;
    const refs = (r[cRefs] as number[]) ?? [];
    const tls = refs
      .map((ref) => tlMap.get(ref))
      .filter((t): t is Tl => t != null);

    const states = tls.filter((t) => t.kind === "state");
    const hasActive = states.some((t) => t.stateName === ACTIVE_STATE);
    const hasInactive = states.some(
      (t) => t.stateName && INACTIVE_STATES.has(t.stateName)
    );
    const apps = tls.filter((t) => t.kind === "app");
    const isActive =
      hasActive || (!hasInactive && states.length === 0 && apps.length > 0);
    if (!isActive) continue;

    if (!firstActive) firstActive = start;
    lastActive = end;

    const appNames = new Map<string, number>();
    const titles: string[] = [];
    const context: string[] = [];
    for (const t of apps) {
      if (t.groupName)
        appNames.set(t.groupName, (appNames.get(t.groupName) ?? 0) + seconds);
      const title = t.activityName.replace(/\s+/g, " ").trim();
      if (title && !titles.includes(title)) titles.push(title);
    }
    for (const t of tls) {
      if (t.kind === "web" || t.kind === "doc" || t.kind === "other") {
        const c = (t.groupName || t.activityName).replace(/\s+/g, " ").trim();
        if (c && !STATE_NAMES.has(c.toLowerCase()) && !context.includes(c))
          context.push(c);
      }
    }

    raw.push({ start, end, appNames, titles, context });
  }

  return { blocks: raw, firstActive, lastActive };
}

export interface Bucket {
  start: Date;
  activeSec: number;
  appNames: Map<string, number>;
  titles: string[];
  context: string[];
}

/**
 * Bucket active blocks into clock-aligned windows of `bucketMin` minutes.
 * Blocks spanning multiple windows are split proportionally so a long
 * uninterrupted block (e.g. a 2h call) doesn't collapse into one window.
 */
export function bucketize(blocks: Block[], bucketMin: number): Bucket[] {
  const ms = bucketMin * 60000;
  const map = new Map<number, Bucket>();
  const touch = (key: number): Bucket => {
    let bk = map.get(key);
    if (!bk) {
      bk = {
        start: new Date(key),
        activeSec: 0,
        appNames: new Map(),
        titles: [],
        context: [],
      };
      map.set(key, bk);
    }
    return bk;
  };

  for (const b of blocks) {
    const startMs = b.start.getTime();
    const endMs = b.end.getTime();
    const totalSec = (endMs - startMs) / 1000;
    for (
      let winStart = Math.floor(startMs / ms) * ms;
      winStart < endMs;
      winStart += ms
    ) {
      const overlapSec =
        (Math.min(endMs, winStart + ms) - Math.max(startMs, winStart)) / 1000;
      if (overlapSec <= 0) continue;
      const bk = touch(winStart);
      bk.activeSec += overlapSec;
      const share = totalSec > 0 ? overlapSec / totalSec : 1;
      for (const [k, v] of b.appNames)
        bk.appNames.set(k, (bk.appNames.get(k) ?? 0) + v * share);
      for (const t of b.titles) if (!bk.titles.includes(t)) bk.titles.push(t);
      for (const c of b.context) if (!bk.context.includes(c)) bk.context.push(c);
    }
  }
  return [...map.values()].sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** Gaps > `minGapMin` minutes between consecutive raw active blocks. */
export function findGaps(
  blocks: Block[],
  minGapMin = 20
): { from: Date; to: Date; minutes: number }[] {
  const gaps: { from: Date; to: Date; minutes: number }[] = [];
  for (let i = 1; i < blocks.length; i++) {
    const gapMin =
      (blocks[i].start.getTime() - blocks[i - 1].end.getTime()) / 60000;
    if (gapMin > minGapMin)
      gaps.push({
        from: blocks[i - 1].end,
        to: blocks[i].start,
        minutes: Math.round(gapMin),
      });
  }
  return gaps;
}

export function fmtBucket(b: Bucket, bucketMin: number): string {
  const end = new Date(b.start.getTime() + bucketMin * 60000);
  const activeMin = Math.round(b.activeSec / 60);
  const apps = [...b.appNames.entries()]
    .sort((a, c) => c[1] - a[1])
    .map(([n]) => n)
    .join(", ");
  let titles = b.titles.slice(0, 12).join(" || ");
  if (b.context.length) titles += `  <ctx: ${b.context.slice(0, 8).join(", ")}>`;
  if (titles.length > 600) titles = titles.slice(0, 600) + "…";
  return `${hhmm(b.start)}-${hhmm(end)} (${activeMin
    .toString()
    .padStart(2)}m active) ${apps}\n        ${titles}`;
}

/** Render the full compact text timeline (used for the LLM prompt and the CLI). */
export function renderTimelineText(
  dump: Dump,
  bucketMin = 15
): {
  text: string;
  firstActive: Date | null;
  lastActive: Date | null;
  buckets: Bucket[];
  gaps: { from: Date; to: Date; minutes: number }[];
} {
  const { blocks, firstActive, lastActive } = loadBlocks(dump);
  const buckets = bucketize(blocks, bucketMin);
  const gaps = findGaps(blocks);

  const lines: string[] = [];
  lines.push(
    `First active: ${firstActive ? hhmm(firstActive) : "—"} | Last active: ${
      lastActive ? hhmm(lastActive) : "—"
    } | ${bucketMin}-min windows with activity: ${buckets.length}`
  );
  lines.push(`=== ACTIVE TIMELINE (clock-aligned ${bucketMin}-min windows) ===`);
  for (const b of buckets) lines.push(fmtBucket(b, bucketMin));
  if (gaps.length) {
    lines.push(`=== GAPS > 20min (away / no active use) ===`);
    lines.push(
      gaps
        .map((g) => `${hhmm(g.from)}-${hhmm(g.to)} (${g.minutes}m)`)
        .join("  |  ")
    );
  }
  return { text: lines.join("\n"), firstActive, lastActive, buckets, gaps };
}
