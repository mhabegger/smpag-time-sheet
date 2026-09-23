import * as React from "react";
import { CalendarDays, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { connectCalendar, fetchCalendarAuth } from "@/server/fns";
import type { DayCalendar } from "@/lib/types";

/**
 * Status line under the day timeline for the Outlook calendar: a hint when
 * not configured, a Connect button when signed out (opens the Microsoft login
 * in the browser, then polls until connected), and errors.
 */
export function CalendarConnect({
  calendar,
  onConnected,
}: {
  calendar: DayCalendar;
  onConnected: () => void;
}) {
  const [signingIn, setSigningIn] = React.useState(false);
  const [signInUrl, setSignInUrl] = React.useState<string | undefined>();
  const [error, setError] = React.useState<string | undefined>();

  React.useEffect(() => {
    if (!signingIn) return;
    const t = setInterval(async () => {
      const s = await fetchCalendarAuth();
      setSignInUrl(s.signInUrl);
      if (s.connected) {
        setSigningIn(false);
        onConnected();
      } else if (!s.signingIn) {
        setSigningIn(false);
        setError(s.error ?? "Sign-in was not completed.");
      }
    }, 2000);
    return () => clearInterval(t);
  }, [signingIn, onConnected]);

  const connect = async () => {
    setError(undefined);
    const s = await connectCalendar();
    if (s.connected) return onConnected();
    setSignInUrl(s.signInUrl);
    setSigningIn(s.signingIn);
    if (!s.signingIn && s.error) setError(s.error);
  };

  if (calendar.status === "ok") return null;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <CalendarDays size={13} className="text-violet-300/80" />
      {calendar.status === "not-configured" && (
        <span>
          Outlook calendar not set up — add <code>MS_GRAPH_CLIENT_ID</code> (and{" "}
          <code>MS_GRAPH_TENANT_ID</code>) to <code>.env</code> and restart.
        </span>
      )}
      {calendar.status === "error" && (
        <span className="text-warn">Calendar unavailable: {calendar.error?.slice(0, 200)}</span>
      )}
      {(calendar.status === "signed-out" || calendar.status === "error") && (
        <>
          <Button size="sm" variant="secondary" disabled={signingIn} onClick={() => void connect()}>
            {signingIn ? (
              <>
                <Loader2 size={12} className="animate-spin" /> Waiting for Microsoft sign-in…
              </>
            ) : (
              "Connect Outlook calendar"
            )}
          </Button>
          {signingIn && signInUrl && (
            <a href={signInUrl} target="_blank" rel="noreferrer" className="underline">
              browser didn't open? click here
            </a>
          )}
        </>
      )}
      {error && <span className="text-bad">{error.slice(0, 300)}</span>}
    </div>
  );
}
