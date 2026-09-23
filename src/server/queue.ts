/**
 * Analysis queue (module singleton, survives Vite HMR via globalThis).
 * Days are analyzed a few at a time: the LLM call dominates each analysis and
 * the SDK backend handles concurrent requests fine, so a small pool of
 * workers cuts a month's catch-up time roughly by the pool size.
 * Tune with TIMESHEET_CONCURRENCY (1 = strictly sequential).
 */

import { analyzeDay } from "./analyzer.js";
import { updateDay } from "./store.js";
import { DEFAULT_TIER, type ModelTier } from "./llm.js";
import type { QueueStatus } from "../lib/types.js";

interface QueueState {
  running: string[];
  pending: string[];
  tiers: Record<string, ModelTier>; // date -> tier to analyze with
  recentErrors: { date: string; error: string }[];
  workers: number;
}

const g = globalThis as { __tsQueueState?: QueueState };
const state: QueueState = (g.__tsQueueState ??= {
  running: [],
  pending: [],
  tiers: {},
  recentErrors: [],
  workers: 0,
});
// Older HMR-surviving state stored a single `running` date (or null).
if (!Array.isArray(state.running)) state.running = [];
state.workers ??= 0;

function concurrency(): number {
  const n = Number(process.env.TIMESHEET_CONCURRENCY);
  return Number.isInteger(n) && n >= 1 ? Math.min(n, 8) : 3;
}

export function queueStatus(): QueueStatus {
  return {
    running: [...state.running],
    pending: [...state.pending],
    recentErrors: [...state.recentErrors],
  };
}

/** Is this date actually being analyzed (or waiting) right now? */
export function isQueued(date: string): boolean {
  return state.running.includes(date) || state.pending.includes(date);
}

export async function enqueueDays(
  dates: string[],
  tier: ModelTier = DEFAULT_TIER
): Promise<QueueStatus> {
  for (const date of dates) {
    state.tiers[date] = tier; // remember the chosen tier for this date
    if (isQueued(date)) continue;
    state.pending.push(date);
    await updateDay(date, (r) => {
      r.status = "analyzing";
      r.error = undefined;
    });
  }
  // Top up the pool; surplus workers exit as soon as pending is empty.
  for (let i = state.workers; i < concurrency() && state.pending.length > 0; i++) {
    state.workers++;
    void work();
  }
  return queueStatus();
}

async function work(): Promise<void> {
  try {
    while (state.pending.length > 0) {
      const date = state.pending.shift()!;
      const tier = state.tiers[date] ?? DEFAULT_TIER;
      delete state.tiers[date];
      state.running.push(date);
      try {
        const rec = await analyzeDay(date, tier);
        if (rec.status === "error") {
          state.recentErrors.unshift({ date, error: rec.error ?? "unknown error" });
        }
      } catch (err) {
        state.recentErrors.unshift({
          date,
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        state.recentErrors.splice(10);
        state.running = state.running.filter((d) => d !== date);
      }
    }
  } finally {
    state.workers--;
  }
}
