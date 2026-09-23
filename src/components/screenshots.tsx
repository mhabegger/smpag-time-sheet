import * as React from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Loader2, ScanText } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ocrScreenshot } from "@/server/fns";
import { cn, timeToMin, endMinOf, fmtTime, minToTime } from "@/lib/utils";
import type { ScreenshotThumb } from "@/lib/types";

/** URL of a screenshot/thumbnail served by the /shot route (browser-cached). */
export function shotUrl(path: string): string {
  return `/shot?p=${encodeURIComponent(path)}`;
}

/**
 * thumbPath -> URL for every screenshot of the day. The images themselves are
 * loaded lazily by the browser (and cached), so this is free to compute.
 */
export function useDayThumbnails(shots: ScreenshotThumb[]) {
  return React.useMemo(
    () => new Map(shots.map((s) => [s.thumbPath, shotUrl(s.thumbPath)])),
    [shots]
  );
}

/** Time window of the row a screenshot was opened from ("to" may be end of day). */
export interface ShotRange {
  from: string;
  to: string;
}

/** Screenshots whose timestamp falls in [from, to). */
export function shotsInRange(
  shots: ScreenshotThumb[],
  from: string,
  to: string
): ScreenshotThumb[] {
  const a = timeToMin(from);
  const b = endMinOf(to);
  return shots.filter((s) => {
    const m = timeToMin(s.time);
    return m >= a && m < b;
  });
}

/** A compact row of clickable thumbnails for one entry's time range. */
export function EntryThumbs({
  shots,
  thumbs,
  onOpen,
  max = 5,
}: {
  shots: ScreenshotThumb[];
  thumbs: Map<string, string>;
  onOpen: (s: ScreenshotThumb) => void;
  max?: number;
}) {
  if (shots.length === 0)
    return <span className="text-[10px] text-muted-foreground/40">—</span>;
  // Spread the previews evenly across the row's time range.
  const shown =
    shots.length <= max
      ? shots
      : Array.from({ length: max }, (_, i) => shots[Math.round((i * (shots.length - 1)) / (max - 1))]);
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((s) => {
        const url = thumbs.get(s.thumbPath);
        return (
          <button
            key={s.thumbPath}
            onClick={(e) => {
              e.stopPropagation();
              onOpen(s);
            }}
            title={`Screenshot ${s.time}`}
            className="group relative cursor-pointer"
          >
            {url ? (
              <img
                src={url}
                alt={s.time}
                loading="lazy"
                decoding="async"
                className="h-10 w-16 rounded border border-border object-cover transition-transform group-hover:scale-110 group-hover:ring-1 group-hover:ring-ring"
              />
            ) : (
              <div className="flex h-10 w-16 items-center justify-center rounded border border-border bg-secondary/40">
                <Loader2 size={11} className="animate-spin opacity-40" />
              </div>
            )}
          </button>
        );
      })}
      {shots.length > max && (
        <span className="self-center text-[10px] text-muted-foreground">
          +{shots.length - max}
        </span>
      )}
    </div>
  );
}

/**
 * Full-size screenshot viewer: shows the thumbnail instantly as a placeholder
 * while the full image loads, fits the image to the dialog, and offers a
 * bottom strip to browse. When opened from an entry row (`range`), browsing
 * (arrows, ←/→ keys, strip) stays inside that row's time window; explicit
 * "Earlier" / "Later" buttons widen the window to reach neighbouring shots.
 */
export function ScreenshotViewer({
  shots,
  thumbs,
  current,
  range,
  onClose,
  onNavigate,
}: {
  shots: ScreenshotThumb[];
  thumbs: Map<string, string>;
  current: ScreenshotThumb | null;
  range?: ShotRange | null;
  onClose: () => void;
  onNavigate: (s: ScreenshotThumb) => void;
}) {
  const [ocrText, setOcrText] = React.useState<string | null>(null);
  const [ocrBusy, setOcrBusy] = React.useState(false);
  const stripRef = React.useRef<HTMLDivElement>(null);

  // Window extension (minutes before/after the row), reset whenever the
  // viewer is opened with a new range object.
  const [ext, setExt] = React.useState({ for: range, before: 0, after: 0 });
  const e = ext.for === range ? ext : { for: range, before: 0, after: 0 };
  const winFrom = range ? Math.max(0, timeToMin(range.from) - e.before) : 0;
  const winTo = range ? Math.min(24 * 60, endMinOf(range.to) + e.after) : 24 * 60;
  const visible = React.useMemo(
    () =>
      range
        ? shots.filter((x) => {
            const m = timeToMin(x.time);
            return m >= winFrom && m < winTo;
          })
        : shots,
    [shots, range, winFrom, winTo]
  );
  const earlierShot = range
    ? [...shots].reverse().find((x) => timeToMin(x.time) < winFrom)
    : undefined;
  const laterShot = range ? shots.find((x) => timeToMin(x.time) >= winTo) : undefined;

  // Widen the window in 15-min steps up to the nearest shot outside it.
  const showEarlier = () => {
    if (!earlierShot || !range) return;
    const start = Math.floor(timeToMin(earlierShot.time) / 15) * 15;
    setExt({ ...e, before: timeToMin(range.from) - start });
    onNavigate(earlierShot);
  };
  const showLater = () => {
    if (!laterShot || !range) return;
    const end = Math.min(24 * 60, Math.floor(timeToMin(laterShot.time) / 15) * 15 + 15);
    setExt({ ...e, after: end - endMinOf(range.to) });
    onNavigate(laterShot);
  };

  const index = current ? visible.findIndex((s) => s.thumbPath === current.thumbPath) : -1;
  const go = React.useCallback(
    (delta: number) => {
      if (index === -1) return;
      const next = visible[index + delta];
      if (next) onNavigate(next);
    },
    [index, visible, onNavigate]
  );

  React.useEffect(() => setOcrText(null), [current]);

  // Preload the neighbours so ←/→ show the full image instantly.
  React.useEffect(() => {
    if (index === -1) return;
    for (const d of [1, -1, 2]) {
      const n = visible[index + d];
      if (n) new Image().src = shotUrl(n.path);
    }
  }, [index, visible]);

  // arrow-key navigation + scroll active thumb into view
  React.useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
      else if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
    };
    window.addEventListener("keydown", onKey);
    stripRef.current
      ?.querySelector(`[data-strip="${current.thumbPath}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "center" });
    return () => window.removeEventListener("keydown", onKey);
  }, [current, go]);

  const runOcr = async () => {
    if (!current) return;
    setOcrBusy(true);
    try {
      const text = await ocrScreenshot({ data: { path: current.path } });
      setOcrText(text || "(no text recognized)");
    } catch (err) {
      setOcrText(`OCR failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      setOcrBusy(false);
    }
  };

  const placeholder = current ? thumbs.get(current.thumbPath) : undefined;

  return (
    <Dialog
      open={!!current}
      onClose={onClose}
      title={
        current
          ? `Screenshot ${current.time}${
              range
                ? ` · ${index + 1} / ${visible.length} in ${minToTime(winFrom)}–${fmtTime(
                    winTo === 24 * 60 ? "23:59" : minToTime(winTo)
                  )}`
                : ""
            }`
          : ""
      }
      className="max-w-6xl"
    >
      <div className="relative flex items-center justify-center">
        <Button
          size="icon"
          variant="secondary"
          className="absolute left-1 top-1/2 z-10 -translate-y-1/2"
          onClick={() => go(-1)}
          disabled={index <= 0}
          title="Previous (←)"
        >
          <ChevronLeft size={16} />
        </Button>
        {/*
          Fixed-size frame with two stacked layers, both scaled to fill it:
          the (cached) thumbnail, blurred, and the full image on top, which
          simply paints over it as soon as its bytes arrive. Nothing waits on
          a load event, so the viewer can never get stuck on the placeholder.
        */}
        <div className="relative h-[68vh] w-full overflow-hidden rounded border border-border bg-black/30">
          {current && (
            <>
              {placeholder ? (
                <img
                  src={placeholder}
                  alt=""
                  aria-hidden
                  className="absolute inset-0 h-full w-full object-contain blur-[2px]"
                />
              ) : (
                <Loader2 className="absolute inset-0 m-auto animate-spin opacity-50" />
              )}
              <img
                key={current.path}
                src={shotUrl(current.path)}
                alt={current.time}
                fetchPriority="high"
                className="absolute inset-0 h-full w-full object-contain"
              />
            </>
          )}
        </div>
        <Button
          size="icon"
          variant="secondary"
          className="absolute right-1 top-1/2 z-10 -translate-y-1/2"
          onClick={() => go(1)}
          disabled={index === -1 || index >= visible.length - 1}
          title="Next (→)"
        >
          <ChevronRight size={16} />
        </Button>
      </div>

      {/* explicit escape hatches out of the row's time window */}
      {range && (
        <div className="mt-2 flex items-center justify-between text-xs">
          <Button
            size="sm"
            variant={index === 0 && earlierShot ? "default" : "secondary"}
            disabled={!earlierShot}
            onClick={showEarlier}
            title="Include earlier screenshots (outside this entry's time range)"
          >
            <ChevronsLeft size={13} />
            {earlierShot ? `Earlier (before ${minToTime(winFrom)})` : "No earlier screenshots"}
          </Button>
          <Button
            size="sm"
            variant={index === visible.length - 1 && laterShot ? "default" : "secondary"}
            disabled={!laterShot}
            onClick={showLater}
            title="Include later screenshots (outside this entry's time range)"
          >
            {laterShot
              ? `Later (after ${fmtTime(winTo === 24 * 60 ? "23:59" : minToTime(winTo))})`
              : "No later screenshots"}
            <ChevronsRight size={13} />
          </Button>
        </div>
      )}

      {/* strip — only the current window */}
      <div ref={stripRef} className="mt-2 flex gap-1 overflow-x-auto pb-1">
        {visible.map((s) => {
          const url = thumbs.get(s.thumbPath);
          const active = s.thumbPath === current?.thumbPath;
          return (
            <button
              key={s.thumbPath}
              data-strip={s.thumbPath}
              onClick={() => onNavigate(s)}
              title={s.time}
              className={cn(
                "shrink-0 cursor-pointer rounded text-center",
                active ? "opacity-100" : "opacity-50 hover:opacity-90"
              )}
            >
              {url ? (
                <img
                  src={url}
                  alt={s.time}
                  loading="lazy"
                  decoding="async"
                  className={cn(
                    "h-11 w-16 rounded border object-cover",
                    active ? "border-primary ring-1 ring-primary" : "border-border"
                  )}
                />
              ) : (
                <div className="h-11 w-16 rounded border border-border bg-secondary/40" />
              )}
              <div className="text-[9px] text-muted-foreground">{s.time}</div>
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex items-start gap-3">
        <Button size="sm" variant="secondary" onClick={runOcr} disabled={ocrBusy}>
          {ocrBusy ? <Loader2 size={13} className="animate-spin" /> : <ScanText size={13} />}
          OCR this screenshot
        </Button>
        {ocrText && (
          <div className="max-h-40 flex-1 overflow-auto rounded bg-secondary/40 p-2 text-xs whitespace-pre-wrap">
            {ocrText}
          </div>
        )}
      </div>
    </Dialog>
  );
}
