/** Model tiers — shared between client (selector) and server (llm backend). */

export type ModelTier = "fast" | "balanced" | "best";

export const DEFAULT_TIER: ModelTier = "best";

export const TIERS: { id: ModelTier; label: string; hint: string }[] = [
  {
    id: "fast",
    label: "Fast",
    hint: "Haiku 4.5 via the SDK — a few seconds each. Cheapest; weakest at ambiguous days.",
  },
  {
    id: "balanced",
    label: "Balanced",
    hint: "Sonnet 5 via the SDK (subscription) — seconds per day.",
  },
  {
    id: "best",
    label: "Best",
    hint: "Opus 5.5 (default) via the SDK (subscription) — most accurate, still well under a minute per day.",
  },
];
