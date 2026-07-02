/**
 * ManicTime data access via the local ManicTime MCP server (stdio).
 *
 * Spawns `ManicTimeMcp.exe` once (lazy) and keeps the connection for the
 * lifetime of the dev server. All methods return plain data structures.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { addDays, format, parseISO } from "date-fns";
import type { Dump } from "../manictime/timeline-lib.js";

const MCP_EXE =
  process.env.MANICTIME_MCP_PATH ??
  "C:\\Program Files\\ManicTime\\ManicTimeMcp.exe";

// Keep the spawned ManicTimeMcp.exe across Vite HMR reloads — otherwise every
// server-code edit during dev leaks a child process.
const g = globalThis as { __tsMcpClient?: Promise<Client> | null };

async function connect(): Promise<Client> {
  const client = new Client(
    { name: "time-sheet-web", version: "1.0.0" },
    { capabilities: {} }
  );
  const transport = new StdioClientTransport({
    command: MCP_EXE,
    args: [],
    stderr: "ignore",
  });
  await client.connect(transport);
  return client;
}

async function getClient(): Promise<Client> {
  if (!g.__tsMcpClient) {
    g.__tsMcpClient = connect().catch((err) => {
      g.__tsMcpClient = null;
      throw err;
    });
  }
  return g.__tsMcpClient;
}

async function resetClient(): Promise<void> {
  const old = g.__tsMcpClient;
  g.__tsMcpClient = null;
  if (old) {
    try {
      const client = await old;
      await client.close(); // terminates the child process
    } catch {
      // already dead — nothing to close
    }
  }
}

/** Call an MCP tool and parse the JSON payload from the text content. */
async function callTool<T>(name: string, request: unknown): Promise<T> {
  const client = await getClient();
  let result;
  try {
    result = await client.callTool({ name, arguments: { request } });
  } catch (err) {
    // Transport-level failure (ManicTime restart etc.) — close the dead
    // client, reconnect, retry once. Surface the ORIGINAL error if the
    // retry fails too.
    await resetClient();
    try {
      const retry = await getClient();
      result = await retry.callTool({ name, arguments: { request } });
    } catch {
      throw err instanceof Error
        ? err
        : new Error(`MCP call ${name} failed: ${String(err)}`);
    }
  }
  if (result.isError) {
    const errText = (result.content as { text?: string }[] | undefined)
      ?.map((c) => c.text)
      .filter(Boolean)
      .join(" ");
    throw new Error(`MCP tool ${name} returned an error: ${errText || "unknown"}`);
  }
  const content = (result.content ?? []) as { type: string; text?: string }[];
  const text = content.find((c) => c.type === "text")?.text;
  if (!text) throw new Error(`MCP tool ${name} returned no text content`);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      `MCP tool ${name} returned non-JSON payload: ${text.slice(0, 200)}`
    );
  }
}

/** Full combined-activities dump for one local day (00:00 → next 00:00). */
export async function getDayActivities(date: string): Promise<Dump> {
  const next = format(addDays(parseISO(date), 1), "yyyy-MM-dd");
  return callTool<Dump>("get_combined_activities", {
    fromTime: `${date}T00:00:00`,
    toTime: `${next}T00:00:00`,
    fields: [
      { name: "activityName" },
      { name: "summaryType" },
      { name: "groupName" },
      { name: "groupKey" },
    ],
    maxRowCount: 10000,
  });
}

/** Parse a .NET TimeSpan string ("14:17:49" or "1.02:03:04[.fff]") to minutes. */
export function timespanToMinutes(ts: string): number {
  const m = /^(?:(\d+)\.)?(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?$/.exec(ts.trim());
  if (!m) return 0;
  const [, days, hh, mm, ss] = m;
  return (
    (days ? parseInt(days, 10) * 24 * 60 : 0) +
    parseInt(hh, 10) * 60 +
    parseInt(mm, 10) +
    parseInt(ss, 10) / 60
  );
}

export interface DayUsage {
  activeMin: number;
  awayMin: number;
  lockMin: number;
}

interface SummaryDump {
  combinedActivitySummaries: { columns: string[]; rows: unknown[][] };
  timelineActivities: { columns: string[]; rows: unknown[][] };
  groups: { columns: string[]; rows: unknown[][] };
  timeBuckets: { columns: string[]; rows: unknown[][] };
}

/**
 * Per-day computer usage (Active / Away / Session lock minutes) for a whole
 * date range in ONE call. Used by the dashboard. Days without data are absent.
 */
export async function getUsageRange(
  fromDate: string,
  toDate: string
): Promise<Map<string, DayUsage>> {
  const dump = await callTool<SummaryDump>("get_combined_activity_summary", {
    fields: [{ name: "groupName", summaryType: "ComputerUsage" }],
    summaryTypes: ["ComputerUsage"],
    fromDate,
    toDate,
    groupByTime: "Day",
    maxRowCount: 2000,
  });

  const col = (t: { columns: string[] }, name: string) =>
    t.columns.indexOf(name);

  // groups: ref -> state name
  const gRef = col(dump.groups, "ref");
  const gName = col(dump.groups, "groupName");
  const groupName = new Map<number, string>();
  for (const r of dump.groups.rows)
    groupName.set(r[gRef] as number, (r[gName] as string).toLowerCase());

  // timelineActivities: ref -> groupRef
  const tRef = col(dump.timelineActivities, "ref");
  const tGroup = col(dump.timelineActivities, "groupRef");
  const tlGroup = new Map<number, number>();
  for (const r of dump.timelineActivities.rows)
    tlGroup.set(r[tRef] as number, r[tGroup] as number);

  // timeBuckets: ref -> date
  const bRef = col(dump.timeBuckets, "ref");
  const bDate = col(dump.timeBuckets, "datetime");
  const bucketDate = new Map<number, string>();
  for (const r of dump.timeBuckets.rows)
    bucketDate.set(r[bRef] as number, (r[bDate] as string).slice(0, 10));

  const sDur = col(dump.combinedActivitySummaries, "duration");
  const sBucket = col(dump.combinedActivitySummaries, "timeBucketRef");
  const sTl = col(dump.combinedActivitySummaries, "timelineActivityRef");

  const out = new Map<string, DayUsage>();
  for (const r of dump.combinedActivitySummaries.rows) {
    const date = bucketDate.get(r[sBucket] as number);
    if (!date) continue;
    const state = groupName.get(tlGroup.get(r[sTl] as number) ?? -1) ?? "";
    const minutes = timespanToMinutes(r[sDur] as string);
    let usage = out.get(date);
    if (!usage) {
      usage = { activeMin: 0, awayMin: 0, lockMin: 0 };
      out.set(date, usage);
    }
    if (state === "active") usage.activeMin += minutes;
    else if (state === "session lock") usage.lockMin += minutes;
    else usage.awayMin += minutes;
  }
  return out;
}
