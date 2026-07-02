import * as React from "react";
import { AlertTriangle, Check, Loader2, Send } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { submitDayToZep } from "@/server/fns";
import { timeToMin, fmtDuration, cn } from "@/lib/utils";
import type { ProjectTaskOption, SuggestedEntry } from "@/lib/types";

interface SubmitDialogProps {
  open: boolean;
  onClose: () => void;
  date: string;
  entries: SuggestedEntry[];
  options: ProjectTaskOption[];
  onSubmitted: () => void;
}

type Phase = "review" | "submitting" | "done";

const endMinOf = (t: string) => (t === "23:59" ? 24 * 60 - 1 : timeToMin(t));

export function SubmitDialog({
  open,
  onClose,
  date,
  entries,
  options,
  onSubmitted,
}: SubmitDialogProps) {
  const validPairs = React.useMemo(
    () => new Set(options.map((o) => `${o.projectName} ${o.taskName}`)),
    [options]
  );
  const isValid = (e: SuggestedEntry) =>
    validPairs.has(`${e.project} ${e.subtask ?? e.task}`);

  const [checked, setChecked] = React.useState<Set<string>>(new Set());
  const [phase, setPhase] = React.useState<Phase>("review");
  const [result, setResult] = React.useState<{
    submitted: number;
    skipped: { from: string; to: string }[];
    errors: { entry: string; error: string }[];
    warnings: string[];
  } | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      // Default selection: approved & valid entries; if none are approved yet,
      // fall back to all valid entries.
      const approvedValid = entries.filter((e) => e.approved && isValid(e));
      const base = approvedValid.length > 0 ? approvedValid : entries.filter(isValid);
      setChecked(new Set(base.map((e) => e.id)));
      setPhase("review");
      setResult(null);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const selected = entries.filter((e) => checked.has(e.id));
  const totalMin = selected.reduce(
    (s, e) => s + Math.max(0, endMinOf(e.to) - timeToMin(e.from)),
    0
  );

  const submit = async () => {
    setPhase("submitting");
    setError(null);
    try {
      // Send the FULL entries as reviewed in this dialog — the server books
      // exactly what is on screen, independent of pending autosaves.
      const res = await submitDayToZep({
        data: { date, entries: selected },
      });
      setResult(res.result);
      setPhase("done");
      onSubmitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("review");
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      locked={phase === "submitting"}
      title={
        phase === "done" ? `Submitted — ${date}` : `Submit to ZEP — ${date}`
      }
      className="max-w-4xl"
    >
      {phase !== "done" && (
        <>
          <table className="w-full text-sm">
            <tbody>
              {entries.map((e) => {
                const valid = isValid(e);
                return (
                  <tr
                    key={e.id}
                    className={cn(
                      "[&>td]:border-b [&>td]:border-border/50 [&>td]:py-1.5",
                      !checked.has(e.id) && "opacity-45"
                    )}
                  >
                    <td className="w-8">
                      <input
                        type="checkbox"
                        checked={checked.has(e.id)}
                        disabled={!valid}
                        onChange={() => toggle(e.id)}
                        className="size-4 accent-[var(--primary)] cursor-pointer"
                      />
                    </td>
                    <td className="w-28 whitespace-nowrap tabular-nums">
                      {e.from}–{e.to}
                    </td>
                    <td className="w-64 pr-2">
                      <div className="truncate font-medium">{e.project}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {e.subtask ? `${e.task} / ${e.subtask}` : e.task}
                        {e.billable !== undefined &&
                          (e.billable ? " · billable" : " · non-bill")}
                      </div>
                    </td>
                    <td className="pr-2 text-xs text-muted-foreground">
                      <div className="line-clamp-2">{e.note}</div>
                      {!valid && (
                        <span className="mt-0.5 inline-flex items-center gap-1 text-bad">
                          <AlertTriangle size={11} /> unknown project/task — fix in the
                          table first
                        </span>
                      )}
                    </td>
                    <td className="w-12 text-right">
                      <Badge
                        variant={
                          e.confidence >= 75 ? "ok" : e.confidence >= 45 ? "warn" : "bad"
                        }
                      >
                        {e.confidence}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {error && (
            <div className="mt-3 rounded-md border border-destructive/50 bg-destructive/10 p-2 text-sm whitespace-pre-wrap">
              {error}
            </div>
          )}

          <div className="mt-4 flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              {selected.length} entries ·{" "}
              <span className="font-semibold text-foreground">
                {fmtDuration(totalMin)}
              </span>{" "}
              → ZEP on {date}
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={onClose} disabled={phase === "submitting"}>
                Cancel
              </Button>
              <Button
                onClick={submit}
                disabled={phase === "submitting" || selected.length === 0}
              >
                {phase === "submitting" ? (
                  <>
                    <Loader2 size={13} className="animate-spin" /> Submitting…
                  </>
                ) : (
                  <>
                    <Send size={13} /> Submit {selected.length} entries
                  </>
                )}
              </Button>
            </div>
          </div>
        </>
      )}

      {phase === "done" && result && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-ok">
            <Check size={18} />
            <span className="text-lg font-semibold">
              {result.submitted} entries submitted
            </span>
          </div>
          {result.skipped.length > 0 && (
            <div className="text-sm text-warn">
              ⊘ Skipped (overlap with existing ZEP entries):{" "}
              {result.skipped.map((s) => `${s.from}–${s.to}`).join(", ")}
            </div>
          )}
          {result.errors.length > 0 && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-sm">
              {result.errors.map((e, i) => (
                <div key={i}>
                  ✗ {e.entry}: {e.error}
                </div>
              ))}
            </div>
          )}
          {result.warnings.length > 0 && (
            <div className="text-xs text-muted-foreground">
              {result.warnings.map((w, i) => (
                <div key={i}>⚠ {w}</div>
              ))}
            </div>
          )}
          <div className="flex justify-end">
            <Button onClick={onClose}>Close</Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
