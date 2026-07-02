import * as React from "react";
import { CornerDownLeft, Loader2, Sparkles, X } from "lucide-react";
import { chatEdit } from "@/server/fns";
import { cn } from "@/lib/utils";
import type { ModelTier } from "@/lib/models";
import type { ChatRef, NonWorkSegment, SuggestedEntry } from "@/lib/types";

const SUGGESTIONS = [
  "merge the two aircheck blocks",
  "split 13:00-15:00 at 14:00",
  "rewrite the note to mention the PR",
  "mark 12:00-13:00 as lunch",
];

/**
 * Natural-language editing of the day's entries. Sends the current entries +
 * any pinned references to the model, which returns targeted operations.
 */
export function ChatEdit({
  date,
  entries,
  nonWork,
  refs,
  tier,
  onRemoveRef,
  onResult,
}: {
  date: string;
  entries: SuggestedEntry[];
  nonWork: NonWorkSegment[];
  refs: ChatRef[];
  tier: ModelTier;
  onRemoveRef: (ref: ChatRef) => void;
  onResult: (r: { entries: SuggestedEntry[]; nonWork: NonWorkSegment[] }) => void;
}) {
  const [value, setValue] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [reply, setReply] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const ref = React.useRef<HTMLInputElement>(null);

  const send = async (text: string) => {
    const instruction = text.trim();
    if (!instruction || busy) return;
    setBusy(true);
    setError(null);
    setReply(null);
    try {
      const res = await chatEdit({
        data: { date, instruction, entries, nonWork, refs, tier },
      });
      onResult({ entries: res.suggestions, nonWork: res.nonWork });
      setReply(res.reply);
      setValue("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const refKey = (r: ChatRef) => (r.kind === "entry" ? `e:${r.id}` : `g:${r.from}-${r.to}`);

  return (
    <div
      className={cn(
        "rounded-md border border-border bg-card/60 p-3 transition-opacity",
        busy && "opacity-80"
      )}
      data-chat-edit
    >
      {/* reference chips */}
      {refs.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
            Referring to:
          </span>
          {refs.map((r) => (
            <span
              key={refKey(r)}
              className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/15 px-2 py-0.5 text-[11px] text-foreground"
            >
              {r.label}
              <button
                onClick={() => onRemoveRef(r)}
                className="opacity-60 hover:opacity-100 cursor-pointer"
                title="Remove reference"
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Sparkles size={14} className="shrink-0 text-primary" />
        <div className="relative flex-1">
          <input
            ref={ref}
            value={value}
            disabled={busy}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") send(value);
              if (e.key === "Escape") (e.target as HTMLInputElement).blur();
            }}
            placeholder={
              refs.length > 0
                ? "Say what to do with the referenced rows/gaps…"
                : "Ask to change the entries — merge, split, reclassify, rewrite a note…"
            }
            className={cn(
              "h-9 w-full rounded-md border border-border bg-input/40 px-3 pr-9 text-sm outline-none focus:border-ring focus:ring-1 focus:ring-ring",
              busy && "cursor-not-allowed text-muted-foreground/50 placeholder:text-muted-foreground/40"
            )}
          />
          <button
            onClick={() => send(value)}
            disabled={busy || !value.trim()}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-40 cursor-pointer"
            title="Apply (Enter)"
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <CornerDownLeft size={15} />}
          </button>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {busy ? (
          <span className="text-xs text-muted-foreground">
            <Loader2 size={11} className="mr-1 inline animate-spin" />
            applying — the AI only touches the rows it names…
          </span>
        ) : (
          SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => send(s)}
              className="rounded-full border border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-secondary/60 cursor-pointer"
            >
              {s}
            </button>
          ))
        )}
      </div>

      {reply && !busy && <div className="mt-2 text-xs text-ok">✓ {reply}</div>}
      {error && !busy && <div className="mt-2 text-xs text-destructive">✗ {error}</div>}
    </div>
  );
}
