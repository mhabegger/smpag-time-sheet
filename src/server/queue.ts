/**
 * Sequential analysis queue (module singleton, survives Vite HMR via
 * globalThis). One day is analyzed at a time — the pipeline itself already
 * parallelizes its data fetching, and the LLM call dominates.
 */

import { analyzeDay } from "./analyzer.js";
import { updateDay } from "./store.js";
import type { ModelTier } from "./llm.js";
import type { QueueStatus } from "../lib/types.js";

interface QueueState {
  running: string | null;
  pending: string[];
  tiers: Record<string, ModelTier>; // date -> tier to analyze with
  recentErrors: { date: string; error: string }[];
  working: boolean;
}

const g = globalThis as { __tsQueueState?: QueueState };
const state: QueueState = (g.__tsQueueState ??= {
  running: null,
  pending: [],
  tiers: {},
  recentErrors: [],
  working: false,
});

export function queueStatus(): QueueStatus {
  return {
    running: state.running,
    pending: [...state.pending],
    recentErrors: [...state.recentErrors],
  };
}

/** Is this date actually being analyzed (or waiting) right now? */
export function isQueued(date: string): boolean {
  return state.running === date || state.pending.includes(date);
}

export async function enqueueDays(
  dates: string[],
  tier: ModelTier = "fast"
): Promise<QueueStatus> {
  for (const date of dates) {
    state.tiers[date] = tier; // remember the chosen tier for this date
    if (state.running === date || state.pending.includes(date)) continue;
    state.pending.push(date);
    await updateDay(date, (r) => {
      r.status = "analyzing";
      r.error = undefined;
    });
  }
  void work();
  return queueStatus();
}

async function work(): Promise<void> {
  if (state.working) return;
  state.working = true;
  try {
    while (state.pending.length > 0) {
      const date = state.pending.shift()!;
      const tier = state.tiers[date] ?? "fast";
      delete state.tiers[date];
      state.running = date;
      try {
        const rec = await analyzeDay(date, tier);
        if (rec.status === "error") {
          state.recentErrors.unshift({
            date,
            error: rec.error ?? "unknown error",
          });
        }
      } catch (err) {
        state.recentErrors.unshift({
          date,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      state.recentErrors.splice(10);
      state.running = null;
    }
  } finally {
    state.working = false;
    state.running = null;
  }
}
