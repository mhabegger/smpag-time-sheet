import * as React from "react";
import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { addMonths, format, parseISO, subMonths } from "date-fns";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Play,
  RotateCw,
} from "lucide-react";
import { fetchMonth, queueAnalysis, setDayIgnored } from "@/server/fns";
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

  // Keep selection valid when the month changes
  React.useEffect(() => {
    if (!data.days.some((d) => d.date === selected)) {
      setSelected(data.days[data.days.length - 1]?.date ?? data.monthStart);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.month]);

  const queueActive = !!data.queue.running || data.queue.pending.length > 0;
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
              {data.queue.running ? `analyzing ${data.queue.running.slice(5)}` : "queued"}
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
          <div className="font-medium">Recent analysis errors</div>
          {data.queue.recentErrors.slice(0, 3).map((e) => (
            <div key={e.date} className="mt-1 text-muted-foreground">
              {e.date}: {e.error.slice(0, 200)}
            </div>
          ))}
        </div>
      )}

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
  onOpen,
  onSelect,
}: {
  day: DayOverview;
  selected: boolean;
  onOpen: () => void;
  onSelect: () => void;
}) {
  const meta = STATUS_META[day.status];
  return (
    <button
      data-date={day.date}
      onClick={() => {
        onSelect();
        onOpen();
      }}
      onMouseEnter={onSelect}
      title={`${day.date} — ${meta.label}\nActive ${fmtDuration(day.activeMinutes)} · ZEP ${fmtDuration(day.zepMinutes)}`}
      className={cn(
        "flex h-20 cursor-pointer flex-col rounded-md p-2 text-left transition-all",
        meta.cellClass,
        selected && "outline outline-2 outline-ring"
      )}
    >
      <div className="flex items-start justify-between">
        <span className="text-sm font-semibold">{format(parseISO(day.date), "d")}</span>
        {day.hasContext && (
          <span className="mt-1 h-1.5 w-1.5 rounded-full bg-info" title="Has context notes" />
        )}
      </div>
      <div className="mt-auto text-[10px] leading-tight text-muted-foreground">
        {day.activeMinutes >= 15 && <div>{fmtDuration(day.activeMinutes)} active</div>}
        {day.zepMinutes > 0 && (
          <div className="text-ok/80">{fmtDuration(day.zepMinutes)} in ZEP</div>
        )}
      </div>
    </button>
  );
}
