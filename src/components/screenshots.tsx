import * as React from "react";
import { ChevronLeft, ChevronRight, Loader2, ScanText } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { fetchScreenshot, ocrScreenshot } from "@/server/fns";
import { cn, timeToMin } from "@/lib/utils";
import type { ScreenshotThumb } from "@/lib/types";

/** Lazily load every day thumbnail into a path->dataURL map (kept across polls). */
export function useDayThumbnails(shots: ScreenshotThumb[]) {
  const [thumbs, setThumbs] = React.useState<Map<string, string>>(new Map());
  const pathsKey = shots.map((s) => s.thumbPath).join("|");

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const missing = shots.filter((s) => !thumbs.has(s.thumbPath));
      for (let i = 0; i < missing.length; i += 6) {
        if (cancelled) return;
        const batch = missing.slice(i, i + 6);
        const urls = await Promise.all(
          batch.map((s) =>
            fetchScreenshot({ data: { path: s.thumbPath } }).catch(() => null)
          )
        );
        if (cancelled) return;
        setThumbs((prev) => {
          const next = new Map(prev);
          batch.forEach((s, j) => urls[j] && next.set(s.thumbPath, urls[j]!));
          return next;
        });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathsKey]);

  return thumbs;
}

/** Screenshots whose timestamp falls in [from, to). */
export function shotsInRange(
  shots: ScreenshotThumb[],
  from: string,
  to: string
): ScreenshotThumb[] {
  const a = timeToMin(from);
  const b = to === "23:59" ? 24 * 60 : timeToMin(to);
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
  const shown = shots.slice(0, max);
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

// Full-size images are large; cache the fetched data URLs so re-opening or
// navigating back is instant.
const fullImageCache = new Map<string, string>();

/**
 * Full-size screenshot viewer: shows the thumbnail instantly as a placeholder
 * while the full image loads, fits the image to the dialog, and offers a
 * bottom strip of the day's screenshots (around the same time) to browse.
 */
export function ScreenshotViewer({
  shots,
  thumbs,
  current,
  onClose,
  onNavigate,
}: {
  shots: ScreenshotThumb[];
  thumbs: Map<string, string>;
  current: ScreenshotThumb | null;
  onClose: () => void;
  onNavigate: (s: ScreenshotThumb) => void;
}) {
  const [fullImage, setFullImage] = React.useState<string | null>(null);
  const [ocrText, setOcrText] = React.useState<string | null>(null);
  const [ocrBusy, setOcrBusy] = React.useState(false);
  const seq = React.useRef(0);
  const stripRef = React.useRef<HTMLDivElement>(null);

  const index = current ? shots.findIndex((s) => s.thumbPath === current.thumbPath) : -1;
  const go = React.useCallback(
    (delta: number) => {
      if (index === -1) return;
      const next = shots[index + delta];
      if (next) onNavigate(next);
    },
    [index, shots, onNavigate]
  );

  // load full image (cached), keep thumb as placeholder meanwhile
  React.useEffect(() => {
    if (!current) return;
    setOcrText(null);
    const cached = fullImageCache.get(current.path);
    if (cached) {
      setFullImage(cached);
      return;
    }
    const my = ++seq.current;
    setFullImage(null);
    fetchScreenshot({ data: { path: current.path } })
      .then((url) => {
        fullImageCache.set(current.path, url);
        if (seq.current === my) setFullImage(url);
      })
      .catch(() => {});
  }, [current]);

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
  const src = fullImage ?? placeholder ?? undefined;

  return (
    <Dialog
      open={!!current}
      onClose={onClose}
      title={current ? `Screenshot ${current.time}` : ""}
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
        <div className="flex max-h-[68vh] min-h-64 w-full items-center justify-center overflow-hidden rounded border border-border bg-black/30">
          {src ? (
            <img
              src={src}
              alt={current?.time}
              className={cn(
                "max-h-[68vh] max-w-full object-contain transition-[filter]",
                !fullImage && "blur-[2px]"
              )}
            />
          ) : (
            <Loader2 className="animate-spin opacity-50" />
          )}
        </div>
        <Button
          size="icon"
          variant="secondary"
          className="absolute right-1 top-1/2 z-10 -translate-y-1/2"
          onClick={() => go(1)}
          disabled={index === -1 || index >= shots.length - 1}
          title="Next (→)"
        >
          <ChevronRight size={16} />
        </Button>
      </div>

      {/* nearby-time strip */}
      <div ref={stripRef} className="mt-2 flex gap-1 overflow-x-auto pb-1">
        {shots.map((s) => {
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
