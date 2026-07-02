import * as React from "react";
import { Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { TIERS, DEFAULT_TIER, type ModelTier } from "@/lib/models";

const KEY = "timesheet.modelTier";

export function useModelTier(): [ModelTier, (t: ModelTier) => void] {
  const [tier, setTier] = React.useState<ModelTier>(DEFAULT_TIER);
  React.useEffect(() => {
    const stored = localStorage.getItem(KEY) as ModelTier | null;
    if (stored && TIERS.some((t) => t.id === stored)) setTier(stored);
  }, []);
  const set = React.useCallback((t: ModelTier) => {
    setTier(t);
    localStorage.setItem(KEY, t);
  }, []);
  return [tier, set];
}

/** Segmented control for the analysis model tier. */
export function TierSelector({
  tier,
  onChange,
}: {
  tier: ModelTier;
  onChange: (t: ModelTier) => void;
}) {
  return (
    <div
      className="inline-flex items-center rounded-md border border-border bg-secondary/40 p-0.5"
      title="Which model analyzes each day"
    >
      <Zap size={12} className="ml-1.5 mr-0.5 text-muted-foreground" />
      {TIERS.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          title={t.hint}
          className={cn(
            "cursor-pointer rounded px-2 py-0.5 text-xs font-medium transition-colors",
            tier === t.id
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
