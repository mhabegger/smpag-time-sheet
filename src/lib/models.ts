/** Model tiers — shared between client (selector) and server (llm backend). */

export type ModelTier = "fast" | "balanced" | "best";

export const DEFAULT_TIER: ModelTier = "balanced";

export const TIERS: { id: ModelTier; label: string; hint: string }[] = [
  {
    id: "fast",
    label: "Fast",
    hint: "Haiku 4.5 via the SDK — a few seconds each. Best for bulk catch-up.",
  },
  {
    id: "balanced",
    label: "Balanced",
    hint: "Sonnet 5 (default). Runs via the Claude CLI (~2 min) — the subscription only allows Haiku over the direct SDK. Set ANTHROPIC_API_KEY for fast Sonnet.",
  },
  {
    id: "best",
    label: "Best",
    hint: "Opus 4.8 — most thorough. Runs via the Claude CLI (~2 min) unless ANTHROPIC_API_KEY is set.",
  },
];
