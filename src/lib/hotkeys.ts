import * as React from "react";

export type HotkeyMap = Record<string, (e: KeyboardEvent) => void>;

const NON_TEXT_INPUTS = new Set([
  "checkbox",
  "radio",
  "button",
  "submit",
  "reset",
  "range",
  "color",
  "file",
]);

function isTypingTarget(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable) return true;
  if (tag === "INPUT") {
    // checkboxes/buttons/etc. don't consume typed characters — let hotkeys fire
    return !NON_TEXT_INPUTS.has((el as HTMLInputElement).type);
  }
  return false;
}

function isInteractiveTarget(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  return !!el?.closest?.("button, a, [role='menuitem'], summary");
}

/**
 * Global hotkeys. Keys are like "a", "shift+a", "shift+?", "[", "enter",
 * "arrowleft". Skipped while typing in a form field and while any dialog is
 * open. "enter"/" " bindings are skipped when focus is on an interactive
 * element (so buttons keep their native Enter behavior).
 */
export function useHotkeys(map: HotkeyMap, enabled = true) {
  const mapRef = React.useRef(map);
  mapRef.current = map;

  React.useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (document.querySelector("[role='dialog']")) return;
      const base = e.key.toLowerCase();
      const combo = `${e.shiftKey ? "shift+" : ""}${base}`;
      for (const [k, fn] of Object.entries(mapRef.current)) {
        // exact combo match, or plain-key binding without shift held
        // (shift+? works because e.key is already "?" -> combo "shift+?")
        if (k !== combo && !(k === base && !e.shiftKey)) continue;
        if (isTypingTarget(e)) return;
        if ((base === "enter" || base === " ") && isInteractiveTarget(e)) return;
        e.preventDefault();
        fn(e);
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
