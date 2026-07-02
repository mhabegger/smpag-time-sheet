import * as React from "react";
import {
  createFileRoute,
  Link,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { addDays, format, parseISO } from "date-fns";
import {
  ArrowLeft,
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
  saveDayContext,
  saveDayEntries,
  setDayIgnored,
} from "@/server/fns";
import { useHotkeys } from "@/lib/hotkeys";
import { fmtDuration, timeToMin, cn } from "@/lib/utils";
import { STATUS_META } from "@/lib/status";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/input";
import { DayTimeline } from "@/components/day-timeline";
import { EntryTable } from "@/components/entry-table";
import { ChatEdit } from "@/components/chat-edit";
import {
  useDayThumbnails,
  ScreenshotViewer,
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
  const lastResetKey = React.useRef(resetKey);
  if (lastResetKey.current !== resetKey) {
    lastResetKey.current = resetKey;
    setEntries(record.suggestions);
    setNonWork(record.nonWork);
    setContext(record.context ?? "");
  }

  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [submitOpen, setSubmitOpen] = React.useState(false);
  const [helpOpen, setHelpOpen] = React.useState(false);
  const [openShot, setOpenShot] = React.useState<ScreenshotThumb | null>(null);
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
              label: `${e.from}–${e.to} ${e.project.replace(/^26__/, "")}`,
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
  React.useEffect(() => {
    if (!dirtyRef.current) return;
    const t = setTimeout(() => {
      dirtyRef.current = false;
      void saveDayEntries({ data: { date, suggestions: entries, nonWork } });
    }, 700);
    return () => {
      clearTimeout(t);
      if (dirtyRef.current && latestRef.current.date !== date) {
        dirtyRef.current = false;
        void saveDayEntries({ data: { date, suggestions: entries, nonWork } });
      }
    };
  }, [entries, nonWork, date]);
  React.useEffect(
    () => () => {
      if (dirtyRef.current) {
        dirtyRef.current = false;
        const { date: d, entries: e, nonWork: nw } = latestRef.current;
        void saveDayEntries({ data: { date: d, suggestions: e, nonWork: nw } });
      }
    },
    []
  );

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

  const saveContextNow = async () => {
    if ((record.context ?? "") !== context)
      await saveDayContext({ data: { date, context } });
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

  const toggleIgnore = async () => {
    await setDayIgnored({ data: { date, ignored: record.status !== "ignored" } });
    router.invalidate();
  };

  useHotkeys({
    "[": () => gotoDay(-1),
    "]": () => gotoDay(1),
    a: () => void analyze(),
    c: () => contextRef.current?.focus(),
    "/": () =>
      (document.querySelector("[data-chat-edit] input") as HTMLInputElement | null)?.focus(),
    s: () => entries.length > 0 && setSubmitOpen(true),
    n: () => (document.querySelector("[data-add-entry]") as HTMLButtonElement | null)?.click(),
    x: () => void toggleIgnore(),
    g: () => navigate({ to: "/", search: { month: date.slice(0, 7) } }),
    "shift+?": () => setHelpOpen(true),
  });

  const meta = STATUS_META[record.status];
  const weekday = format(parseISO(date), "EEEE");
  const zepMin = detail.zepEntries.reduce(
    (s, z) => s + Math.max(0, timeToMin(z.to) - timeToMin(z.from)),
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
      {/* header */}
      <header className="mb-5 flex flex-wrap items-center gap-3">
        <Link
          to="/"
          search={{ month: date.slice(0, 7) }}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft size={14} /> Dashboard
        </Link>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={() => gotoDay(-1)} title="Previous day ([">
            <ChevronLeft size={16} />
          </Button>
          <h1 className="min-w-56 text-center text-lg font-semibold tabular-nums">
            {weekday}, {date}
          </h1>
          <Button variant="ghost" size="icon" onClick={() => gotoDay(1)} title="Next day ]">
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
      <div className="mb-4 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
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
      </section>

      {/* timeline */}
      <section className="mb-5">
        <DayTimeline
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
      </section>

      {/* chat-to-edit */}
      {(entries.length > 0 || record.analysis) && (
        <section className="mb-5">
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
            entries={entries}
            zepEntries={detail.zepEntries}
            nonWork={nonWork}
            options={options}
            screenshots={detail.screenshots}
            thumbs={thumbs}
            onOpenShot={setOpenShot}
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
      />
      <ScreenshotViewer
        shots={detail.screenshots}
        thumbs={thumbs}
        current={openShot}
        onClose={() => setOpenShot(null)}
        onNavigate={setOpenShot}
      />
      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
      </div>
    </div>
  );
}
