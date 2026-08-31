import { describe, expect, it, vi, afterEach } from "vitest";
import {
  buildOAuthUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
  createCalendarEvent,
  createEventRobust,
} from "./calendar.service";

function mockJson(body: unknown, ok = true, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok, status, json: async () => body }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("buildOAuthUrl", () => {
  it("monta a URL com state, escopos e offline/consent", () => {
    const url = buildOAuthUrl("STATE123");
    expect(url).toContain("accounts.google.com/o/oauth2/v2/auth");
    expect(url).toContain("state=STATE123");
    expect(url).toContain("access_type=offline");
    expect(url).toContain("prompt=consent");
    expect(url).toContain("calendar.events");
    expect(url).toContain("userinfo.email");
  });
});

describe("exchangeCodeForTokens", () => {
  it("troca code por refresh_token e busca e-mail do usuário", async () => {
    mockJson({ refresh_token: "RT", access_token: "AT" });
    const emailCall = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ email: "vendedor@x.com" }),
    });
    vi.stubGlobal("fetch", emailCall as unknown as typeof fetch);
    emailCall.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ refresh_token: "RT", access_token: "AT" }),
    });
    const out = await exchangeCodeForTokens("CODE");
    expect(out.refreshToken).toBe("RT");
    expect(out.email).toBe("vendedor@x.com");
  });

  it("lança erro quando o Google não devolve refresh_token", async () => {
    mockJson({ access_token: "AT" });
    await expect(exchangeCodeForTokens("CODE")).rejects.toThrow("refresh_token");
  });
});

describe("refreshAccessToken", () => {
  it("devolve access_token novo", async () => {
    mockJson({ access_token: "AT2" });
    expect(await refreshAccessToken("RT")).toBe("AT2");
  });
});

describe("createCalendarEvent", () => {
  it("envia payload com conferenceData e devolve eventId + hangoutLink", async () => {
    mockJson({ id: "EV1", hangoutLink: "https://meet.google.com/abc" });
    const out = await createCalendarEvent({
      accessToken: "AT",
      summary: "Reunião X com João",
      start: "2026-09-01T12:00:00.000Z",
      end: "2026-09-01T12:30:00.000Z",
      timeZone: "America/Sao_Paulo",
      attendeeEmail: "joao@x.com",
      requestId: "B1",
    });
    expect(out.eventId).toBe("EV1");
    expect(out.meetLink).toBe("https://meet.google.com/abc");
    const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.attendees).toEqual([{ email: "joao@x.com" }]);
    expect(body.conferenceData.createRequest.requestId).toBe("B1");
  });
});

describe("createEventRobust", () => {
  it("retorna disconnected quando o refresh falha", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({}) }),
    );
    const out = await createEventRobust({
      refreshToken: "RT",
      summary: "S",
      start: "2026-09-01T12:00:00.000Z",
      end: "2026-09-01T12:30:00.000Z",
      timeZone: "America/Sao_Paulo",
      attendeeEmail: "a@x.com",
      requestId: "B1",
    });
    expect(out).toEqual({ disconnected: true });
  });

  it("refaz o request após 401 e retorna evento", async () => {
    const calls = [
      { ok: true, json: async () => ({ access_token: "AT" }) },   // refresh inicial ok
      { ok: false, status: 401, json: async () => ({}) },         // create falha
      { ok: true, json: async () => ({ access_token: "AT2" }) },  // refresh após 401 ok
      { ok: true, json: async () => ({ id: "EV2" }) },            // create ok
    ];
    const fn = vi.fn();
    calls.forEach((c) => fn.mockResolvedValueOnce(c));
    vi.stubGlobal("fetch", fn);
    const out = await createEventRobust({
      refreshToken: "RT",
      summary: "S",
      start: "2026-09-01T12:00:00.000Z",
      end: "2026-09-01T12:30:00.000Z",
      timeZone: "America/Sao_Paulo",
      attendeeEmail: "a@x.com",
      requestId: "B1",
    });
    expect(out).toEqual({ eventId: "EV2", meetLink: null });
    expect(fn).toHaveBeenCalledTimes(4);
  });
});
