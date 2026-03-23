/** ManicTime activity data types */

export interface ActivityDetail {
  activityName: string;
  groupName: string;
  groupKey: string;
  summaryType: "Application" | "Document" | "WebSite" | "ComputerUsage" | "Tag";
}

/** A contiguous block of activity from ManicTime */
export interface ActivityBlock {
  startTime: string; // ISO datetime
  endTime: string;
  durationMinutes: number;
  applications: Array<{ name: string; windowTitle: string; key: string }>;
  websites: Array<{ domain: string; url: string }>;
  documents: Array<{ name: string; path: string }>;
  computerState: "active" | "away" | "locked" | "unknown";
  tags: string[];
}

/** A group summary entry from ManicTime */
export interface GroupSummary {
  name: string;
  key: string;
  durationMinutes: number;
  summaryType: string;
}

/** Privacy filter patterns */
export interface PrivacyFilter {
  /** Website domains to exclude */
  excludeDomains: string[];
  /** App names to exclude */
  excludeApps: string[];
  /** Window title patterns to exclude (regex) */
  excludeTitlePatterns: string[];
  /** Email addresses that are personal */
  personalEmails: string[];
}

export const DEFAULT_PRIVACY_FILTER: PrivacyFilter = {
  excludeDomains: ["galaxus.ch", "web.whatsapp.com", "whatsapp.com"],
  excludeApps: ["WhatsApp"],
  excludeTitlePatterns: ["172\\.25\\."],
  personalEmails: ["mh@h3in.ch", "mh@h3in.com"],
};
