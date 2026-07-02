import * as React from "react";
import { ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ComboOption {
  value: string;
  label: string;
  hint?: string;
}

interface ComboboxProps {
  value: string;
  options: ComboOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  /** Render the trigger as invalid (e.g. unknown project). */
  invalid?: boolean;
  /** Increment this to programmatically open the dropdown (e.g. after a project pick). */
  openToken?: number;
}

/** Lightweight searchable combobox (no portal — fine for table cells). */
export function Combobox({
  value,
  options,
  onChange,
  placeholder,
  className,
  invalid,
  openToken,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [highlight, setHighlight] = React.useState(0);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options.slice(0, 200);
    const terms = q.split(/\s+/);
    return options
      .filter((o) =>
        terms.every(
          (t) =>
            o.label.toLowerCase().includes(t) ||
            o.hint?.toLowerCase().includes(t)
        )
      )
      .slice(0, 200);
  }, [options, query]);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  React.useEffect(() => {
    if (open) {
      setQuery("");
      setHighlight(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Programmatic open (e.g. auto-open the task picker right after a project is chosen).
  const firstToken = React.useRef(openToken);
  React.useEffect(() => {
    if (openToken !== undefined && openToken !== firstToken.current) {
      firstToken.current = openToken;
      setOpen(true);
    }
  }, [openToken]);

  React.useEffect(() => {
    listRef.current
      ?.querySelector(`[data-idx="${highlight}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex h-8 w-full items-center justify-between gap-1 rounded-md border bg-input/40 px-2 text-left text-sm cursor-pointer",
          invalid ? "border-bad text-bad" : "border-border",
          !value && "text-muted-foreground"
        )}
        title={value || placeholder}
      >
        <span className="truncate">{value || placeholder || "Select…"}</span>
        <ChevronsUpDown size={13} className="shrink-0 opacity-50" />
      </button>
      {open && (
        <div className="absolute left-0 z-40 mt-1 w-[minmax(100%,24rem)] min-w-full max-w-[26rem] rounded-md border border-border bg-popover shadow-xl">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setHighlight(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setHighlight((h) => Math.min(h + 1, filtered.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setHighlight((h) => Math.max(h - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                const opt = filtered[highlight];
                if (opt) pick(opt.value);
              } else if (e.key === "Escape") {
                e.stopPropagation();
                setOpen(false);
              }
            }}
            placeholder="Search…"
            className="w-full border-b border-border bg-transparent px-2 py-1.5 text-sm outline-none"
          />
          <div ref={listRef} className="max-h-64 overflow-auto p-1">
            {filtered.length === 0 && (
              <div className="px-2 py-2 text-xs text-muted-foreground">
                No matches
              </div>
            )}
            {filtered.map((o, i) => (
              <div
                key={o.value + i}
                data-idx={i}
                onMouseEnter={() => setHighlight(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(o.value);
                }}
                className={cn(
                  "cursor-pointer rounded px-2 py-1 text-sm",
                  i === highlight && "bg-accent",
                  o.value === value && "font-semibold"
                )}
              >
                <div className="truncate">{o.label}</div>
                {o.hint && (
                  <div className="truncate text-[11px] text-muted-foreground">
                    {o.hint}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
