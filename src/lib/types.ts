/**
 * Shared domain types between the web UI and the server layer.
 * All times of day are "HH:mm" (minutes precision) unless noted; dates are "YYYY-MM-DD".
 */

export type DayStatus =
  | "empty" // no meaningful ManicTime activity (weekend / off / vacation)
  | "missing" // activity exists but nothing in ZEP and no suggestions yet
  | "analyzing" // analysis job running or queued
  | "analyzed" // suggestions ready, not submitted
  | "partial" // some ZEP entries exist but they cover clearly less than the active time
  | "submitted" // ZEP coverage roughly matches activity (or entries were submitted from here)
  | "ignored" // user marked day as not-to-book
  | "error"; // last analysis failed

/** One proposed (or edited) timesheet entry. */
export interface SuggestedEntry {
  id: string; // stable id for UI editing
  from: string; // "HH:mm" — must be 15-min aligned
  to: string; // "HH:mm" — 15-min aligned ("23:59" allowed as end-of-day sentinel)
  project: string; // ZEP project name (exact)
  task: string; // leaf task name (exact)
  subtask?: string; // disambiguation child task
  note: string;
  billable?: boolean; // omit -> project default
  confidence: number; // 0..100
  reasoning?: string; // short LLM explanation for review
  locked?: boolean; // user pinned/edited — batch re-analysis must keep it
  approved?: boolean; // user validated this entry (green in the review list)
}

/** A row or gap the user pins into the chat context to steer/scope an edit. */
export type ChatRef =
  | { kind: "entry"; id: string; label: string }
  | { kind: "gap"; from: string; to: string; label: string };

export type NonWorkKind =
  | "lunch"
  | "private"
  | "away"
  | "break"
  | "meeting"
  | "commute"
  | "errand";

/** Non-work segment recognised by analysis (lunch, private, away...). */
export interface NonWorkSegment {
  from: string;
  to: string;
  kind: NonWorkKind;
  note?: string;
}

/** Compact activity bucket for the day timeline visualization. */
export interface TimelineBucket {
  start: string; // "HH:mm" clock-aligned window start
  minutes: number; // window size
  activeMin: number; // active minutes inside the window
  topApps: string[]; // up to 3 app names by usage
  titles: string[]; // deduped window titles (trimmed)
  context: string[]; // websites/documents
}

/** Existing ZEP attendance (read-only rows in the UI). */
export interface ZepEntryView {
  id: number;
  from: string; // "HH:mm"
  to: string;
  project: string;
  task: string;
  billable: boolean;
  note: string | null;
}

export interface OcrSample {
  time: string; // "HH:mm"
  path: string; // absolute screenshot path (full-size)
  text: string; // OCR extract (may be empty)
}

export interface ScreenshotThumb {
  time: string; // "HH:mm"
  path: string; // absolute path to full-size image
  thumbPath: string; // absolute path to thumbnail
}

export interface SubmitResultView {
  submittedAt: string; // ISO
  submitted: number;
  skipped: number;
  errors: { entry: string; error: string }[];
}

/** Persisted per-day record (data/days/YYYY-MM-DD.json). */
export interface DayRecord {
  date: string;
  status: DayStatus;
  /** free-form context the user provides BEFORE analysis ("customer visit 9-12 for CHM", ...) */
  context?: string;
  suggestions: SuggestedEntry[];
  nonWork: NonWorkSegment[];
  analysis?: {
    analyzedAt: string; // ISO
    model: string;
    firstActive?: string; // "HH:mm"
    lastActive?: string;
    activeMinutes: number;
    summary?: string; // one-paragraph day summary from the LLM
    partialUntil?: string; // if analyzed mid-day (today), data covered until here
  };
  submitResult?: SubmitResultView;
  error?: string;
}

/** Dashboard cell per day. */
export interface DayOverview {
  date: string;
  weekday: number; // 0=Mon .. 6=Sun
  status: DayStatus;
  activeMinutes: number;
  zepMinutes: number;
  suggestedMinutes: number;
  hasContext: boolean;
}

export interface DashboardData {
  rangeStart: string;
  rangeEnd: string; // today
  days: DayOverview[];
  queue: QueueStatus;
  llmBackend: string; // which analyzer backend is active
}

/** One month of the dashboard (the app shows a single month at a time). */
export interface MonthData {
  month: string; // "YYYY-MM"
  monthStart: string; // "YYYY-MM-01"
  monthEnd: string; // last shown day (min of month end / today)
  today: string;
  days: DayOverview[]; // padded on the client by weekday
  hasPrev: boolean;
  hasNext: boolean; // false when already at the current month
  stats: {
    missing: number;
    partial: number;
    analyzed: number;
    submitted: number;
    unbookedMin: number;
  };
  queue: QueueStatus;
  llmBackend: string;
}

export interface QueueStatus {
  running: string | null; // date currently being analyzed
  pending: string[]; // queued dates
  recentErrors: { date: string; error: string }[];
}

/** Full data for the day view. */
export interface DayDetail {
  record: DayRecord;
  timeline: TimelineBucket[];
  gaps: { from: string; to: string; minutes: number }[];
  firstActive: string | null;
  lastActive: string | null;
  activeMinutes: number;
  zepEntries: ZepEntryView[];
  screenshots: ScreenshotThumb[];
  isToday: boolean;
}

/** Project/task option for the editor combobox. */
export interface ProjectTaskOption {
  projectName: string;
  projectDescription?: string; // e.g. "CHM | ... CH Media" — searchable/displayable
  taskName: string;
  taskPath: string; // "Project / parent / leaf"
  billable: boolean;
  taskDescription?: string;
  parentName?: string; // parent task name when the leaf sits under one
}
