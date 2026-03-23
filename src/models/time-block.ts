/** Core types for time sheet entries */

export interface TimeSlot {
  /** Start time rounded to 15-min boundary (HH:mm) */
  from: string;
  /** End time rounded to 15-min boundary (HH:mm) */
  to: string;
  /** Duration in minutes (always multiple of 15) */
  durationMinutes: number;
  /** Assigned ZEP project name */
  projectName: string;
  /** Assigned ZEP project ID */
  projectId: number;
  /** Assigned ZEP task name */
  taskName: string;
  /** Assigned ZEP task ID */
  taskId: number;
  /** Activity type ID */
  activityId: string;
  /** Is this billable? */
  billable: boolean;
  /** Brief description of what was happening */
  description: string;
  /** Confidence of the AI classification (0-1) */
  confidence: number;
  /** Top applications/websites active during this slot */
  topActivities: string[];
}

/** A proposed timesheet for a day */
export interface DayTimeSheet {
  date: string; // YYYY-MM-DD
  slots: TimeSlot[];
  totalMinutes: number;
  totalBillableMinutes: number;
  gaps: Array<{ from: string; to: string }>; // Untracked periods
}
