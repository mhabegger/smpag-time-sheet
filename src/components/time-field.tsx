import * as React from "react";
import { Clock } from "lucide-react";
import { cn, timeToMin, minToTime, snap15, END_OF_DAY, fmtTime } from "@/lib/utils";

const MINUTES = [0, 15, 30, 45];
const HOURS = Array.from({ length: 24 }, (_, h) => h);
// End fields also offer 24 (→ 24:00, end of day).
const END_HOURS = [...HOURS, 24];

interface TimeFieldProps {
  /** "HH:mm" on a 15-min boundary, or the end-of-day sentinel (shown as 24:00). */
  value: string;
  /** Called with a snapped "HH:mm" (or the end-of-day sentinel) on commit. */
  onCommit: (value: string) => void;
  /** End time: may be 24:00 (typed as 24:00, 2400, 24 or 00:00). */
  isEnd?: boolean;
  /** ArrowUp/ArrowDown ±15 min. */
  onStep: (dir: 1 | -1) => void;
  invalid?: boolean;
  className?: string;
}

/**
 * Time input for 15-minute-grid times: free keyboard entry (snapped on
 * blur/Enter, not per keystroke) plus a clock dropdown offering only
 * :00/:15/:30/:45 minute options.
 */
export function TimeField({ value, onCommit, onStep, isEnd, invalid, className }: TimeFieldProps) {
  const [draft, setDraft] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const hourListRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  React.useEffect(() => {
    if (open)
      hourListRef.current
        ?.querySelector('[data-current="true"]')
        ?.scrollIntoView({ block: "center" });
  }, [open]);

  const curMin = value === END_OF_DAY ? 24 * 60 : timeToMin(value);
  const curHour = Math.floor(curMin / 60);
  const curMinute = curMin % 60;

  const commit = (raw: string) => {
    setDraft(null);
    const t = raw.trim();
    if (t === END_OF_DAY) {
      if (isEnd) onCommit(END_OF_DAY);
      return;
    }
    // Accept "9", "9:3" is rejected, "930", "09:30", "9.30", "9h30"
    const m = t.match(/^(\d{1,2})(?:[:.h]?([0-5]\d))?$/);
    if (!m) return;
    const h = Number(m[1]);
    const min = m[2] ? Number(m[2]) : 0;
    const total = h * 60 + min;
    // As an end time, midnight means the END of this day: 24:00 or 00:00.
    if (isEnd && (total === 24 * 60 || total === 0)) {
      onCommit(END_OF_DAY);
      return;
    }
    if (h > 23) return;
    const max = isEnd ? 24 * 60 : 24 * 60 - 15;
    const snapped = Math.max(0, Math.min(max, snap15(total, "nearest")));
    onCommit(snapped === 24 * 60 ? END_OF_DAY : minToTime(snapped));
  };

  const pick = (h: number, min: number) => {
    onCommit(h === 24 ? END_OF_DAY : minToTime(h * 60 + min));
  };

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <input
        value={draft ?? fmtTime(value)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft !== null && commit(draft)}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp") {
            e.preventDefault();
            setDraft(null);
            onStep(1);
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            setDraft(null);
            onStep(-1);
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (draft !== null) commit(draft);
          } else if (e.key === "Escape") {
            setDraft(null);
          }
        }}
        title={`Type a time (snapped to 15 min) · ↑/↓ adjust by 15 min${isEnd ? " · 24:00 = end of day" : ""}`}
        className={cn(
          "h-7 w-full rounded-md border bg-input/40 py-0 pl-1 pr-5 text-xs tabular-nums outline-none focus:border-ring focus:ring-1 focus:ring-ring",
          invalid ? "border-bad text-bad" : "border-border"
        )}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setOpen((o) => !o)}
        title="Pick a time (15-min steps)"
        className="absolute inset-y-0 right-0 flex w-5 items-center justify-center text-muted-foreground/50 hover:text-foreground cursor-pointer"
      >
        <Clock size={11} />
      </button>
      {open && (
        <div className="absolute left-0 z-40 mt-1 flex rounded-md border border-border bg-popover text-xs tabular-nums shadow-xl">
          <div ref={hourListRef} className="max-h-48 overflow-auto p-1">
            {(isEnd ? END_HOURS : HOURS).map((h) => (
              <div
                key={h}
                data-current={h === curHour}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(h, h === 24 ? 0 : curMinute);
                }}
                className={cn(
                  "cursor-pointer rounded px-2 py-0.5 text-center hover:bg-accent",
                  h === curHour && "bg-accent font-semibold"
                )}
              >
                {String(h).padStart(2, "0")}
              </div>
            ))}
          </div>
          <div className="border-l border-border p-1">
            {MINUTES.map((min) => (
              <div
                key={min}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(curHour, min);
                  setOpen(false);
                }}
                className={cn(
                  "cursor-pointer rounded px-2 py-0.5 text-center hover:bg-accent",
                  min === curMinute && "bg-accent font-semibold"
                )}
              >
                {String(min).padStart(2, "0")}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
