/**
 * Identify a sentence in the day context that is worth offering as a
 * recurring rule. This intentionally only proposes — it never persists a
 * rule, and it favours false negatives over noisy suggestions.
 */
const RECURRENCE_WORDS =
  /\b(?:every|each|weekly|usually|regularly|recurring|daily|all\s+(?:mon|tues|wednes|thurs|fri|satur|sun)days?)\b/i;
const WEEKDAY_OR_TIME =
  /\b(?:mon(?:day)?|tues(?:day)?|wednes(?:day)?|thurs(?:day)?|fri(?:day)?|satur(?:day)?|sun(?:day)?)s?\b|\b(?:[01]?\d|2[0-3]):[0-5]\d\b/i;

/** Return one concise, user-authored rule candidate, or null. */
export function findRecurringRuleCandidate(context: string): string | null {
  const parts = context
    .split(/[\n.!?]+/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  for (const part of parts) {
    if (part.length <= 240 && RECURRENCE_WORDS.test(part) && WEEKDAY_OR_TIME.test(part)) {
      return part;
    }
  }
  return null;
}
