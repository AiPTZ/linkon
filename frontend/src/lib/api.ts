const BASE = "/api";
const TOKEN_KEY = "linkon_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function onUnauthorized(): void {
  clearToken();
  if (!window.location.pathname.startsWith("/login")) {
    window.location.assign("/login");
  }
}

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...(opts.headers as Record<string, string>) };
  if (opts.body) headers["Content-Type"] = "application/json";
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(BASE + path, { ...opts, headers });
  } catch {
    throw new ApiError(0, "Sem conexão com o servidor. Verifique se o backend está rodando.");
  }

  if (res.status === 401 && !path.startsWith("/auth/login")) {
    onUnauthorized();
  }

  if (!res.ok) {
    let data: { error?: string; details?: unknown } | null = null;
    try {
      data = (await res.json()) as { error?: string; details?: unknown };
    } catch {
      data = null;
    }
    throw new ApiError(res.status, data?.error ?? `Erro ${res.status}`, data?.details);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body ?? {}) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
