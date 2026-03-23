/**
 * time-sheet-claude library
 *
 * Exports all modules for use by the Claude Code /timesheet skill
 * and for standalone testing.
 */

export { getEnv } from "./config/env.js";
export { ZepClient } from "./zep/client.js";
export { ZepProjectStore } from "./zep/projects.js";
export { AttendanceManager } from "./zep/attendances.js";
export { formatMcpActivities, mergeAdjacentBlocks } from "./manictime/formatter.js";
export { findScreenshots, sampleScreenshots } from "./manictime/screenshots.js";
export * from "./models/rounding.js";
export type { TimeSlot, DayTimeSheet } from "./models/time-block.js";
export type { ActivityBlock, GroupSummary } from "./manictime/types.js";
export type {
  ZepProject,
  ZepTask,
  ZepActivity,
  ZepAttendance,
  CreateAttendanceInput,
  ProjectTaskEntry,
} from "./zep/types.js";
