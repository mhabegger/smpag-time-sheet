import * as React from "react";
import { refreshProjects, fetchProjectStatus } from "@/server/fns";

/**
 * Re-fetch a month's ZEP projects/tasks. Kicks off the (~30s) background
 * refresh, reloads the page data immediately (activity/ZEP/suggestions), then
 * polls until the project refresh finishes and reloads again so the dropdowns
 * show the current ZEP options.
 */
export function useProjectRefresh() {
  const [refreshing, setRefreshing] = React.useState(false);

  const run = React.useCallback(
    async (month: string, after?: () => void | Promise<void>) => {
      setRefreshing(true);
      try {
        await refreshProjects({ data: { month } });
        await after?.(); // quick reload now (from cache)
        for (let i = 0; i < 40; i++) {
          await new Promise((r) => setTimeout(r, 2000));
          const st = await fetchProjectStatus();
          if (!st.refreshing.includes(month)) break;
        }
        await after?.(); // reload with fresh projects/tasks
      } finally {
        setRefreshing(false);
      }
    },
    []
  );

  return { refreshing, run };
}
