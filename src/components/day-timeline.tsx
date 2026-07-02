import * as React from "react";
import { cn, timeToMin, fmtDuration } from "@/lib/utils";
import { projectColor } from "@/lib/status";
import type {
  NonWorkSegment,
  SuggestedEntry,
  TimelineBucket,
  ZepEntryView,
} from "@/lib/types";

interface DayTimelineProps {
  timeline: TimelineBucket[];
  entries: SuggestedEntry[];
  nonWork: NonWorkSegment[];
  zepEntries: ZepEntryView[];
  selectedId?: string | null;
  onSelectEntry?: (id: string) => void;
}

const endMinOf = (t: string) => (t === "23:59" ? 24 * 60 : timeToMin(t));

const LABEL_W = "5rem"; // shared width of the left label column

export function DayTimeline({
  timeline,
  entries,
  nonWork,
  zepEntries,
  selectedId,
  onSelectEntry,
}: DayTimelineProps) {
  const [hover, setHover] = React.useState<TimelineBucket | null>(null);

  const { startMin, endMin } = React.useMemo(() => {
    const mins: number[] = [];
    for (const b of timeline) mins.push(timeToMin(b.start), timeToMin(b.start) + b.minutes);
    for (const e of entries) mins.push(timeToMin(e.from), endMinOf(e.to));
    for (const z of zepEntries) mins.push(timeToMin(z.from), endMinOf(z.to));
    if (mins.length === 0) return { startMin: 7 * 60, endMin: 19 * 60 };
    const lo = Math.floor(Math.min(...mins) / 60) * 60;
    const hi = Math.min(24 * 60, Math.ceil(Math.max(...mins) / 60) * 60);
    return { startMin: lo, endMin: Math.max(hi, lo + 60) };
  }, [timeline, entries, zepEntries]);

  const span = endMin - startMin;
  const pos = (min: number) => ((min - startMin) / span) * 100;
  const width = (a: number, b: number) => Math.max(0.4, ((b - a) / span) * 100);

  const hours: number[] = [];
  for (let h = Math.ceil(startMin / 60); h <= Math.floor(endMin / 60); h++) hours.push(h);

  // A single grid template keeps the hour axis, gridlines and every bar in the
  // SAME horizontal coordinate system (label column + plot column), so the
  // colored blocks line up exactly with the hour numbers above them.
  const grid: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: `${LABEL_W} 1fr`,
  };

  return (
    <div className="select-none rounded-md border border-border bg-card/60 p-3">
      {/* hour axis (aligned to the plot column) */}
      <div style={grid}>
        <div />
        <div className="relative h-4 text-[10px] text-muted-foreground/70">
          {hours.map((h) => (
            <span
              key={h}
              className="absolute -translate-x-1/2 tabular-nums"
              style={{ left: `${pos(h * 60)}%` }}
            >
              {h}
            </span>
          ))}
        </div>
      </div>

      {/* rows */}
      <div style={grid}>
        {/* labels */}
        <div className="flex flex-col gap-1.5 pr-2 text-right">
          <RowLabel>Activity</RowLabel>
          <RowLabel>Suggested</RowLabel>
          <RowLabel>In ZEP</RowLabel>
        </div>

        {/* plot */}
        <div className="relative">
          {/* hour gridlines spanning all rows */}
          {hours.map((h) => (
            <div
              key={h}
              className="absolute inset-y-0 w-px bg-border/40"
              style={{ left: `${pos(h * 60)}%` }}
            />
          ))}

          {/* Activity */}
          <Track>
            {timeline.map((b) => {
              const s = timeToMin(b.start);
              return (
                <div
                  key={b.start}
                  className="absolute inset-y-0 rounded-sm bg-info"
                  style={{
                    left: `${pos(s)}%`,
                    width: `${width(s, s + b.minutes)}%`,
                    opacity: 0.2 + 0.8 * Math.min(1, b.activeMin / b.minutes),
                  }}
                  onMouseEnter={() => setHover(b)}
                  onMouseLeave={() => setHover(null)}
                />
              );
            })}
          </Track>

          {/* Suggested — striped background so uncovered GAPS are obvious */}
          <Track striped>
            {nonWork.map((s, i) => {
              const w = width(timeToMin(s.from), endMinOf(s.to));
              return (
                <div
                  key={`nw${i}`}
                  title={`${s.from}-${s.to} ${s.kind}${s.note ? ` — ${s.note}` : ""}`}
                  className="absolute inset-y-0 flex items-center justify-center overflow-hidden rounded-sm bg-secondary/80 text-[9px] text-muted-foreground"
                  style={{ left: `${pos(timeToMin(s.from))}%`, width: `${w}%` }}
                >
                  {w > 4 ? s.kind : ""}
                </div>
              );
            })}
            {entries.map((e) => (
              <button
                key={e.id}
                title={`${e.from}-${e.to} ${e.project} / ${e.task} (${e.confidence}%)${e.approved ? " ✓ approved" : " — not yet reviewed"}\n${e.note}`}
                onClick={() => onSelectEntry?.(e.id)}
                className={cn(
                  "absolute inset-y-0 cursor-pointer rounded-sm transition-all",
                  // approved → bold green frame (clearly "done"); unreviewed →
                  // full colour with a light outline so they visibly stand out.
                  selectedId === e.id
                    ? "z-20 ring-2 ring-ring"
                    : e.approved
                      ? "z-10 outline outline-2 -outline-offset-2 outline-ok brightness-105"
                      : "outline outline-1 -outline-offset-1 outline-white/30"
                )}
                style={{
                  left: `${pos(timeToMin(e.from))}%`,
                  width: `${width(timeToMin(e.from), endMinOf(e.to))}%`,
                  background: projectColor(e.project),
                  opacity: e.approved ? 1 : 0.82,
                }}
              />
            ))}
          </Track>

          {/* In ZEP */}
          <Track last>
            {zepEntries.map((z) => (
              <div
                key={z.id}
                title={`${z.from}-${z.to} ${z.project} / ${z.task}${z.note ? `\n${z.note}` : ""}`}
                className="absolute inset-y-0 rounded-sm bg-ok/70"
                style={{
                  left: `${pos(timeToMin(z.from))}%`,
                  width: `${width(timeToMin(z.from), endMinOf(z.to))}%`,
                }}
              />
            ))}
          </Track>
        </div>
      </div>

      {/* hover details */}
      <div className="mt-2 min-h-9 text-xs text-muted-foreground">
        {hover ? (
          <div>
            <span className="font-medium text-foreground">
              {hover.start} · {fmtDuration(hover.activeMin)} active
            </span>
            {hover.topApps.length > 0 && <> — {hover.topApps.join(", ")}</>}
            <div className="truncate opacity-80">
              {hover.titles.slice(0, 4).join(" · ")}
            </div>
          </div>
        ) : (
          <span className="opacity-50">
            Hover the activity row for details · click a suggested block to jump
            to its entry · striped areas on the Suggested row are unbooked gaps
          </span>
        )}
      </div>
    </div>
  );
}

function RowLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-6 items-center justify-end text-[10px] uppercase tracking-wide text-muted-foreground/70">
      {children}
    </div>
  );
}

function Track({
  children,
  striped,
  last,
}: {
  children: React.ReactNode;
  striped?: boolean;
  last?: boolean;
}) {
  return (
    <div
      className={cn(
        "relative h-6 overflow-hidden rounded-sm",
        !last && "mb-1.5"
      )}
      style={
        striped
          ? {
              backgroundImage:
                "repeating-linear-gradient(45deg, oklch(1 0 0 / 0.05) 0 6px, transparent 6px 12px)",
            }
          : undefined
      }
    >
      {children}
    </div>
  );
}
