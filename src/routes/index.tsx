import * as React from "react";
import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { addMonths, format, parseISO, subMonths } from "date-fns";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Play,
  RotateCw,
  Sparkles,
  X,
} from "lucide-react";
import { clearQueueErrors, fetchMonth, queueAnalysis, setDayIgnored } from "@/server/fns";
import { STATUS_META } from "@/lib/status";
import { fmtDuration, cn } from "@/lib/utils";
import { useHotkeys } from "@/lib/hotkeys";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { HelpDialog } from "@/components/help-dialog";
import { TierSelector, useModelTier } from "@/components/tier-selector";
import { useProjectRefresh } from "@/components/use-project-refresh";
import type { DayOverview } from "@/lib/types";

export const Route = createFileRoute("/")({
  validateSearch: (s: Record<string, unknown>): { month?: string } => ({
    month: typeof s.month === "string" ? s.month : undefined,
  }),
  loaderDeps: ({ search }) => ({ month: search.month }),
  loader: ({ deps }) => fetchMonth({ data: { month: deps.month } }),
  component: Dashboard,
});

const MONTH_FMT = new Intl.DateTimeFormat("en", { month: "long", year: "numeric" });
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function Dashboard() {
  const data = Route.useLoaderData();
  const router = useRouter();
  const navigate = useNavigate();
  const [tier, setTier] = useModelTier();
  const [helpOpen, setHelpOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const { refreshing: projRefreshing, run: runProjectRefresh } = useProjectRefresh();
  const [selected, setSelected] = React.useState<string>(
    data.days[data.days.length - 1]?.date ?? data.monthStart
  );

  // Days picked for a batch (re-)analysis: checkbox, Ctrl+click, Shift+click
  // for a range, or Space on the keyboard-highlighted day.
  const [picked, setPicked] = React.useState<Set<string>>(new Set());
  const lastPicked = React.useRef<string | null>(null);
  const togglePick = (date: string, range = false) => {
    // Capture the anchor now — the state updater runs later, after it moved.
    const anchor = lastPicked.current;
    setPicked((cur) => {
      const next = new Set(cur);
      if (range && anchor) {
        const dates = data.days.map((d) => d.date);
        const [a, b] = [dates.indexOf(anchor), dates.indexOf(date)].sort((x, y) => x - y);
        if (a >= 0) for (const d of dates.slice(a, b + 1)) next.add(d);
      } else if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
    lastPicked.current = date;
  };

  // Keep selection valid when the month changes
  React.useEffect(() => {
    if (!data.days.some((d) => d.date === selected)) {
      setSelected(data.days[data.days.length - 1]?.date ?? data.monthStart);
    }
    setPicked(new Set());
    lastPicked.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.month]);

  const queueActive = data.queue.running.length > 0 || data.queue.pending.length > 0;
  React.useEffect(() => {
    if (!queueActive) return;
    const t = setInterval(() => router.invalidate(), 2500);
    return () => clearInterval(t);
  }, [queueActive, router]);

  const missing = data.days.filter(
    (d) => d.status === "missing" || d.status === "error"
  );

  const gotoMonth = (delta: number) => {
    const next = format(
      delta < 0 ? subMonths(parseISO(data.monthStart), 1) : addMonths(parseISO(data.monthStart), 1),
      "yyyy-MM"
    );
    navigate({ to: "/", search: { month: next } });
  };

  const openDay = (date: string) =>
    navigate({ to: "/day/$date", params: { date } });

  const analyze = async (dates: string[]) => {
    if (dates.length === 0) return;
    setBusy(true);
    try {
      await queueAnalysis({ data: { dates, tier } });
      await router.invalidate();
    } finally {
      setBusy(false);
    }
  };

  const readyToReview = data.days.filter((d) => d.status === "analyzed").map((d) => d.date);
  const reanalyzePicked = async () => {
    const dates = data.days.map((d) => d.date).filter((d) => picked.has(d));
    await analyze(dates);
    setPicked(new Set());
  };

  const moveSelection = (delta: number) => {
    const idx = data.days.findIndex((d) => d.date === selected);
    const next = data.days[Math.max(0, Math.min(data.days.length - 1, idx + delta))];
    if (next) {
      setSelected(next.date);
      document
        .querySelector(`[data-date="${next.date}"]`)
        ?.scrollIntoView({ block: "nearest" });
    }
  };

  useHotkeys({
    arrowleft: () => moveSelection(-1),
    arrowright: () => moveSelection(1),
    arrowup: () => moveSelection(-7),
    arrowdown: () => moveSelection(7),
    enter: () => openDay(selected),
    " ": () => togglePick(selected),
    a: () => analyze([selected]),
    "shift+a": () => analyze(missing.map((d) => d.date)),
    "[": () => gotoMonth(-1),
    "]": () => data.hasNext && gotoMonth(1),
    x: async () => {
      const day = data.days.find((d) => d.date === selected);
      if (!day) return;
      await setDayIgnored({ data: { date: selected, ignored: day.status !== "ignored" } });
      router.invalidate();
    },
    "shift+?": () => setHelpOpen(true),
  });

  const monthLabel = MONTH_FMT.format(parseISO(data.monthStart));
  // Shared scale for the per-day bars: the month's largest active OR ZEP total.
  const maxMinutes = Math.max(
    60,
    ...data.days.map((d) => Math.max(d.activeMinutes, d.zepMinutes))
  );
  const padStart = data.days[0]?.weekday ?? 0;

  return (
    <div className="mx-auto max-w-5xl p-6">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Timesheet catch-up</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Analyzer: {data.llmBackend}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <TierSelector tier={tier} onChange={setTier} />
          <Button
            variant="secondary"
            size="sm"
            disabled={projRefreshing}
            onClick={() => runProjectRefresh(data.month, () => router.invalidate())}
            title="Re-fetch ZEP projects & tasks from the server and reload"
          >
            <RotateCw size={13} className={cn(projRefreshing && "animate-spin")} />
            {projRefreshing ? "Updating projects…" : "Refresh"}
          </Button>
        </div>
      </header>

      {/* month navigation */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={() => gotoMonth(-1)} title="Previous month ([)">
            <ChevronLeft size={18} />
          </Button>
          <h2 className="min-w-44 text-center text-lg font-semibold">{monthLabel}</h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => gotoMonth(1)}
            disabled={!data.hasNext}
            title="Next month (])"
          >
            <ChevronRight size={18} />
          </Button>
          {queueActive && (
            <Badge variant="info" className="ml-2">
              <Loader2 size={11} className="animate-spin" />
              {data.queue.running.length > 0
                ? `analyzing ${data.queue.running.map((d) => d.slice(5)).join(", ")}`
                : "queued"}
              {data.queue.pending.length > 0 && ` +${data.queue.pending.length}`}
            </Badge>
          )}
        </div>
        <Button
          size="sm"
          disabled={busy || missing.length === 0}
          onClick={() => analyze(missing.map((d) => d.date))}
          title={`Queue analysis for every un-booked day in ${monthLabel} using the ${tier} model`}
        >
          <Play size={13} /> Analyze {missing.length} missing in {monthLabel.split(" ")[0]}
        </Button>
      </div>

      {/* per-month stats */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Missing" value={String(data.stats.missing)} tone="bad" />
        <Stat label="Partially booked" value={String(data.stats.partial)} tone="warn" />
        <Stat label="Ready to review" value={String(data.stats.analyzed)} tone="warn" />
        <Stat label="Unbooked time" value={fmtDuration(data.stats.unbookedMin)} tone="info" />
      </div>

      {data.queue.recentErrors.length > 0 && (
        <div className="mb-5 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <div className="flex items-center justify-between gap-2">
            <div className="font-medium">Recent analysis errors</div>
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                await clearQueueErrors();
                await router.invalidate();
              }}
              title="Remove these messages"
            >
              <X size={13} /> Dismiss
            </Button>
          </div>
          {data.queue.recentErrors.slice(0, 3).map((e, i) => (
            <div key={`${e.date}-${i}`} className="mt-1 text-muted-foreground">
              {e.date}: {e.error.slice(0, 200)}
            </div>
          ))}
        </div>
      )}

      {/* batch selection */}
      <div className="mb-3 flex min-h-8 flex-wrap items-center gap-2 text-sm">
        {picked.size > 0 ? (
          <>
            <span className="font-medium">{picked.size} selected</span>
            <Button
              size="sm"
              disabled={busy}
              onClick={() => void reanalyzePicked()}
              title={`Re-analyze the selected days with the ${tier} model. Approved and pinned rows are kept; other suggestions are replaced.`}
            >
              <Sparkles size={13} /> Re-analyze {picked.size} selected
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setPicked(new Set())}>
              <X size={13} /> Clear
            </Button>
          </>
        ) : (
          <span className="text-xs text-muted-foreground">
            Select days to re-analyze: tick a day's checkbox, Ctrl+click, Shift+click for a range, or Space.
          </span>
        )}
        {readyToReview.length > 0 && (
          <Button
            variant="secondary"
            size="sm"
            className="ml-auto"
            onClick={() => setPicked(new Set([...picked, ...readyToReview]))}
            title="Add every yellow “ready to review” day of this month to the selection"
          >
            <Check size={13} /> Select all ready to review ({readyToReview.length})
          </Button>
        )}
      </div>

      {/* calendar */}
      <div className="grid grid-cols-7 gap-1.5">
        {WEEKDAYS.map((w) => (
          <div key={w} className="pb-1 text-center text-[11px] font-medium text-muted-foreground/70">
            {w}
          </div>
        ))}
        {Array.from({ length: padStart }).map((_, i) => (
          <div key={`pad${i}`} />
        ))}
        {data.days.map((d) => (
          <DayCell
            key={d.date}
            day={d}
            selected={d.date === selected}
            picked={picked.has(d.date)}
            picking={picked.size > 0}
            onTogglePick={(range) => togglePick(d.date, range)}
            maxMinutes={maxMinutes}
            onOpen={() => openDay(d.date)}
            onSelect={() => setSelected(d.date)}
          />
        ))}
      </div>
      {data.days.length === 0 && (
        <p className="py-10 text-center text-sm text-muted-foreground">
          No tracked activity in {monthLabel}.
        </p>
      )}

      <footer className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-4 text-xs text-muted-foreground">
        {(["missing", "partial", "analyzed", "submitted", "analyzing", "ignored", "empty"] as const).map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <span className={cn("h-2.5 w-2.5 rounded-full", STATUS_META[s].dotClass)} />
            {STATUS_META[s].label}
          </span>
        ))}
        <span className="ml-auto">
          Click a day to open · <kbd>?</kbd> shortcuts
        </span>
      </footer>

      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "ok" | "warn" | "bad" | "info";
}) {
  const toneClass = { ok: "text-ok", warn: "text-warn", bad: "text-bad", info: "text-info" }[tone];
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className={cn("text-xl font-semibold", toneClass)}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function DayCell({
  day,
  selected,
  picked,
  picking,
  onTogglePick,
  maxMinutes,
  onOpen,
  onSelect,
}: {
  day: DayOverview;
  selected: boolean;
  picked: boolean;
  /** Some day is picked — show every checkbox, not only on hover. */
  picking: boolean;
  onTogglePick: (range: boolean) => void;
  maxMinutes: number;
  onOpen: () => void;
  onSelect: () => void;
}) {
  const meta = STATUS_META[day.status];
  return (
    <button
      data-date={day.date}
      onClick={(e) => {
        onSelect();
        // Ctrl/Cmd+click toggles, Shift+click picks a range — plain click opens.
        if (e.ctrlKey || e.metaKey || e.shiftKey) {
          e.preventDefault();
          onTogglePick(e.shiftKey);
          return;
        }
        onOpen();
      }}
      onMouseEnter={onSelect}
      title={`${day.date} — ${meta.label}\nActive ${fmtDuration(day.activeMinutes)} · ZEP ${fmtDuration(day.zepMinutes)}`}
      className={cn(
        "group flex h-24 cursor-pointer select-none flex-col rounded-md p-2 text-left transition-all",
        meta.cellClass,
        selected && "outline outline-2 outline-ring",
        picked && "ring-2 ring-primary"
      )}
    >
      <div className="flex items-start justify-between">
        <span className="flex items-center gap-1.5 text-sm font-semibold">
          {format(parseISO(day.date), "d")}
          {day.hasContext && (
            <span className="h-1.5 w-1.5 rounded-full bg-info" title="Has context notes" />
          )}
        </span>
        <span
          role="checkbox"
          aria-checked={picked}
          aria-label={`Select ${day.date} for re-analysis`}
          title="Select for batch re-analysis (Ctrl+click / Space)"
          onClick={(e) => {
            e.stopPropagation();
            onTogglePick(e.shiftKey);
          }}
          className={cn(
            "flex size-4 items-center justify-center rounded border transition-opacity",
            picked
              ? "border-primary bg-primary text-primary-foreground opacity-100"
              : "border-muted-foreground/50 bg-background/40",
            !picked && (picking ? "opacity-70" : "opacity-0 group-hover:opacity-70")
          )}
        >
          {picked && <Check size={11} strokeWidth={3} />}
        </span>
      </div>
      <div className="mt-auto text-[10px] leading-tight text-muted-foreground">
        {day.activeMinutes >= 15 && <div>{fmtDuration(day.activeMinutes)} active</div>}
        {day.zepMinutes > 0 && (
          <div className="text-ok/80">{fmtDuration(day.zepMinutes)} in ZEP</div>
        )}
      </div>
      {(day.activeMinutes > 0 || day.zepMinutes > 0) && (
        <div className="mt-1 flex flex-col gap-0.5" aria-hidden>
          <Bar minutes={day.activeMinutes} max={maxMinutes} className="bg-muted-foreground/60" />
          <Bar minutes={day.zepMinutes} max={maxMinutes} className="bg-ok" />
        </div>
      )}
    </button>
  );
}

/** Thin horizontal bar, length proportional to minutes / max (month scale). */
function Bar({ minutes, max, className }: { minutes: number; max: number; className: string }) {
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-white/5">
      <div
        className={cn("h-full rounded-full", className)}
        style={{ width: `${Math.min(100, (minutes / max) * 100)}%` }}
      />
    </div>
  );
}
