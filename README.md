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

| Tier | Model | Backend | Speed |
|------|-------|---------|-------|
| **Fast** (default) | Haiku 4.5 | Anthropic **SDK** over your Claude subscription OAuth token | ~a few seconds |
| **Balanced** | Sonnet | SDK if you set an API key, otherwise Claude CLI | fast w/ key, ~2 min via CLI |
| **Best** | Opus | SDK if you set an API key, otherwise Claude CLI | ~2 min via CLI |

The Fast path uses the official `@anthropic-ai/sdk` with the OAuth token that
Claude Code already stores in `~/.claude/.credentials.json` (scope
`user:inference`) — **no API key needed**, and it's ~40× faster than shelling
out to `claude -p` (seconds vs. minutes). The subscription only permits Haiku
over the direct API, so Sonnet/Opus fall through to the CLI unless you provide
a real `ANTHROPIC_API_KEY` (which unlocks fast Sonnet/Opus via the SDK with no
limits). Order of precedence: real API key → subscription OAuth (Fast only) →
Claude CLI.

Bulk workflow: analyze a whole month on **Fast** (seconds each), review with
the checkboxes + the "ask to change" box, and re-run individual tricky days on
**Best**.

Env knobs (`.env`): `TIMESHEET_LLM` (`api`|`cli` to force a backend),
`TIMESHEET_MODEL` (override the API-key model), `TIMESHEET_RANGE_START`,
`MANICTIME_MCP_PATH`, `MANICTIME_SCREENSHOTS_PATH`.

### Data & caches

- `data/days/YYYY-MM-DD.json` — per-day suggestions/context/status
  (human-readable, git-ignored).
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
