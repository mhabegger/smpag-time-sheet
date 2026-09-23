/**
 * Outlook calendar (Microsoft Graph, delegated Calendars.Read) — shows the
 * day's meetings next to the activity timeline and feeds them to the analyzer
 * (meetings often happen away from the computer, so ManicTime sees nothing).
 *
 * Auth: MSAL public client + interactive sign-in in the system browser with a
 * localhost loopback redirect (no client secret). Tokens (incl. the refresh
 * token) are cached in .cache/msal-token-cache.json, so sign-in is one-time.
 *
 * Config (.env): MS_GRAPH_CLIENT_ID (required), MS_GRAPH_TENANT_ID (tenant
 * GUID or domain; defaults to "organizations").
 */

import { spawn } from "child_process";
import { mkdir, readFile, writeFile, rm } from "fs/promises";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { addDays, format, parseISO } from "date-fns";
import type {
  AccountInfo,
  ICachePlugin,
  PublicClientApplication,
  TokenCacheContext,
} from "@azure/msal-node";
import { getEnv } from "../config/env.js";
import type { CalendarEvent, DayCalendar } from "../lib/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = resolve(__dirname, "../../.cache/msal-token-cache.json");
const SCOPES = ["Calendars.Read"];
const GRAPH = "https://graph.microsoft.com/v1.0";

interface CalState {
  pca: PublicClientApplication | null;
  pcaKey: string;
  signIn: Promise<void> | null;
  signInUrl: string | null;
  signInError: string | null;
  events: Map<string, { at: number; events: CalendarEvent[] }>;
}
const g = globalThis as { __tsCalendar?: CalState };
const state: CalState = (g.__tsCalendar ??= {
  pca: null,
  pcaKey: "",
  signIn: null,
  signInUrl: null,
  signInError: null,
  events: new Map(),
});

function config(): { clientId: string; tenant: string } | null {
  getEnv(); // make sure .env is loaded
  const clientId = process.env.MS_GRAPH_CLIENT_ID?.trim();
  if (!clientId) return null;
  return { clientId, tenant: process.env.MS_GRAPH_TENANT_ID?.trim() || "organizations" };
}

const cachePlugin: ICachePlugin = {
  async beforeCacheAccess(ctx: TokenCacheContext) {
    try {
      ctx.tokenCache.deserialize(await readFile(CACHE_FILE, "utf-8"));
    } catch {
      // no cache yet
    }
  },
  async afterCacheAccess(ctx: TokenCacheContext) {
    if (!ctx.cacheHasChanged) return;
    await mkdir(dirname(CACHE_FILE), { recursive: true });
    await writeFile(CACHE_FILE, ctx.tokenCache.serialize(), "utf-8");
  },
};

async function getPca(): Promise<PublicClientApplication | null> {
  const cfg = config();
  if (!cfg) return null;
  const key = `${cfg.clientId}|${cfg.tenant}`;
  if (!state.pca || state.pcaKey !== key) {
    const { PublicClientApplication } = await import("@azure/msal-node");
    state.pca = new PublicClientApplication({
      auth: {
        clientId: cfg.clientId,
        authority: `https://login.microsoftonline.com/${cfg.tenant}`,
      },
      cache: { cachePlugin },
    });
    state.pcaKey = key;
  }
  return state.pca;
}

async function account(): Promise<AccountInfo | null> {
  const pca = await getPca();
  if (!pca) return null;
  const accounts = await pca.getTokenCache().getAllAccounts();
  return accounts[0] ?? null;
}

async function accessToken(): Promise<string | null> {
  const pca = await getPca();
  const acc = await account();
  if (!pca || !acc) return null;
  try {
    const res = await pca.acquireTokenSilent({ account: acc, scopes: SCOPES });
    return res.accessToken;
  } catch {
    return null; // refresh token expired/revoked → user must sign in again
  }
}

/** Open a URL in the default browser (Windows / macOS / Linux). */
function openBrowser(url: string): Promise<void> {
  const [cmd, args] =
    process.platform === "win32"
      ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
  return Promise.resolve();
}

/**
 * Page served by MSAL's loopback server after sign-in. MSAL sends it without a
 * Content-Type, so it MUST start with <!DOCTYPE html> for the browser to sniff
 * it as HTML (otherwise the markup is shown as plain text).
 */
function authPage(title: string, message: string): string {
  const app = `http://localhost:${process.env.PORT ?? 3344}/`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title></head>
<body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#0b0d10;color:#e5e7eb;font-family:system-ui,sans-serif">
<div style="text-align:center"><h2 style="margin:0 0 8px">${title}</h2>
<p style="margin:0 0 16px;color:#9ca3af">${message}</p>
<a href="${app}" style="color:#60a5fa">Back to the timesheet app</a></div>
<script>setTimeout(function(){window.close()},1500)</script></body></html>`;
}

export interface CalendarAuthStatus {
  configured: boolean;
  connected: boolean;
  account?: string;
  signingIn: boolean;
  signInUrl?: string;
  error?: string;
}

export async function calendarAuthStatus(): Promise<CalendarAuthStatus> {
  if (!config()) return { configured: false, connected: false, signingIn: false };
  const acc = await account();
  return {
    configured: true,
    connected: !!acc,
    account: acc?.username,
    signingIn: !!state.signIn,
    signInUrl: state.signIn ? (state.signInUrl ?? undefined) : undefined,
    error: state.signInError ?? undefined,
  };
}

/**
 * Start the interactive sign-in: opens the Microsoft login page in the system
 * browser; MSAL listens on a localhost port for the redirect. Returns
 * immediately — poll calendarAuthStatus() for completion.
 */
export async function startCalendarSignIn(): Promise<CalendarAuthStatus> {
  const pca = await getPca();
  if (!pca) return calendarAuthStatus();
  if (!state.signIn) {
    state.signInError = null;
    state.signInUrl = null;
    state.signIn = pca
      .acquireTokenInteractive({
        scopes: SCOPES,
        openBrowser: (url) => {
          state.signInUrl = url;
          return openBrowser(url);
        },
        successTemplate: authPage(
          "Outlook calendar connected",
          "You can close this tab — the timesheet app picks up the calendar automatically."
        ),
        errorTemplate: authPage(
          "Sign-in failed",
          "Check the timesheet app for details and try again."
        ),
      })
      .then(() => {
        state.events.clear();
      })
      .catch((err: unknown) => {
        state.signInError = err instanceof Error ? err.message : String(err);
      })
      .finally(() => {
        state.signIn = null;
      });
    // Give MSAL a moment to produce the URL so the UI can offer a fallback link.
    await new Promise((r) => setTimeout(r, 400));
  }
  return calendarAuthStatus();
}

export async function signOutCalendar(): Promise<CalendarAuthStatus> {
  state.pca = null;
  state.events.clear();
  await rm(CACHE_FILE, { force: true });
  return calendarAuthStatus();
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

interface GraphEvent {
  subject?: string;
  start: { dateTime: string };
  end: { dateTime: string };
  location?: { displayName?: string };
  isAllDay?: boolean;
  isCancelled?: boolean;
  showAs?: string;
  isOnlineMeeting?: boolean;
  responseStatus?: { response?: string };
  organizer?: { emailAddress?: { name?: string } };
}

/** Graph UTC "2026-09-22T07:00:00.0000000" → Date. */
const utc = (dt: string) => new Date(`${dt.slice(0, 19)}Z`);

function toEvents(date: string, list: GraphEvent[]): CalendarEvent[] {
  const dayStart = parseISO(`${date}T00:00:00`);
  const dayEnd = addDays(dayStart, 1);
  const out: CalendarEvent[] = [];
  for (const ev of list) {
    if (ev.isCancelled || ev.responseStatus?.response === "declined") continue;
    // All-day events are date-only in the event's own zone — don't shift them.
    const start = ev.isAllDay ? parseISO(ev.start.dateTime.slice(0, 10)) : utc(ev.start.dateTime);
    const end = ev.isAllDay ? parseISO(ev.end.dateTime.slice(0, 10)) : utc(ev.end.dateTime);
    const a = start < dayStart ? dayStart : start;
    const b = end > dayEnd ? dayEnd : end;
    if (b <= a) continue;
    out.push({
      from: format(a, "HH:mm"),
      to: b.getTime() === dayEnd.getTime() ? "23:59" : format(b, "HH:mm"),
      subject: ev.subject?.trim() || "(no subject)",
      location: ev.location?.displayName?.trim() || undefined,
      allDay: !!ev.isAllDay,
      showAs: ev.showAs ?? "busy",
      online: !!ev.isOnlineMeeting,
      organizer: ev.organizer?.emailAddress?.name,
    });
  }
  return out.sort((x, y) => x.from.localeCompare(y.from));
}

async function fetchEvents(date: string, token: string): Promise<CalendarEvent[]> {
  const dayStart = parseISO(`${date}T00:00:00`);
  const params = new URLSearchParams({
    startDateTime: dayStart.toISOString(),
    endDateTime: addDays(dayStart, 1).toISOString(),
    $select:
      "subject,start,end,location,isAllDay,isCancelled,showAs,isOnlineMeeting,responseStatus,organizer",
    $orderby: "start/dateTime",
    $top: "200",
  });
  const res = await fetch(`${GRAPH}/me/calendarView?${params}`, {
    headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.timezone="UTC"' },
  });
  if (!res.ok) throw new Error(`Graph ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as { value: GraphEvent[] };
  return toEvents(date, body.value);
}

/** The day's calendar for the UI/analyzer. Never throws. */
export async function getDayCalendar(date: string): Promise<DayCalendar> {
  if (!config()) return { status: "not-configured", events: [] };
  const cached = state.events.get(date);
  if (cached && Date.now() - cached.at < 5 * 60_000) return { status: "ok", events: cached.events };
  const token = await accessToken();
  if (!token) return { status: "signed-out", events: [] };
  try {
    const events = await fetchEvents(date, token);
    state.events.set(date, { at: Date.now(), events });
    return { status: "ok", events };
  } catch (err) {
    return { status: "error", events: [], error: err instanceof Error ? err.message : String(err) };
  }
}
