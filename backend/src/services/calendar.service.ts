import { env } from "../config/env";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_CAL_URL = "https://www.googleapis.com/calendar/v3";

export function buildOAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: env.GOOGLE_REDIRECT_URI,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/userinfo.email",
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

async function fetchUserEmail(accessToken: string): Promise<string> {
  if (!accessToken) return "";
  const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return "";
  const data = (await res.json()) as { email?: string };
  return data.email ?? "";
}

export async function exchangeCodeForTokens(
  code: string,
): Promise<{ refreshToken: string; email: string }> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: env.GOOGLE_REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange HTTP ${res.status}`);
  const data = (await res.json()) as { refresh_token?: string; access_token?: string };
  if (!data.refresh_token) throw new Error("Google não devolveu refresh_token");
  const email = await fetchUserEmail(data.access_token ?? "");
  return { refreshToken: data.refresh_token, email };
}

export async function refreshAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Google refresh HTTP ${res.status}`);
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("Google refresh sem access_token");
  return data.access_token;
}

export async function createCalendarEvent(input: {
  accessToken: string;
  summary: string;
  start: string;
  end: string;
  timeZone: string;
  attendeeEmail: string;
  requestId: string;
}): Promise<{ eventId: string; meetLink: string | null }> {
  const url = `${GOOGLE_CAL_URL}/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.accessToken}`,
    },
    body: JSON.stringify({
      summary: input.summary,
      start: { dateTime: input.start, timeZone: input.timeZone },
      end: { dateTime: input.end, timeZone: input.timeZone },
      attendees: [{ email: input.attendeeEmail }],
      conferenceData: {
        createRequest: {
          requestId: input.requestId,
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      },
    }),
  });
  if (!res.ok) throw new Error(`Google calendar HTTP ${res.status}`);
  const data = (await res.json()) as {
    id?: string;
    hangoutLink?: string;
    conferenceData?: { entryPoints?: { uri?: string }[] };
  };
  const meetLink =
    data.hangoutLink ??
    data.conferenceData?.entryPoints?.find((e) => e.uri)?.uri ??
    null;
  if (!data.id) throw new Error("Google calendar sem id");
  return { eventId: data.id, meetLink };
}

const sleepMs = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function createEventRobust(input: {
  refreshToken: string;
  summary: string;
  start: string;
  end: string;
  timeZone: string;
  attendeeEmail: string;
  requestId: string;
}): Promise<{ eventId: string; meetLink: string | null } | { disconnected: true } | { retryExhausted: true }> {
  let accessToken = await refreshAccessToken(input.refreshToken).catch(() => "");
  if (!accessToken) return { disconnected: true };

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await createCalendarEvent({
        accessToken,
        summary: input.summary,
        start: input.start,
        end: input.end,
        timeZone: input.timeZone,
        attendeeEmail: input.attendeeEmail,
        requestId: input.requestId,
      });
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes("401")) {
        accessToken = await refreshAccessToken(input.refreshToken).catch(() => "");
        if (!accessToken) return { disconnected: true };
        continue;
      }
      if (msg.includes("429") || msg.includes("500") || msg.includes("503")) {
        await sleepMs([0, 1000, 3000][attempt] ?? 3000);
        continue;
      }
      throw err;
    }
  }
  return { retryExhausted: true };
}
