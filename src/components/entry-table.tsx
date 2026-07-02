import * as React from "react";
import { AtSign, Check, Plus, Split, Trash2, ArrowDownToLine, Lock } from "lucide-react";
import { Combobox } from "@/components/combobox";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { EntryThumbs, shotsInRange } from "@/components/screenshots";
import { cn, timeToMin, minToTime, snap15, fmtDuration } from "@/lib/utils";
import { projectColor } from "@/lib/status";
import type {
  NonWorkSegment,
  ProjectTaskOption,
  ScreenshotThumb,
  SuggestedEntry,
  ZepEntryView,
} from "@/lib/types";

interface EntryTableProps {
  entries: SuggestedEntry[];
  zepEntries: ZepEntryView[];
  nonWork: NonWorkSegment[];
  options: ProjectTaskOption[];
  screenshots: ScreenshotThumb[];
  thumbs: Map<string, string>;
  onOpenShot: (s: ScreenshotThumb) => void;
  selectedId?: string | null;
  onSelect: (id: string | null) => void;
  onChange: (entries: SuggestedEntry[]) => void;
  onNonWorkChange: (nonWork: NonWorkSegment[]) => void;
  refedEntryIds: Set<string>;
  refedGaps: Set<string>;
  onToggleEntryRef: (e: SuggestedEntry) => void;
  onToggleGapRef: (from: string, to: string) => void;
}

const COLS = 9;
const endMinOf = (t: string) => (t === "23:59" ? 24 * 60 - 1 : timeToMin(t));

function confVariant(c: number): "ok" | "warn" | "bad" {
  if (c >= 75) return "ok";
  if (c >= 45) return "warn";
  return "bad";
}

let addCounter = 0;

/** Auto-growing note textarea so long notes are fully readable. */
function NoteCell({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const ref = React.useRef<HTMLTextAreaElement>(null);
  const resize = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 260)}px`;
  }, []);
  React.useEffect(resize, [value, resize]);
  return (
    <textarea
      ref={ref}
      value={value}
      rows={2}
      onChange={(e) => onChange(e.target.value)}
      onInput={resize}
      className="w-full resize-none rounded-md border border-border bg-input/40 px-2 py-1.5 text-sm leading-snug outline-none focus:border-ring focus:ring-1 focus:ring-ring"
    />
  );
}

export function EntryTable({
  entries,
  zepEntries,
  nonWork,
  options,
  screenshots,
  thumbs,
  onOpenShot,
  selectedId,
  onSelect,
  onChange,
  onNonWorkChange,
  refedEntryIds,
  refedGaps,
  onToggleEntryRef,
  onToggleGapRef,
}: EntryTableProps) {
  // Which row's task picker to auto-open (after its project is chosen).
  const [openTask, setOpenTask] = React.useState<{ id: string; token: number } | null>(null);

  const projects = React.useMemo(() => {
    const seen = new Set<string>();
    for (const o of options) seen.add(o.projectName);
    return [...seen].sort();
  }, [options]);

  const projectBillable = React.useMemo(() => {
    const m = new Map<string, boolean>();
    for (const o of options) if (!m.has(o.projectName)) m.set(o.projectName, o.billable);
    return m;
  }, [options]);

  const projectDesc = React.useMemo(() => {
    const m = new Map<string, string | undefined>();
    for (const o of options) if (!m.has(o.projectName)) m.set(o.projectName, o.projectDescription);
    return m;
  }, [options]);

  // Full human label for a project/task pair (shown under the compact selects).
  const taskFullLabel = (projectName: string, taskName: string): string | undefined => {
    const o = options.find((x) => x.projectName === projectName && x.taskName === taskName);
    if (!o) return undefined;
    const parent = o.parentName ? `${o.parentName} / ` : "";
    return o.taskDescription
      ? `${parent}${o.taskName} — ${o.taskDescription}`
      : `${parent}${o.taskName}`;
  };

  const validPairs = React.useMemo(
    () => new Set(options.map((o) => `${o.projectName} ${o.taskName}`)),
    [options]
  );

  const update = (
    id: string,
    patch: Partial<SuggestedEntry>,
    opts?: { noAutoLock?: boolean }
  ) => {
    onChange(
      entries.map((e) =>
        e.id === id
          ? opts?.noAutoLock
            ? { ...e, ...patch }
            : { ...e, ...patch, locked: true }
          : e
      )
    );
  };

  const remove = (id: string) => onChange(entries.filter((e) => e.id !== id));

  // Split a row at its 15-min-aligned midpoint into two rows (same project/task).
  const splitEntry = (id: string) => {
    const e = entries.find((x) => x.id === id);
    if (!e) return;
    const a = timeToMin(e.from);
    const b = endMinOf(e.to);
    const mid = snap15((a + b) / 2, "nearest");
    if (mid <= a || mid >= b) return; // 15-min row can't be split
    const first: SuggestedEntry = { ...e, to: minToTime(mid), locked: true };
    const second: SuggestedEntry = {
      ...e,
      id: `new${Date.now().toString(36)}${addCounter++}`,
      from: minToTime(mid),
      approved: false,
      locked: true,
    };
    onChange(entries.flatMap((x) => (x.id === id ? [first, second] : [x])));
    onSelect(second.id);
  };

  // Create a fresh entry that fills a gap (from/to = the gap edges).
  const createInGap = (from: string, to: string) => {
    const entry: SuggestedEntry = {
      id: `new${Date.now().toString(36)}${addCounter++}`,
      from,
      to,
      project: "",
      task: "",
      note: "",
      confidence: 100,
      locked: true,
    };
    onChange([...entries, entry]);
    onSelect(entry.id);
  };

  const mergeDown = (id: string) => {
    const sorted = [...entries].sort((a, b) => timeToMin(a.from) - timeToMin(b.from));
    const idx = sorted.findIndex((e) => e.id === id);
    const next = sorted[idx + 1];
    if (idx === -1 || !next) return;
    const cur = sorted[idx];
    const merged: SuggestedEntry = {
      ...cur,
      to: next.to,
      note: cur.note === next.note ? cur.note : `${cur.note}; ${next.note}`,
      confidence: Math.min(cur.confidence, next.confidence),
      locked: true,
    };
    onChange(
      entries.flatMap((e) => (e.id === cur.id ? [merged] : e.id === next.id ? [] : [e]))
    );
  };

  const addEntry = () => {
    const sorted = [...entries].sort((a, b) => timeToMin(a.from) - timeToMin(b.from));
    const last = sorted[sorted.length - 1];
    const from = last ? last.to : "08:00";
    const fromMin = endMinOf(from) === 24 * 60 - 1 ? 23 * 60 : timeToMin(from);
    const entry: SuggestedEntry = {
      id: `new${Date.now().toString(36)}${addCounter++}`,
      from: minToTime(fromMin),
      to: minToTime(Math.min(fromMin + 60, 24 * 60 - 15)),
      project: "",
      task: "",
      note: "",
      confidence: 100,
      locked: true,
    };
    onChange([...entries, entry]);
    onSelect(entry.id);
  };

  const setTime = (id: string, field: "from" | "to", value: string) => {
    if (!/^\d{2}:\d{2}$/.test(value)) return;
    const snapped =
      value === "23:59"
        ? "23:59"
        : minToTime(Math.max(0, Math.min(24 * 60 - 15, snap15(timeToMin(value), "nearest"))));
    update(id, { [field]: snapped } as Partial<SuggestedEntry>);
  };

  const stepTime = (id: string, field: "from" | "to", cur: string, dir: 1 | -1) => {
    const base = cur === "23:59" ? 24 * 60 - 15 : snap15(timeToMin(cur), "nearest");
    const next = Math.max(0, Math.min(24 * 60 - 15, base + dir * 15));
    update(id, { [field]: minToTime(next) } as Partial<SuggestedEntry>);
  };

  const effectiveBillable = (e: SuggestedEntry): boolean =>
    e.billable ?? projectBillable.get(e.project) ?? false;

  // Suggestions flagged red when they overlap another suggestion OR a ZEP entry.
  const overlapping = React.useMemo(() => {
    const bad = new Set<string>();
    const es = [...entries].sort((a, b) => timeToMin(a.from) - timeToMin(b.from));
    for (let i = 0; i < es.length; i++) {
      for (let j = i + 1; j < es.length; j++) {
        if (timeToMin(es[j].from) < endMinOf(es[i].to) && timeToMin(es[i].from) < endMinOf(es[j].to)) {
          bad.add(es[i].id);
          bad.add(es[j].id);
        }
      }
      for (const z of zepEntries) {
        if (timeToMin(z.from) < endMinOf(es[i].to) && timeToMin(es[i].from) < endMinOf(z.to))
          bad.add(es[i].id);
      }
    }
    return bad;
  }, [entries, zepEntries]);

  // Merged, time-sorted timeline of editable suggestions + read-only ZEP rows.
  type Item =
    | { kind: "entry"; from: string; to: string; entry: SuggestedEntry }
    | { kind: "zep"; from: string; to: string; zep: ZepEntryView };
  const items: Item[] = React.useMemo(() => {
    const arr: Item[] = [
      ...entries.map((e) => ({ kind: "entry" as const, from: e.from, to: e.to, entry: e })),
      ...zepEntries.map((z) => ({ kind: "zep" as const, from: z.from, to: z.to, zep: z })),
    ];
    return arr.sort(
      (a, b) => timeToMin(a.from) - timeToMin(b.from) || (a.kind === "zep" ? -1 : 1)
    );
  }, [entries, zepEntries]);

  const allApproved = entries.length > 0 && entries.every((e) => e.approved);
  const toggleAll = () => onChange(entries.map((e) => ({ ...e, approved: !allApproved })));

  const total = entries.reduce(
    (s, e) => s + Math.max(0, endMinOf(e.to) - timeToMin(e.from)),
    0
  );
  const approvedCount = entries.filter((e) => e.approved).length;

  return (
    <div>
      <table className="w-full border-separate border-spacing-0 text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground/70">
            <th className="w-12 pb-1.5">
              <input
                type="checkbox"
                checked={allApproved}
                onChange={toggleAll}
                title="Approve all entries"
                className="size-4 cursor-pointer accent-[var(--ok)]"
              />
            </th>
            <th className="w-[7.5rem] pb-1.5">Time</th>
            <th className="w-52 pb-1.5">Project</th>
            <th className="w-40 pb-1.5">Task</th>
            <th className="pb-1.5">Note</th>
            <th className="w-[8.5rem] pb-1.5">Screens</th>
            <th className="w-12 pb-1.5 text-center">Bill</th>
            <th className="w-11 pb-1.5 text-center">Conf</th>
            <th className="w-[4.5rem] pb-1.5"></th>
          </tr>
        </thead>
        <tbody>
          {(() => {
            let cursor = -1; // max end-minute seen so far
            return items.map((it) => {
              const startM = timeToMin(it.from);
              const gapFromMin = cursor;
              const gap = cursor >= 0 && startM > cursor ? startM - cursor : 0;
              const rows: React.ReactNode[] = [];

              if (gap >= 15) {
                const gFrom = minToTime(gapFromMin);
                const gTo = it.from;
                const gKey = `${gFrom}-${gTo}`;
                const gRefed = refedGaps.has(gKey);
                rows.push(
                  <tr key={`gap-${gKey}`}>
                    <td
                      colSpan={COLS}
                      className="border-y border-warn/40 bg-warn/15 py-0.5 pl-1"
                    >
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => createInGap(gFrom, gTo)}
                          title="Create an entry filling this gap"
                          className="flex size-5 shrink-0 items-center justify-center rounded border border-border/60 text-muted-foreground/70 hover:bg-secondary hover:text-foreground cursor-pointer"
                        >
                          <Plus size={12} />
                        </button>
                        <button
                          onClick={() => onToggleGapRef(gFrom, gTo)}
                          title="Reference this gap in the AI chat (then tell it what the gap was)"
                          className={cn(
                            "flex size-5 shrink-0 items-center justify-center rounded border cursor-pointer",
                            gRefed
                              ? "border-primary bg-primary/20 text-primary"
                              : "border-border/60 text-muted-foreground/50 hover:text-foreground"
                          )}
                        >
                          <AtSign size={12} />
                        </button>
                        <span className="text-[11px] text-warn/90">
                          <span className="font-semibold">gap {fmtDuration(gap)}</span>{" "}
                          <span className="text-warn/70">
                            {gFrom}–{gTo}
                            {describeNonWork(nonWork, gFrom, gTo)}
                          </span>
                          {gRefed && <span className="ml-1 text-primary">· referenced</span>}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              }

              cursor = Math.max(cursor, endMinOf(it.to));

              if (it.kind === "zep") {
                rows.push(<ZepRow key={`zep-${it.zep.id}`} z={it.zep} screenshots={screenshots} thumbs={thumbs} onOpenShot={onOpenShot} />);
                return rows;
              }

              const e = it.entry;
              const projectValid = projects.includes(e.project);
              const taskValid = validPairs.has(`${e.project} ${e.subtask ?? e.task}`);
              const taskOptions = options
                .filter((o) => o.projectName === e.project)
                .map((o) => ({
                  value: o.taskName,
                  label: o.taskName,
                  hint: `${o.taskPath.split(" / ").slice(1).join(" / ")}${o.taskDescription ? ` — ${o.taskDescription}` : ""}`,
                }));
              const entryShots = shotsInRange(screenshots, e.from, e.to);
              const isOverlap = overlapping.has(e.id);

              rows.push(
                <tr
                  key={e.id}
                  data-entry-id={e.id}
                  onClick={() => onSelect(e.id)}
                  className={cn(
                    "align-top transition-colors [&>td]:border-b [&>td]:border-border/60 [&>td]:py-2",
                    e.approved && "bg-ok/10",
                    refedEntryIds.has(e.id) && "bg-primary/10",
                    selectedId === e.id && !e.approved && !refedEntryIds.has(e.id) && "bg-accent/40"
                  )}
                >
                  <td className="pl-1">
                    <div className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={!!e.approved}
                        onChange={(ev) => {
                          ev.stopPropagation();
                          update(e.id, { approved: ev.target.checked }, { noAutoLock: true });
                        }}
                        onClick={(ev) => ev.stopPropagation()}
                        title="Approve / verify this row (green). Approved rows are locked from AI edits unless referenced, and survive re-analysis."
                        className="size-4 cursor-pointer accent-[var(--ok)]"
                      />
                      <button
                        onClick={(ev) => {
                          ev.stopPropagation();
                          onToggleEntryRef(e);
                        }}
                        title="Reference this row in the AI chat (@)"
                        className={cn(
                          "flex size-5 items-center justify-center rounded border cursor-pointer",
                          refedEntryIds.has(e.id)
                            ? "border-primary bg-primary/20 text-primary"
                            : "border-border/60 text-muted-foreground/50 hover:text-foreground"
                        )}
                      >
                        <AtSign size={12} />
                      </button>
                    </div>
                  </td>
                  <td className="pr-2">
                    <div className="flex items-center gap-1">
                      <span
                        className="h-7 w-1.5 shrink-0 rounded-full"
                        style={{ background: projectColor(e.project) }}
                        title={e.project}
                      />
                      <div>
                        <div className="flex items-center gap-1">
                          <Input
                            type="time"
                            step={900}
                            value={e.from}
                            onChange={(ev) => setTime(e.id, "from", ev.target.value)}
                            onKeyDown={(ev) => {
                              if (ev.key === "ArrowUp") { ev.preventDefault(); stepTime(e.id, "from", e.from, 1); }
                              else if (ev.key === "ArrowDown") { ev.preventDefault(); stepTime(e.id, "from", e.from, -1); }
                            }}
                            title="↑/↓ adjust by 15 min"
                            className={cn("h-7 w-[4.6rem] px-1 text-xs tabular-nums", isOverlap && "border-bad text-bad")}
                          />
                          <Input
                            type="time"
                            step={900}
                            value={e.to}
                            onChange={(ev) => setTime(e.id, "to", ev.target.value)}
                            onKeyDown={(ev) => {
                              if (ev.key === "ArrowUp") { ev.preventDefault(); stepTime(e.id, "to", e.to, 1); }
                              else if (ev.key === "ArrowDown") { ev.preventDefault(); stepTime(e.id, "to", e.to, -1); }
                            }}
                            title="↑/↓ adjust by 15 min"
                            className={cn("h-7 w-[4.6rem] px-1 text-xs tabular-nums", isOverlap && "border-bad text-bad")}
                          />
                        </div>
                        <div className="pt-0.5 text-[10px] text-muted-foreground/60">
                          {fmtDuration(endMinOf(e.to) - timeToMin(e.from))}
                          {isOverlap && <span className="ml-1 text-bad">· overlap</span>}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="pr-2">
                    <Combobox
                      value={e.project}
                      invalid={!projectValid}
                      options={projects.map((p) => ({
                        value: p,
                        label: p,
                        hint: projectDesc.get(p),
                      }))}
                      onChange={(project) => {
                        update(e.id, { project, task: "", subtask: undefined });
                        // auto-open the task picker for this row
                        setOpenTask({ id: e.id, token: Date.now() });
                      }}
                      placeholder="Project…"
                    />
                    {projectDesc.get(e.project) && (
                      <div
                        className="truncate pt-0.5 text-[10px] text-muted-foreground/70"
                        title={projectDesc.get(e.project)}
                      >
                        {projectDesc.get(e.project)}
                      </div>
                    )}
                  </td>
                  <td className="pr-2">
                    <Combobox
                      value={e.subtask ?? e.task}
                      invalid={!taskValid}
                      options={taskOptions}
                      openToken={openTask?.id === e.id ? openTask.token : undefined}
                      onChange={(task) => update(e.id, { task, subtask: undefined })}
                      placeholder="Task…"
                    />
                    {taskFullLabel(e.project, e.subtask ?? e.task) && (
                      <div
                        className="truncate pt-0.5 text-[10px] text-muted-foreground/70"
                        title={taskFullLabel(e.project, e.subtask ?? e.task)}
                      >
                        {taskFullLabel(e.project, e.subtask ?? e.task)}
                      </div>
                    )}
                  </td>
                  <td className="pr-2">
                    <NoteCell value={e.note} onChange={(note) => update(e.id, { note })} />
                    {e.reasoning && (
                      <div className="pt-0.5 text-[11px] italic text-muted-foreground/70" title={e.reasoning}>
                        {e.reasoning.length > 140 ? e.reasoning.slice(0, 140) + "…" : e.reasoning}
                      </div>
                    )}
                  </td>
                  <td className="pr-2">
                    <EntryThumbs shots={entryShots} thumbs={thumbs} onOpen={onOpenShot} />
                  </td>
                  <td className="text-center">
                    <input
                      type="checkbox"
                      checked={effectiveBillable(e)}
                      onChange={(ev) => {
                        ev.stopPropagation();
                        update(e.id, { billable: ev.target.checked });
                      }}
                      onClick={(ev) => ev.stopPropagation()}
                      title={
                        e.billable === undefined
                          ? "Follows the project default — tick/untick to override"
                          : "Explicit override"
                      }
                      className={cn(
                        "mt-1 size-4 cursor-pointer accent-[var(--ok)]",
                        e.billable === undefined && "opacity-70"
                      )}
                    />
                  </td>
                  <td className="text-center">
                    <Badge variant={confVariant(e.confidence)}>{e.confidence}</Badge>
                  </td>
                  <td>
                    <div className="flex items-center justify-end gap-0.5 pr-1">
                      <button
                        title="Split this entry in two at its midpoint"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          splitEntry(e.id);
                        }}
                        className="rounded p-1 text-muted-foreground/60 hover:bg-secondary cursor-pointer"
                      >
                        <Split size={13} />
                      </button>
                      <button
                        title="Merge with next entry"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          mergeDown(e.id);
                        }}
                        className="rounded p-1 text-muted-foreground/60 hover:bg-secondary cursor-pointer"
                      >
                        <ArrowDownToLine size={13} />
                      </button>
                      <button
                        title="Delete entry"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          remove(e.id);
                        }}
                        className="rounded p-1 text-muted-foreground/60 hover:bg-destructive/20 hover:text-destructive cursor-pointer"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
              return rows;
            });
          })()}
        </tbody>
      </table>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <Button variant="outline" size="sm" onClick={addEntry} data-add-entry>
          <Plus size={13} /> Add entry <kbd className="ml-1">n</kbd>
        </Button>
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Check size={13} className="text-ok" />
            {approvedCount}/{entries.length} approved
          </span>
          <span>
            Total to book:{" "}
            <span className="font-semibold text-foreground">{fmtDuration(total)}</span>
          </span>
        </div>
      </div>

      {nonWork.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span className="mr-1 text-[10px] uppercase tracking-wide">Non-work:</span>
          {nonWork.map((s, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 rounded-full bg-secondary/60 px-2 py-0.5"
              title={s.note}
            >
              {s.from}–{s.to} · {s.kind}
              {s.note ? ` — ${s.note}` : ""}
              <button
                title="Remove segment"
                className="ml-0.5 opacity-50 hover:opacity-100 cursor-pointer"
                onClick={() => onNonWorkChange(nonWork.filter((_, j) => j !== i))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Read-only row for an entry already booked in ZEP (fills its time slot). */
function ZepRow({
  z,
  screenshots,
  thumbs,
  onOpenShot,
}: {
  z: ZepEntryView;
  screenshots: ScreenshotThumb[];
  thumbs: Map<string, string>;
  onOpenShot: (s: ScreenshotThumb) => void;
}) {
  return (
    <tr className="align-top text-muted-foreground [&>td]:border-b [&>td]:border-border/60 [&>td]:py-2 bg-ok/[0.06]">
      <td className="pl-1">
        <div className="flex items-center" title="Already booked in ZEP — read only">
          <Lock size={13} className="text-ok/70" />
        </div>
      </td>
      <td className="pr-2">
        <div className="flex items-center gap-1">
          <span className="h-7 w-1.5 shrink-0 rounded-full" style={{ background: projectColor(z.project) }} />
          <div>
            <div className="text-xs tabular-nums text-foreground/80">
              {z.from}–{z.to}
            </div>
            <div className="pt-0.5 text-[10px] text-ok/80">in ZEP</div>
          </div>
        </div>
      </td>
      <td className="pr-2 font-medium text-foreground/80">{z.project}</td>
      <td className="pr-2">{z.task}</td>
      <td className="pr-2 italic">{z.note}</td>
      <td className="pr-2">
        <EntryThumbs shots={shotsInRange(screenshots, z.from, z.to)} thumbs={thumbs} onOpen={onOpenShot} />
      </td>
      <td className="text-center">{z.billable ? <Check size={13} className="mx-auto text-ok" /> : "—"}</td>
      <td className="text-center">
        <Badge variant="ok">ZEP</Badge>
      </td>
      <td></td>
    </tr>
  );
}

/** Deduped list of the non-work kinds+notes overlapping a gap. */
function describeNonWork(nonWork: NonWorkSegment[], from: string, to: string): string {
  const a = timeToMin(from);
  const b = timeToMin(to);
  const inside = nonWork.filter((s) => timeToMin(s.from) < b && endMinOf(s.to) > a);
  if (inside.length === 0) return "";
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const s of inside) {
    const label = s.note ? `${s.kind} (${s.note})` : s.kind;
    if (seen.has(label)) continue;
    seen.add(label);
    parts.push(label);
  }
  return ` — ${parts.join(", ")}`;
}
