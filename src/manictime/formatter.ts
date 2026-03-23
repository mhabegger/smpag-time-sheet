/**
 * Formats raw ManicTime MCP combined activity data into clean ActivityBlocks.
 *
 * The MCP get_combined_activities response uses a ref-based structure:
 * - combinedActivities: rows with [startTime, endTime, timelineActivityRefs[]]
 * - timelineActivities: rows with [ref, activityName, groupRef, summaryTypeRef]
 * - groups: rows with [ref, groupName, groupKey]
 * - summaryTypes: rows with [ref, summaryType]
 *
 * This module denormalizes that structure and applies privacy filters.
 */

import type { ActivityBlock, PrivacyFilter } from "./types.js";
import { DEFAULT_PRIVACY_FILTER } from "./types.js";

/** Raw MCP response structure from get_combined_activities */
export interface RawMcpResponse {
  combinedActivities: {
    columns: string[];
    rows: unknown[][];
  };
  timelineActivities: {
    columns: string[];
    rows: unknown[][];
  };
  groups: {
    columns: string[];
    rows: unknown[][];
  };
  summaryTypes: {
    columns: string[];
    rows: unknown[][];
  };
}

interface ResolvedActivity {
  activityName: string;
  groupName: string;
  groupKey: string;
  summaryType: string;
}

/**
 * Transform raw MCP combined activity response into clean ActivityBlocks.
 */
export function formatMcpActivities(
  raw: RawMcpResponse,
  privacyFilter: PrivacyFilter = DEFAULT_PRIVACY_FILTER
): ActivityBlock[] {
  // Build lookup maps from refs
  const summaryTypeMap = new Map<number, string>();
  for (const row of raw.summaryTypes.rows) {
    summaryTypeMap.set(row[0] as number, row[1] as string);
  }

  const groupMap = new Map<number, { name: string; key: string }>();
  for (const row of raw.groups.rows) {
    groupMap.set(row[0] as number, {
      name: row[1] as string,
      key: row[2] as string,
    });
  }

  const activityMap = new Map<number, ResolvedActivity>();
  for (const row of raw.timelineActivities.rows) {
    const ref = row[0] as number;
    const activityName = row[1] as string;
    const groupRef = row[2] as number;
    const summaryTypeRef = row[3] as number;

    const group = groupMap.get(groupRef);
    const summaryType = summaryTypeMap.get(summaryTypeRef);

    activityMap.set(ref, {
      activityName,
      groupName: group?.name ?? "",
      groupKey: group?.key ?? "",
      summaryType: summaryType ?? "",
    });
  }

  // Build activity blocks from combined activities
  const blocks: ActivityBlock[] = [];

  for (const row of raw.combinedActivities.rows) {
    const startTime = row[0] as string;
    const endTime = row[1] as string;
    const activityRefs = row[2] as number[];

    const resolved = activityRefs
      .map((ref) => activityMap.get(ref))
      .filter((a): a is ResolvedActivity => a != null);

    // Determine computer state
    const computerUsage = resolved.find(
      (a) => a.summaryType === "ComputerUsage"
    );
    let computerState: ActivityBlock["computerState"] = "unknown";
    if (computerUsage) {
      const key = computerUsage.groupKey.toLowerCase();
      if (key.includes("active")) computerState = "active";
      else if (key.includes("locked")) computerState = "locked";
      else computerState = "away";
    }

    // Skip non-active periods
    if (computerState !== "active" && computerState !== "unknown") continue;

    // Collect details by type
    const applications = resolved
      .filter((a) => a.summaryType === "Application")
      .map((a) => ({
        name: a.groupName,
        windowTitle: a.activityName,
        key: a.groupKey,
      }));

    const websites = resolved
      .filter((a) => a.summaryType === "WebSite")
      .map((a) => ({
        domain: a.groupName,
        url: a.activityName,
      }));

    const documents = resolved
      .filter((a) => a.summaryType === "Document")
      .map((a) => ({
        name: a.groupName,
        path: a.activityName,
      }));

    const tags = resolved
      .filter((a) => a.summaryType === "Tag")
      .map((a) => a.groupName);

    // Calculate duration
    const start = new Date(startTime);
    const end = new Date(endTime);
    const durationMinutes = (end.getTime() - start.getTime()) / 60000;

    // Skip very short blocks (under 10 seconds)
    if (durationMinutes < 0.16) continue;

    const block: ActivityBlock = {
      startTime,
      endTime,
      durationMinutes,
      applications,
      websites,
      documents,
      computerState,
      tags,
    };

    // Apply privacy filter
    if (!isPrivate(block, privacyFilter)) {
      blocks.push(block);
    }
  }

  return blocks;
}

/** Check if an activity block should be filtered as private */
function isPrivate(block: ActivityBlock, filter: PrivacyFilter): boolean {
  // Check excluded domains
  for (const site of block.websites) {
    if (filter.excludeDomains.some((d) => site.domain.includes(d))) {
      return true;
    }
  }

  // Check excluded apps
  for (const app of block.applications) {
    if (
      filter.excludeApps.some(
        (a) => app.name.toLowerCase().includes(a.toLowerCase())
      )
    ) {
      return true;
    }
  }

  // Check excluded title patterns
  for (const app of block.applications) {
    for (const pattern of filter.excludeTitlePatterns) {
      if (new RegExp(pattern, "i").test(app.windowTitle)) {
        return true;
      }
    }
  }

  // Check personal email (but allow if seems test-related)
  for (const app of block.applications) {
    const title = app.windowTitle.toLowerCase();
    for (const email of filter.personalEmails) {
      if (title.includes(email.toLowerCase())) {
        // Allow if it looks like a test context
        if (title.includes("test") || title.includes("debug")) continue;
        return true;
      }
    }
  }

  return false;
}

/**
 * Merge adjacent activity blocks that are very close together (< 2 min gap)
 * to reduce fragmentation.
 */
export function mergeAdjacentBlocks(
  blocks: ActivityBlock[],
  maxGapMinutes = 2
): ActivityBlock[] {
  if (blocks.length === 0) return [];

  const sorted = [...blocks].sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );

  const merged: ActivityBlock[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = sorted[i];
    const gap =
      (new Date(curr.startTime).getTime() -
        new Date(prev.endTime).getTime()) /
      60000;

    if (gap <= maxGapMinutes) {
      // Merge into previous block
      prev.endTime = curr.endTime;
      prev.durationMinutes =
        (new Date(prev.endTime).getTime() -
          new Date(prev.startTime).getTime()) /
        60000;
      prev.applications.push(...curr.applications);
      prev.websites.push(...curr.websites);
      prev.documents.push(...curr.documents);
      prev.tags.push(...curr.tags);
    } else {
      merged.push(curr);
    }
  }

  return merged;
}
