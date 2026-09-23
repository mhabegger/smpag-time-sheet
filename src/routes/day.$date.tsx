import * as React from "react";
import {
  createFileRoute,
  Link,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { addDays, format, parseISO } from "date-fns";
import {
  AlertTriangle,
  ArrowLeft,
  BookmarkPlus,
  ChevronLeft,
  ChevronRight,
  Check,
  EyeOff,
  Loader2,
  RefreshCw,
  Send,
  Sparkles,
} from "lucide-react";
import {
  fetchDay,
  fetchOptions,
  queueAnalysis,
  recheckManicTime,
  addRecurringMemory,
  saveDayContext,
  saveDayEntries,
  setDayIgnored,
} from "@/server/fns";
import { useHotkeys } from "@/lib/hotkeys";
import { findRecurringRuleCandidate } from "@/lib/recurring";
import { fmtDuration, timeToMin, cn, endMinOf, fmtTime } from "@/lib/utils";
import { STATUS_META } from "@/lib/status";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/input";
import { DayTimeline } from "@/components/day-timeline";
import { CalendarConnect } from "@/components/calendar-connect";
import { EntryTable } from "@/components/entry-table";
import { ChatEdit } from "@/components/chat-edit";
import {
  useDayThumbnails,
  ScreenshotViewer,
  type ShotRange,
} from "@/components/screenshots";
import { SubmitDialog } from "@/components/submit-dialog";
import { HelpDialog } from "@/components/help-dialog";
import { TierSelector, useModelTier } from "@/components/tier-selector";
import { useProjectRefresh } from "@/components/use-project-refresh";
import type {
  ChatRef,
  NonWorkSegment,
  ScreenshotThumb,
  SuggestedEntry,
} from "@/lib/types";

export const Route = createFileRoute("/day/$date")({
  loader: async ({ params }) => {
    const [detail, options] = await Promise.all([
      fetchDay({ data: { date: params.date } }),
      fetchOptions({ data: { date: params.date } }).catch(() => []),
    ]);
    return { detail, options };
  },
  component: DayView,
});

function DayView() {
  const { date } = Route.useParams();
  const { detail, options } = Route.useLoaderData();
  const router = useRouter();
  const navigate = useNavigate();
  const [tier, setTier] = useModelTier();
  const { refreshing: projRefreshing, run: runProjectRefresh } = useProjectRefresh();

  const record = detail.record;
  const analyzing = record.status === "analyzing";

  // ---- local editable state (reset when analysis / submit changes the record) ----
  const resetKey = `${date}|${record.analysis?.analyzedAt ?? "none"}|${record.submitResult?.submittedAt ?? "none"}`;
  const [entries, setEntries] = React.useState<SuggestedEntry[]>(record.suggestions);
  const [nonWork, setNonWork] = React.useState<NonWorkSegment[]>(record.nonWork);
  const [context, setContext] = React.useState(record.context ?? "");
  const [dismissedRecurringRule, setDismissedRecurringRule] = React.useState<string | null>(null);
  const [savedRecurringRule, setSavedRecurringRule] = React.useState<string | null>(null);
  const [recurringMemoryMessage, setRecurringMemoryMessage] = React.useState<string | null>(null);
  const [rememberingRule, setRememberingRule] = React.useState(false);
  const lastResetKey = React.useRef(resetKey);
  if (lastResetKey.current !== resetKey) {
    lastResetKey.current = resetKey;
    setEntries(record.suggestions);
    setNonWork(record.nonWork);
    setContext(record.context ?? "");
  }
  React.useEffect(() => {
    setDismissedRecurringRule(null);
    setSavedRecurringRule(null);
    setRecurringMemoryMessage(null);
  }, [date]);

  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [submitOpen, setSubmitOpen] = React.useState(false);
  const [helpOpen, setHelpOpen] = React.useState(false);
  const [openShot, setOpenShot] = React.useState<ScreenshotThumb | null>(null);

  // Height of the sticky header, so the pinned chat box sits right below it
  // (the header wraps to two rows on narrow windows).
  const stickyHeaderRef = React.useRef<HTMLDivElement>(null);
  const [stickyHeaderH, setStickyHeaderH] = React.useState(88);
  React.useLayoutEffect(() => {
    const el = stickyHeaderRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setStickyHeaderH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [shotRange, setShotRange] = React.useState<ShotRange | null>(null);
  const [refs, setRefs] = React.useState<ChatRef[]>([]);
  const contextRef = React.useRef<HTMLTextAreaElement>(null);

  const refedEntryIds = React.useMemo(
    () => new Set(refs.filter((r) => r.kind === "entry").map((r) => r.id)),
    [refs]
  );
  const refedGaps = React.useMemo(
    () =>
      new Set(
        refs.filter((r) => r.kind === "gap").map((r) => `${r.from}-${r.to}`)
      ),
    [refs]
  );
  const toggleEntryRef = (e: SuggestedEntry) =>
    setRefs((cur) =>
      cur.some((r) => r.kind === "entry" && r.id === e.id)
        ? cur.filter((r) => !(r.kind === "entry" && r.id === e.id))
        : [
            ...cur,
            {
              kind: "entry",
              id: e.id,
              label: `${e.from}–${fmtTime(e.to)} ${e.project.replace(/^26__/, "")}`,
            },
          ]
    );
  const toggleGapRef = (from: string, to: string) =>
    setRefs((cur) =>
      cur.some((r) => r.kind === "gap" && r.from === from && r.to === to)
        ? cur.filter((r) => !(r.kind === "gap" && r.from === from && r.to === to))
        : [...cur, { kind: "gap", from, to, label: `gap ${from}–${to}` }]
    );

  const thumbs = useDayThumbnails(detail.screenshots);

  // ---- debounced autosave of entry edits (flushed on unmount / day change) ----
  const dirtyRef = React.useRef(false);
  const latestRef = React.useRef({ date, entries, nonWork });
  latestRef.current = { date, entries, nonWork };
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const trySave = React.useCallback(
    (d: string, e: SuggestedEntry[], nw: NonWorkSegment[]) =>
      saveDayEntries({ data: { date: d, suggestions: e, nonWork: nw } })
        .then(() => setSaveError(null))
        .catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[autosave] failed for ${d}:`, err);
          // Re-mark dirty only while still on the same day — the flushes and
          // the retry button then resend the current edits.
          if (latestRef.current.date === d) dirtyRef.current = true;
          setSaveError(`Saving ${d} failed: ${msg}`);
        }),
    []
  );
  React.useEffect(() => {
    if (!dirtyRef.current) return;
    const t = setTimeout(() => {
      dirtyRef.current = false;
      void trySave(date, entries, nonWork);
    }, 700);
    return () => {
      clearTimeout(t);
      if (dirtyRef.current && latestRef.current.date !== date) {
        dirtyRef.current = false;
        void trySave(date, entries, nonWork);
      }
    };
  }, [entries, nonWork, date, trySave]);
  React.useEffect(
    () => () => {
      if (dirtyRef.current) {
        dirtyRef.current = false;
        const { date: d, entries: e, nonWork: nw } = latestRef.current;
        void trySave(d, e, nw);
      }
    },
    [trySave]
  );
  const retrySave = () => {
    dirtyRef.current = false;
    const { date: d, entries: e, nonWork: nw } = latestRef.current;
    void trySave(d, e, nw);
  };

  const changeEntries = (next: SuggestedEntry[]) => {
    dirtyRef.current = true;
    setEntries(next);
  };
  const changeNonWork = (next: NonWorkSegment[]) => {
    dirtyRef.current = true;
    setNonWork(next);
  };

  // ---- polling while analyzing ----
  React.useEffect(() => {
    if (!analyzing) return;
    const t = setInterval(() => router.invalidate(), 2500);
    return () => clearInterval(t);
  }, [analyzing, router]);

  const [autoRefresh, setAutoRefresh] = React.useState(false);
  React.useEffect(() => {
    if (!autoRefresh || !detail.isToday) return;
    const t = setInterval(() => router.invalidate(), 5 * 60_000);
    return () => clearInterval(t);
  }, [autoRefresh, detail.isToday, router]);

  const gotoDay = (delta: number) => {
    const next = format(addDays(parseISO(date), delta), "yyyy-MM-dd");
    if (next > format(new Date(), "yyyy-MM-dd")) return;
    navigate({ to: "/day/$date", params: { date: next } });
  };

  // Ctrl/Cmd+← / → = previous / next day. Skipped while typing in a text
  // field (word-jump there) and while a dialog (e.g. screenshots) is open.
  const gotoDayRef = React.useRef(gotoDay);
  gotoDayRef.current = gotoDay;
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (document.querySelector("[role='dialog']")) return;
      const el = e.target as HTMLElement | null;
      const typing =
        el?.isContentEditable ||
        el?.tagName === "TEXTAREA" ||
        (el?.tagName === "INPUT" &&
          !["checkbox", "radio", "button"].includes((el as HTMLInputElement).type));
      if (typing) return;
      e.preventDefault();
      gotoDayRef.current(e.key === "ArrowLeft" ? -1 : 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const saveContextNow = async () => {
    if ((record.context ?? "") !== context)
      await saveDayContext({ data: { date, context } });
  };

  const recurringCandidate = React.useMemo(
    () => findRecurringRuleCandidate(context),
    [context]
  );
  const showRecurringSuggestion =
    recurringCandidate &&
    recurringCandidate !== dismissedRecurringRule &&
    recurringCandidate !== savedRecurringRule;
  const rememberRecurringRule = async () => {
    if (!recurringCandidate || rememberingRule) return;
    setRememberingRule(true);
    try {
      const result = await addRecurringMemory({ data: { rule: recurringCandidate } });
      setSavedRecurringRule(recurringCandidate);
      setRecurringMemoryMessage(
        result.added
          ? "Added to local recurring rules. It will be considered on matching future days."
          : "This rule is already stored in local recurring rules."
      );
    } finally {
      setRememberingRule(false);
    }
  };

  const [starting, setStarting] = React.useState(false);
  const analyze = async () => {
    if (starting || analyzing) return;
    setStarting(true); // instant feedback — the record status update lags a beat
    try {
      await saveContextNow();
      await queueAnalysis({ data: { dates: [date], tier } });
      await router.invalidate();
    } finally {
      setStarting(false);
    }
  };

  const [rechecking, setRechecking] = React.useState(false);
  const [recheckedAt, setRecheckedAt] = React.useState<string | null>(null);
  React.useEffect(() => setRecheckedAt(null), [date]);
  const recheck = async () => {
    if (rechecking) return;
    setRechecking(true);
    try {
      await recheckManicTime({ data: { date } });
      await router.invalidate({ sync: true });
      setRecheckedAt(format(new Date(), "HH:mm:ss"));
    } finally {
      setRechecking(false);
    }
  };

  const toggleIgnore = async () => {
    await setDayIgnored({ data: { date, ignored: record.status !== "ignored" } });
    router.invalidate();
  };

  // Approve the first unapproved row at-or-after the selection and select it —
  // pressing n repeatedly walks down the table validating rows; edit a row
  // first and n approves that edited row before moving on.
  const approveNext = () => {
    const sorted = [...entries].sort((a, b) => timeToMin(a.from) - timeToMin(b.from));
    const idx = selectedId ? sorted.findIndex((x) => x.id === selectedId) : -1;
    const target = sorted.slice(Math.max(0, idx)).find((x) => !x.approved);
    if (!target) return;
    changeEntries(entries.map((x) => (x.id === target.id ? { ...x, approved: true } : x)));
    setSelectedId(target.id);
    document
      .querySelector(`[data-entry-id="${target.id}"]`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  useHotkeys({
    "[": () => gotoDay(-1),
    "]": () => gotoDay(1),
    a: () => void analyze(),
    c: () => contextRef.current?.focus(),
    "/": () =>
      (document.querySelector("[data-chat-edit] textarea") as HTMLTextAreaElement | null)?.focus(),
    s: () => entries.length > 0 && setSubmitOpen(true),
    n: () => approveNext(),
    e: () => (document.querySelector("[data-add-entry]") as HTMLButtonElement | null)?.click(),
    x: () => void toggleIgnore(),
    g: () => navigate({ to: "/", search: { month: date.slice(0, 7) } }),
    "shift+?": () => setHelpOpen(true),
  });

  const meta = STATUS_META[record.status];
  const weekday = format(parseISO(date), "EEEE");
  const zepMin = detail.zepEntries.reduce(
    (s, z) => s + Math.max(0, endMinOf(z.to) - timeToMin(z.from)),
    0
  );

  // Everything reviewed = there are entries and all of them are approved.
  const allReviewed = entries.length > 0 && entries.every((e) => e.approved);

  return (
    <div
      className={cn(
        "min-h-screen transition-colors",
        allReviewed && "bg-ok/[0.06]"
      )}
    >
      <div
        className={cn(
          "mx-auto max-w-[1700px] p-6",
          allReviewed && "ring-1 ring-inset ring-ok/20"
        )}
      >
      {/* header + meta strip stay pinned to the top while scrolling */}
      <div
        ref={stickyHeaderRef}
        className="sticky top-0 z-40 -mx-6 mb-4 border-b border-border/60 bg-background/95 px-6 pb-2 pt-3 backdrop-blur"
      >
      <header className="mb-2 flex flex-wrap items-center gap-3">
        <Link
          to="/"
          search={{ month: date.slice(0, 7) }}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft size={14} /> Dashboard
        </Link>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={() => gotoDay(-1)} title="Previous day ([ or Ctrl+←)">
            <ChevronLeft size={16} />
          </Button>
          <h1 className="min-w-56 text-center text-lg font-semibold tabular-nums">
            {weekday}, {date}
          </h1>
          <Button variant="ghost" size="icon" onClick={() => gotoDay(1)} title="Next day (] or Ctrl+→)">
            <ChevronRight size={16} />
          </Button>
        </div>
        <Badge
          variant={
            record.status === "submitted"
              ? "ok"
              : record.status === "analyzed" || record.status === "partial"
                ? "warn"
                : record.status === "error" || record.status === "missing"
                  ? "bad"
                  : record.status === "analyzing"
                    ? "info"
                    : "default"
          }
        >
          {analyzing && <Loader2 size={11} className="animate-spin" />}
          {meta.label}
        </Badge>
        {saveError && (
          <button
            onClick={retrySave}
            title={saveError}
            className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-destructive/50 bg-destructive/10 px-2 py-0.5 text-xs text-bad hover:bg-destructive/20"
          >
            <AlertTriangle size={11} /> unsaved edits — click to retry
          </button>
        )}

        <div className="ml-auto flex items-center gap-2">
          <TierSelector tier={tier} onChange={setTier} />
          {detail.isToday && (
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="size-3.5 accent-[var(--primary)]"
              />
              auto-refresh
            </label>
          )}
          <Button
            variant="secondary"
            size="sm"
            disabled={projRefreshing}
            onClick={() => runProjectRefresh(date.slice(0, 7), () => router.invalidate())}
            title="Re-fetch ZEP projects & tasks and reload"
          >
            <RefreshCw size={13} className={cn(projRefreshing && "animate-spin")} />
            {projRefreshing && <span className="ml-1">Updating…</span>}
          </Button>
          <Button variant="outline" size="sm" onClick={toggleIgnore} title="Ignore day (x)">
            <EyeOff size={13} />
            {record.status === "ignored" ? "Un-ignore" : "Ignore"}
          </Button>
          <Button
            size="sm"
            onClick={analyze}
            disabled={analyzing || starting}
            title="Analyze (a)"
          >
            {analyzing || starting ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Sparkles size={13} />
            )}
            {starting ? "Starting…" : record.analysis ? "Re-analyze" : "Analyze"}
          </Button>
          <Button
            size="sm"
            className="bg-ok text-background hover:bg-ok/85"
            disabled={entries.length === 0}
            onClick={() => setSubmitOpen(true)}
            title="Review & submit (s)"
          >
            <Send size={13} /> Submit…
          </Button>
        </div>
      </header>

      {/* meta strip */}
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
        <span>
          Active:{" "}
          <span className="font-medium text-foreground">{fmtDuration(detail.activeMinutes)}</span>
          {detail.firstActive && <> ({detail.firstActive}–{detail.lastActive})</>}
        </span>
        <span>
          In ZEP:{" "}
          <span className={cn("font-medium", zepMin > 0 ? "text-ok" : "text-foreground")}>
            {fmtDuration(zepMin)}
          </span>
        </span>
        {record.analysis && (
          <span>
            Analyzed {format(new Date(record.analysis.analyzedAt), "MMM d HH:mm")} ·{" "}
            {record.analysis.model}
            {record.analysis.partialUntil && ` · covers until ${record.analysis.partialUntil}`}
          </span>
        )}
      </div>
      </div>

      {record.error && (
        <div className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm whitespace-pre-wrap">
          {record.error}
        </div>
      )}

      {record.analysis?.summary && (
        <p className="mb-4 rounded-md border border-border bg-card/60 p-3 text-sm text-muted-foreground">
          {record.analysis.summary}
        </p>
      )}

      {allReviewed && (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-ok/40 bg-ok/10 p-3 text-sm">
          <Check size={16} className="text-ok" />
          <span className="font-medium text-ok">
            All {entries.length} entries reviewed.
          </span>
          <span className="text-muted-foreground">
            Everything except the gaps is accounted for — press <kbd>s</kbd> to submit to ZEP.
          </span>
        </div>
      )}

      {/* context notes */}
      <section className="mb-5">
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Context for this day{" "}
          <span className="font-normal normal-case opacity-70">
            — tell the analyzer what it can't see (customer visits, meetings, vacation…). Saved on blur; used on next analyze. <kbd>c</kbd>
          </span>
        </label>
        <Textarea
          ref={contextRef}
          rows={2}
          value={context}
          placeholder='e.g. "09:00-12:00 on-site at CH Media with S. Handke (P80133 / 1.2)" or "afternoon off"'
          onChange={(e) => setContext(e.target.value)}
          onBlur={() => void saveContextNow()}
          onKeyDown={(e) => {
            if (e.key === "Escape") (e.target as HTMLTextAreaElement).blur();
          }}
        />
        {showRecurringSuggestion && (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-primary/35 bg-primary/10 px-3 py-2 text-sm">
            <BookmarkPlus size={15} className="text-primary" />
            <span className="text-muted-foreground">
              This sounds recurring: <span className="text-foreground">“{recurringCandidate}”</span>
            </span>
            <Button
              size="sm"
              variant="secondary"
              disabled={rememberingRule}
              onClick={() => void rememberRecurringRule()}
            >
              {rememberingRule ? "Adding…" : "Add to recurring rules"}
            </Button>
            <button
              type="button"
              className="text-xs text-muted-foreground underline hover:text-foreground"
              onClick={() => setDismissedRecurringRule(recurringCandidate)}
            >
              Not now
            </button>
          </div>
        )}
        {savedRecurringRule === recurringCandidate && (
          <p className="mt-2 text-xs text-ok">
            {recurringMemoryMessage}
          </p>
        )}
      </section>

      {/* timeline */}
      {detail.timeline.length === 0 ? (
        <section className="mb-5">
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-dashed border-border bg-card/60 p-4 text-sm text-muted-foreground">
            <span>No ManicTime activity recorded for this day.</span>
            <Button
              variant="secondary"
              size="sm"
              disabled={rechecking}
              onClick={() => void recheck()}
              title="Re-query ManicTime for this day (bypasses the cached result)"
            >
              <RefreshCw size={13} className={cn(rechecking && "animate-spin")} />
              {rechecking ? "Checking ManicTime…" : "Check ManicTime again"}
            </Button>
            {recheckedAt && !rechecking && (
              <span className="text-xs text-warn">
                Re-checked at {recheckedAt} — ManicTime still reports no activity for this day.
              </span>
            )}
          </div>
          {/* Meetings away from the computer still show up here. */}
          {detail.calendar.events.length > 0 && (
            <div className="mt-3">
              <DayTimeline
                timeline={detail.timeline}
                entries={entries}
                nonWork={nonWork}
                zepEntries={detail.zepEntries}
                calendar={detail.calendar.events}
              />
            </div>
          )}
          <CalendarConnect calendar={detail.calendar} onConnected={() => void router.invalidate()} />
        </section>
      ) : (
        <section className="mb-5">
          <DayTimeline
            calendar={detail.calendar.status === "ok" ? detail.calendar.events : undefined}
            timeline={detail.timeline}
            entries={entries}
            nonWork={nonWork}
            zepEntries={detail.zepEntries}
            selectedId={selectedId}
            onSelectEntry={(id) => {
              setSelectedId(id);
              document
                .querySelector(`[data-entry-id="${id}"]`)
                ?.scrollIntoView({ block: "center", behavior: "smooth" });
            }}
          />
          <CalendarConnect calendar={detail.calendar} onConnected={() => void router.invalidate()} />
        </section>
      )}

      {/* chat-to-edit */}
      {(entries.length > 0 || record.analysis) && (
        <section
          className={cn("mb-5", refs.length > 0 && "sticky z-30")}
          style={refs.length > 0 ? { top: stickyHeaderH + 8 } : undefined}
        >
          <ChatEdit
            date={date}
            entries={entries}
            nonWork={nonWork}
            refs={refs}
            tier={tier}
            onRemoveRef={(ref) =>
              setRefs((cur) =>
                cur.filter((r) =>
                  r.kind === "entry" && ref.kind === "entry"
                    ? r.id !== ref.id
                    : r.kind === "gap" && ref.kind === "gap"
                      ? !(r.from === ref.from && r.to === ref.to)
                      : true
                )
              )
            }
            onResult={(r) => {
              dirtyRef.current = true;
              setEntries(r.entries);
              setNonWork(r.nonWork);
              setRefs([]); // references consumed
            }}
          />
        </section>
      )}

      {/* suggestions editor */}
      <section className="mb-5">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Suggested entries{" "}
          {entries.length > 0 && (
            <span className="opacity-60">
              — tick the left box to approve (green): it locks the row from AI edits and survives re-analysis. Rows already in ZEP are shown greyed with a lock.
            </span>
          )}
        </h2>
        {entries.length === 0 && !analyzing && (
          <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No suggestions yet.{" "}
            <button className="text-primary underline cursor-pointer" onClick={analyze}>
              Analyze this day
            </button>{" "}
            or add entries manually.
          </div>
        )}
        {analyzing && entries.length === 0 ? (
          <div className="flex items-center gap-2 rounded-md border border-border p-6 text-sm text-muted-foreground">
            <Loader2 size={14} className="animate-spin" /> Analyzing — fetching ManicTime data,
            OCR-ing screenshots and classifying…
          </div>
        ) : (
          <EntryTable
            onSubmit={() => setSubmitOpen(true)}
            entries={entries}
            zepEntries={detail.zepEntries}
            nonWork={nonWork}
            options={options}
            screenshots={detail.screenshots}
            thumbs={thumbs}
            onOpenShot={(s, range) => {
              setShotRange(range);
              setOpenShot(s);
            }}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onChange={changeEntries}
            onNonWorkChange={changeNonWork}
            refedEntryIds={refedEntryIds}
            refedGaps={refedGaps}
            onToggleEntryRef={toggleEntryRef}
            onToggleGapRef={toggleGapRef}
          />
        )}
      </section>

      <SubmitDialog
        open={submitOpen}
        onClose={() => setSubmitOpen(false)}
        date={date}
        entries={entries}
        options={options}
        onSubmitted={() => router.invalidate()}
        onPickTask={(id, patch) =>
          changeEntries(
            entries.map((e) =>
              e.id === id ? { ...e, ...patch, locked: true } : e
            )
          )
        }
      />
      <ScreenshotViewer
        shots={detail.screenshots}
        thumbs={thumbs}
        current={openShot}
        range={shotRange}
        onClose={() => setOpenShot(null)}
        onNavigate={setOpenShot}
      />
      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
      </div>
    </div>
  );
}
