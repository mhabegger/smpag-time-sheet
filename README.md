# time-sheet-claude

Local web app + CLI tooling that turns **ManicTime** activity data (apps, window
titles, screenshots + Windows OCR) into **ZEP** timesheet entries, with an LLM
doing the day classification.

## Web app (the fast path)

```
pnpm install
pnpm start        # http://localhost:3344
```

### What it does

- **Dashboard** — calendar of the last ~3 months. Each day shows active
  computer time vs. time already booked in ZEP, color-coded:
  red = missing, yellow = partially booked / suggestions ready,
  green = tracked, gray = no activity or ignored.
  "Analyze next 5" / "All missing" queue whole batches for catch-up.
- **Day view** — activity timeline (15-min windows), suggested entries
  (editable table with project/task pickers fed from the ZEP project list),
  entries already in ZEP, screenshot strip with on-demand OCR, and a
  **context box**: write what the analyzer can't see ("on-site at CH Media
  9-12", "afternoon off") *before* analyzing — the analyzer treats it as
  authoritative and skips guessing for those ranges.
- **Submit** — review dialog → confirm → entries are POSTed to ZEP
  (15-min alignment enforced, leaf-task resolution, conflicts with existing
  entries skipped — same rules as the CLI).
- Edits in the table are **pinned** (survive re-analysis). Today can be
  analyzed mid-day and re-analyzed as the day continues (auto-refresh toggle).

### Keyboard shortcuts

Press `?` in the app. Dashboard: arrows + `Enter` select/open days, `[` `]`
prev/next **month**, `a` analyze, `Shift+A` analyze all missing this month,
`x` ignore. Day view: `[` `]` prev/next day, `a` analyze, `c` context box,
`/` ask-to-change box, `n` new entry, `s` submit dialog, `x` ignore. Single-
click a day opens it.

### Analyzer backend & speed

Pick a model tier per analysis (Fast / Balanced / Best selector, top-right):

| Tier | Model | Typical time per day |
|------|-------|----------------------|
| **Fast** | Haiku 4.5 | a few seconds |
| **Balanced** | Sonnet 5 | ~10–20 s |
| **Best** (default) | Opus 5.5 | ~20–40 s |

All tiers use the official `@anthropic-ai/sdk` with the OAuth token Claude
Code already stores in `~/.claude/.credentials.json` — **no API key needed**,
and far faster than shelling out to `claude -p` (seconds vs. minutes). The
subscription accepts Sonnet/Opus over the direct API only when the Claude Code
identity is the first system block (otherwise 429), which the backend adds.
Expired tokens are refreshed automatically by running one tiny `claude -p`
call. Order of precedence: real `ANTHROPIC_API_KEY` → subscription OAuth →
Claude CLI (also used as a fallback if an SDK call fails).

Speed-ups: the rules + the month's project list form a prompt-cached system
prefix shared by every day of that month, and the queue analyzes up to 3 days
in parallel.

Env knobs (`.env`): `TIMESHEET_LLM` (`api`|`cli` to force a backend),
`TIMESHEET_EFFORT` (`low`…`max`, default `medium`), `TIMESHEET_CONCURRENCY`
(parallel analyses, default 3), `TIMESHEET_RANGE_START`,
`MANICTIME_MCP_PATH`, `MANICTIME_SCREENSHOTS_PATH`.


### Outlook calendar (optional)

The day view can show a **Calendar** row with your Outlook meetings, and the
analyzer uses them to book meetings held away from the computer. It reads your
calendar through Microsoft Graph with delegated `Calendars.Read`. There is no
client secret; you sign in once in the browser and the token is cached in
`.cache/msal-token-cache.json`.

One-time setup in the Entra admin center (portal.azure.com → *Microsoft Entra
ID* → *App registrations* → *New registration*):

1. Name it e.g. "Timesheet calendar". Under *Supported account types*, choose
   *Accounts in this organizational directory only*.
2. Under *Redirect URI*, choose platform **Public client/native (mobile &
   desktop)** and enter `http://localhost`.
3. Under *API permissions*, add *Microsoft Graph* → *Delegated* →
   `Calendars.Read`. If your tenant blocks user consent, an admin must click
   *Grant admin consent*.
4. Copy the *Application (client) ID* and *Directory (tenant) ID* into `.env`
   as `MS_GRAPH_CLIENT_ID` / `MS_GRAPH_TENANT_ID`, then restart the server.
5. Open any day and click **Connect Outlook calendar**.

### Data & caches

- `data/days/YYYY-MM-DD.json` — per-day suggestions/context/status
  (human-readable, git-ignored).
- `data/recurring-rules.md` — user-approved recurring facts proposed from the
  context box; they are applied to matching future days. Nothing is added
  without pressing **Add to recurring rules**.
- `.cache/msal-token-cache.json` — Outlook/Graph sign-in (delete to sign out).
- `.cache/zep-projects-YYYY-MM.json` — ZEP project/task list per month (24h TTL).
- ManicTime is queried through the local MCP server
  (`C:\Program Files\ManicTime\ManicTimeMcp.exe`), spawned on demand.

## CLI / Claude Code skill (still works)

- `/timesheet [date]` — interactive assistant in Claude Code
  (`.claude/commands/timesheet.md`).
- `npx tsx src/zep/query-date.ts YYYY-MM-DD` — show ZEP entries for a date.
- `npx tsx src/zep/list-projects.ts YYYY-MM-DD` — project list for a month.
- `npx tsx src/manictime/parse-timeline.ts <dump.json> [bucketMin]` — parse an
  activities dump into a readable timeline.
- `npx tsx src/manictime/screenshot-verify.ts YYYY-MM-DD [interval]` — OCR samples.
- `npx tsx src/zep/submit.ts pending.yaml` — submit a YAML batch.

The web app and the CLI share the same ZEP submission logic
(`src/zep/submit-lib.ts`) and timeline parser (`src/manictime/timeline-lib.ts`).
