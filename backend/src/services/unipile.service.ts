import { configService } from "./config.service";
import { ApiError, UnipileError } from "../utils/errors";

interface RequestOptions extends Omit<RequestInit, "body"> {
  params?: Record<string, string>;
  body?: unknown;
}

export interface UnipileAccount {
  object: string;
  id: string;
  name: string;
  type: string;
  status?: string;
  sources?: { id: string; status: string }[];
  connection_params?: unknown;
}

export interface SearchPage {
  object: string;
  items: SearchItem[];
  config?: unknown;
  paging?: { start?: number; page_count?: number; total_count?: number; cursor?: string | null };
}

export interface SearchItem {
  type: string;
  id: string;
  name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  headline?: string | null;
  public_identifier?: string | null;
  public_profile_url?: string | null;
  profile_url?: string | null;
  member_urn?: string | null;
}

export interface UserProfile {
  object: string;
  provider: string;
  provider_id: string;
  public_identifier: string;
  first_name?: string;
  last_name?: string;
  headline?: string;
}

export interface Relation {
  object: string;
  first_name?: string;
  last_name?: string;
  headline?: string;
  public_identifier?: string;
  public_profile_url?: string;
  created_at?: number;
  member_id: string;
  member_urn?: string;
  connection_urn?: string;
  profile_picture_url?: string;
}

export interface RelationsPage {
  object: string;
  items: Relation[];
  cursor?: string | null;
}

export interface CheckpointResult {
  object: string;
  account_id?: string;
  checkpoint?: { type: string };
  [key: string]: unknown;
}

export interface WebhookCreated {
  object: string;
  webhook_id: string;
}

export class UnipileService {
  private async creds(): Promise<{ dsn: string; token: string }> {
    const rawDsn = (await configService.unipileDsn()).trim();
    const dsn = (rawDsn.includes("://") ? rawDsn : `https://${rawDsn}`).replace(/\/+$/, "");
    const token = await configService.unipileAccessToken();
    if (!dsn || !token) {
      throw new ApiError(
        503,
        "Unipile nao configurado. Defina o DSN e o Access Token na pagina de Configuracoes.",
      );
    }
    return { dsn, token };
  }

  private async request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    const { dsn, token } = await this.creds();
    const url = new URL(`${dsn}${path}`);
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) url.searchParams.set(k, v);
    }

    const headers: Record<string, string> = {
      "X-API-KEY": token,
      accept: "application/json",
    };
    if (opts.body !== undefined) headers["content-type"] = "application/json";

    let res: Response;
    try {
      res = await fetch(url.toString(), {
        ...opts,
        headers: { ...headers, ...(opts.headers as Record<string, string> | undefined) },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });
    } catch (err) {
      throw new UnipileError(503, "errors/network_down", `Falha de rede ao acessar Unipile: ${(err as Error).message}`);
    }

    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }

    if (!res.ok) {
      const body = (data as Record<string, unknown>) ?? {};
      const errorType =
        (body.type as string) ||
        ((body.error as Record<string, unknown>)?.type as string) ||
        "errors/unexpected_error";
      const message =
        (body.detail as string) ||
        (body.title as string) ||
        (body.message as string) ||
        `Unipile HTTP ${res.status}`;
      throw new UnipileError(res.status, errorType, message, data);
    }

    return data as T;
  }

  listAccounts(): Promise<{ items?: UnipileAccount[] }> {
    return this.request("/api/v1/accounts");
  }

  getAccount(id: string): Promise<UnipileAccount> {
    return this.request(`/api/v1/accounts/${id}`);
  }

  connectLinkedinNative(
    username: string,
    password: string,
    country?: string,
    ip?: string,
  ): Promise<CheckpointResult> {
    const body: Record<string, string> = {
      provider: "LINKEDIN",
      username,
      password,
    };
    if (country) body.country = country;
    if (ip) body.ip = ip;
    return this.request("/api/v1/accounts", { method: "POST", body });
  }

  connectLinkedinCookies(accessToken: string, userAgent: string): Promise<CheckpointResult> {
    return this.request("/api/v1/accounts", {
      method: "POST",
      body: { provider: "LINKEDIN", access_token: accessToken, user_agent: userAgent },
    });
  }

  solveCheckpoint(accountId: string, code: string): Promise<CheckpointResult> {
    return this.request("/api/v1/accounts/checkpoint", {
      method: "POST",
      body: { provider: "LINKEDIN", account_id: accountId, code },
    });
  }

  createHostedAuthLink(params: {
    apiUrl: string;
    expiresOn: string;
    successRedirectUrl?: string;
    failureRedirectUrl?: string;
    notifyUrl?: string;
    name?: string;
  }): Promise<{ object: string; url: string }> {
    const apiUrl = (params.apiUrl.includes("://") ? params.apiUrl : `https://${params.apiUrl}`).replace(/\/+$/, "");
    const body: Record<string, unknown> = {
      type: "create",
      providers: ["LINKEDIN"],
      api_url: apiUrl,
      expiresOn: params.expiresOn,
    };
    if (params.successRedirectUrl) body.success_redirect_url = params.successRedirectUrl;
    if (params.failureRedirectUrl) body.failure_redirect_url = params.failureRedirectUrl;
    if (params.notifyUrl) body.notify_url = params.notifyUrl;
    if (params.name) body.name = params.name;
    return this.request("/api/v1/hosted/accounts/link", { method: "POST", body });
  }

  searchByUrl(
    accountId: string,
    url: string,
    page = 1,
    limit = 25,
  ): Promise<SearchPage> {
    let searchUrl = url;
    if (page > 1) {
      const u = new URL(url);
      u.searchParams.set("page", String(page));
      searchUrl = u.toString();
    }
    const params: Record<string, string> = { account_id: accountId, limit: String(limit) };
    return this.request("/api/v1/linkedin/search", { method: "POST", params, body: { url: searchUrl } });
  }

  getProfile(accountId: string, identifier: string): Promise<UserProfile> {
    return this.request(`/api/v1/users/${encodeURIComponent(identifier)}`, {
      params: { account_id: accountId },
    });
  }

  async getUserContactInfo(
    accountId: string,
    providerId: string,
  ): Promise<{ emails: string[]; phones: string[] }> {
    const profile = (await this.getProfile(accountId, providerId)) as unknown as {
      contact_info?: { emails?: string[]; phones?: string[] };
    };
    return {
      emails: Array.isArray(profile.contact_info?.emails) ? profile.contact_info.emails : [],
      phones: Array.isArray(profile.contact_info?.phones) ? profile.contact_info.phones : [],
    };
  }

  async getUserContactDetails(
    accountId: string,
    providerId: string,
  ): Promise<{ emails: string[]; phones: string[]; socials: string[]; networkDistance: string | null }> {
    const profile = (await this.getProfile(accountId, providerId)) as unknown as {
      contact_info?: { emails?: string[]; phones?: string[]; websites?: string[] };
      websites?: string[];
      network_distance?: string;
    };
    const contactWebsites = Array.isArray(profile.contact_info?.websites) ? profile.contact_info.websites : [];
    const topWebsites = Array.isArray(profile.websites) ? profile.websites : [];
    const socials = [...new Set([...topWebsites, ...contactWebsites])];
    return {
      emails: Array.isArray(profile.contact_info?.emails) ? profile.contact_info.emails : [],
      phones: Array.isArray(profile.contact_info?.phones) ? profile.contact_info.phones : [],
      socials,
      networkDistance: profile.network_distance ?? null,
    };
  }

  getRelations(accountId: string, cursor?: string, limit = 1000): Promise<RelationsPage> {
    const params: Record<string, string> = { account_id: accountId, limit: String(limit) };
    if (cursor) params.cursor = cursor;
    return this.request("/api/v1/users/relations", { params });
  }

  sendInvitation(
    accountId: string,
    providerId: string,
    message?: string,
  ): Promise<{ invitation_id: string }> {
    const body: Record<string, unknown> = { account_id: accountId, provider_id: providerId };
    if (message && message.trim()) body.message = message;
    return this.request("/api/v1/users/invite", {
      method: "POST",
      body,
    });
  }

  sendChatMessage(chatId: string, text: string): Promise<{ message_id: string }> {
    return this.request(`/api/v1/chats/${chatId}/messages`, {
      method: "POST",
      body: { text },
    });
  }

  sendDirectMessage(
    accountId: string,
    providerId: string,
    text: string,
  ): Promise<{ chat_id?: string; message_id?: string }> {
    return this.request("/api/v1/chats", {
      method: "POST",
      body: { account_id: accountId, attendees_ids: [providerId], text },
    });
  }

  createWebhook(params: {
    requestUrl: string;
    source: "messaging" | "users" | "account_status";
    events?: string[];
    headers?: { key: string; value: string }[];
    name?: string;
  }): Promise<WebhookCreated> {
    const body: Record<string, unknown> = {
      request_url: params.requestUrl,
      source: params.source,
    };
    if (params.events) body.events = params.events;
    if (params.headers) body.headers = params.headers;
    if (params.name) body.name = params.name;
    return this.request("/api/v1/webhooks", { method: "POST", body });
  }

  listWebhooks(): Promise<{ items?: { webhook_id: string; source: string; request_url: string }[] }> {
    return this.request("/api/v1/webhooks");
  }

  deleteAccount(accountId: string): Promise<{ object: string }> {
    return this.request(`/api/v1/accounts/${accountId}`, { method: "DELETE" });
  }
}

export const unipile = new UnipileService();
