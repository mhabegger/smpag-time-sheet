/**
 * TanStack Start server functions — the only bridge between the browser and
 * the server layer. All heavy imports happen inside handlers so nothing
 * server-only leaks into the client bundle.
 */

import { createServerFn } from "@tanstack/react-start";
import type { ModelTier } from "./llm.js";
import type {
  ChatRef,
  DashboardData,
  DayDetail,
  DayRecord,
  MonthData,
  ProjectTaskOption,
  QueueStatus,
  SuggestedEntry,
  NonWorkSegment,
} from "../lib/types.js";

export const fetchDashboard = createServerFn({ method: "GET" })
  .validator((d?: { rangeStart?: string }) => d ?? {})
  .handler(async ({ data }): Promise<DashboardData> => {
    const { getDashboardData } = await import("./service.js");
    return getDashboardData(data.rangeStart);
  });

export const fetchMonth = createServerFn({ method: "GET" })
  .validator((d?: { month?: string }) => d ?? {})
  .handler(async ({ data }): Promise<MonthData> => {
    const { getMonthData } = await import("./service.js");
    return getMonthData(data.month);
  });

export const fetchDay = createServerFn({ method: "GET" })
  .validator((d: { date: string }) => d)
  .handler(async ({ data }): Promise<DayDetail> => {
    const { getDayDetail } = await import("./service.js");
    return getDayDetail(data.date);
  });

export const fetchOptions = createServerFn({ method: "GET" })
  .validator((d: { date: string }) => d)
  .handler(async ({ data }): Promise<ProjectTaskOption[]> => {
    const { getOptions } = await import("./service.js");
    return getOptions(data.date);
  });

export const fetchQueue = createServerFn({ method: "GET" }).handler(
  async (): Promise<QueueStatus> => {
    const { queueStatus } = await import("./queue.js");
    return queueStatus();
  }
);

/** Kick off a background re-fetch of a month's ZEP projects/tasks. */
export const refreshProjects = createServerFn({ method: "POST" })
  .validator((d?: { month?: string }) => d ?? {})
  .handler(async ({ data }) => {
    const { refreshMonth, projectRefreshStatus } = await import("./zep.js");
    const cur = new Date().toISOString().slice(0, 10).slice(0, 7);
    void refreshMonth(data.month ?? cur); // background; poll fetchProjectStatus
    return projectRefreshStatus();
  });

export const fetchProjectStatus = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ refreshing: string[]; lastRefreshed: Record<string, string> }> => {
    const { projectRefreshStatus } = await import("./zep.js");
    return projectRefreshStatus();
  }
);

export const fetchScreenshot = createServerFn({ method: "GET" })
  .validator((d: { path: string }) => d)
  .handler(async ({ data }): Promise<string> => {
    const { readScreenshot } = await import("./screenshots.js");
    return readScreenshot(data.path);
  });

export const ocrScreenshot = createServerFn({ method: "POST" })
  .validator((d: { path: string }) => d)
  .handler(async ({ data }): Promise<string> => {
    const { readScreenshot } = await import("./screenshots.js");
    // security check happens inside readScreenshot; reuse it before OCR
    await readScreenshot(data.path);
    const { ocrImages } = await import("../manictime/ocr.js");
    const results = await ocrImages([data.path]);
    return results[0]?.text ?? "";
  });

export const queueAnalysis = createServerFn({ method: "POST" })
  .validator((d: { dates: string[]; tier?: ModelTier }) => d)
  .handler(async ({ data }): Promise<QueueStatus> => {
    const { enqueueDays } = await import("./queue.js");
    return enqueueDays(data.dates, data.tier ?? "fast");
  });

export const chatEdit = createServerFn({ method: "POST" })
  .validator(
    (d: {
      date: string;
      instruction: string;
      entries: SuggestedEntry[];
      nonWork: NonWorkSegment[];
      refs?: ChatRef[];
      tier?: ModelTier;
    }) => d
  )
  .handler(async ({ data }) => {
    const { chatEditDay } = await import("./service.js");
    return chatEditDay(
      data.date,
      data.instruction,
      { entries: data.entries, nonWork: data.nonWork },
      data.refs ?? [],
      data.tier ?? "fast"
    );
  });

export const saveDayContext = createServerFn({ method: "POST" })
  .validator((d: { date: string; context: string }) => d)
  .handler(async ({ data }): Promise<DayRecord> => {
    const { saveContext } = await import("./service.js");
    return saveContext(data.date, data.context);
  });

export const saveDayEntries = createServerFn({ method: "POST" })
  .validator(
    (d: {
      date: string;
      suggestions: SuggestedEntry[];
      nonWork?: NonWorkSegment[];
    }) => d
  )
  .handler(async ({ data }): Promise<DayRecord> => {
    const { saveEntries } = await import("./service.js");
    return saveEntries(data.date, data.suggestions, data.nonWork);
  });

export const setDayIgnored = createServerFn({ method: "POST" })
  .validator((d: { date: string; ignored: boolean }) => d)
  .handler(async ({ data }): Promise<DayRecord> => {
    const { setIgnored } = await import("./service.js");
    return setIgnored(data.date, data.ignored);
  });

export const submitDayToZep = createServerFn({ method: "POST" })
  .validator((d: { date: string; entries: SuggestedEntry[] }) => d)
  .handler(async ({ data }) => {
    const { submitDay } = await import("./service.js");
    return submitDay(data.date, data.entries);
  });
