---
name: verify
description: How to build, launch, and drive this app to verify changes end-to-end
---

# Verifying time-sheet-claude

## Launch

```bash
pnpm start          # vite dev on http://localhost:3344 (background it)
```

- First SSR request per day/dashboard is slow (spawns ManicTimeMcp.exe, ZEP fetches); warm with `curl.exe` before driving.
- Server-side singletons (dump cache, MCP client, project stores) live on `globalThis` and **survive Vite HMR** — after changing data-layer code, restart the server or stale cached dumps will mask the fix.

## Drive (headless browser)

Edge ≥150's launcher process exits immediately (broker handoff), which breaks `puppeteer.launch` — `scripts/browser-test.ts` fails this way. Instead spawn Edge yourself and connect:

```ts
spawn(EDGE, ["--headless=new", "--remote-debugging-port=9224",
  `--user-data-dir=${process.env.TEMP}\\verify-profile`, "--no-first-run", "about:blank"],
  { detached: true, stdio: "ignore" }).unref();
const browser = await puppeteer.connect({ browserURL: "http://127.0.0.1:9224" });
```

`scripts/verify-fixes.ts` is a working example (drives the submit dialog, autosave, corrupt-file handling; screenshots to `tmp-shots-verify/`, gitignored).

- Entry rows: `[data-entry-id]`; note field is the row's `textarea`; dialogs are `[role='dialog']`; day URL: `/day/YYYY-MM-DD`.
- Simulate a failed autosave with puppeteer request interception aborting POSTs (`/_serverFn/...`) — no server restart needed.
- Day records are plain JSON in `data/days/YYYY-MM-DD.json`; safe to create a scratch day (pick a quiet Sunday), assert against the file after the 700 ms debounced autosave, delete it after. **Back up any real day file before corrupting/overwriting it.**

## Safety

- **Never press the final Submit in the ZEP dialog with resolvable entries — it books real hours.** Ambiguous/unknown task names abort server-side before any POST, so driving the dialog up to the error/picker state is safe.
- ZEP project data comes from `.cache/zep-projects-YYYY-MM.json`; project `26-A-EN` has a real duplicate leaf task (`CH-Stadtfilter`, top-level and under parent `X`) — useful for ambiguity tests.
