import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** When true, Escape/overlay-click do not close (e.g. while submitting). */
  locked?: boolean;
  /** Ctrl/Cmd+Enter action (e.g. submit). Omit to disable the shortcut. */
  onConfirm?: () => void;
}

const FOCUSABLE =
  "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

/**
 * Modal dialog. While open it owns the keyboard: focus moves into the panel,
 * Tab cycles inside it, and focus that escapes (e.g. a click-through) is pulled
 * back — so typing never reaches the controls behind the overlay. Focus is
 * restored to the previously focused element on close.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  className,
  locked,
  onConfirm,
}: DialogProps) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  // Latest callbacks without re-running the focus effect on every render.
  const cbRef = React.useRef({ onClose, onConfirm, locked });
  cbRef.current = { onClose, onConfirm, locked };

  React.useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    panel?.focus();

    const onKey = (e: KeyboardEvent) => {
      const { onClose, onConfirm, locked } = cbRef.current;
      if (e.key === "Escape" && !locked) {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && onConfirm && !locked) {
        e.preventDefault();
        e.stopPropagation();
        onConfirm();
        return;
      }
      if (e.key === "Tab" && panel) {
        const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)];
        if (items.length === 0) {
          e.preventDefault();
          panel.focus();
          return;
        }
        const first = items[0];
        const last = items[items.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && (active === first || active === panel)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    const onFocusIn = (e: FocusEvent) => {
      if (panel && !panel.contains(e.target as Node)) panel.focus();
    };

    window.addEventListener("keydown", onKey, true);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("focusin", onFocusIn);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !locked) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className={cn(
          "flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-border bg-popover p-5 shadow-2xl outline-none",
          className
        )}
      >
        <div className="mb-3 flex shrink-0 items-center justify-between gap-4">
          <h2 className="text-base font-semibold">{title}</h2>
          {!locked && (
            <button
              onClick={onClose}
              className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground cursor-pointer"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          )}
        </div>
        {/* Body scrolls when it overflows; children that manage their own
            scroll area (flex-1 + min-h-0) keep e.g. a footer always visible. */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
