import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  api,
  clearOperatingAs as clearStoredOperatingAs,
  clearToken,
  getOperatingAsUser as getStoredOperatingAsUser,
  getToken,
  setOperatingAs as setStoredOperatingAs,
  setToken,
} from "../lib/api";
import type { AuthUser } from "../types";

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  operatingAs: AuthUser | null;
  login: (username: string, password: string) => Promise<AuthUser>;
  register: (input: { name: string; username: string; password: string; whatsapp?: string }) => Promise<void>;
  setOperatingAs: (u: AuthUser) => void;
  clearOperatingAs: () => void;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [operatingAs, setOperatingAsState] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setOperatingAsState(getStoredOperatingAsUser());
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    api
      .get<AuthUser>("/auth/me")
      .then((u) => setUser(u))
      .catch(() => clearToken())
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const res = await api.post<{ token: string; user: AuthUser }>("/auth/login", {
      username,
      password,
    });
    setToken(res.token);
    setUser(res.user);
    return res.user;
  }, []);

  const register = useCallback(
    async (input: { name: string; username: string; password: string; whatsapp?: string }) => {
      await api.post("/auth/register", input);
    },
    [],
  );

  const setOperatingAs = useCallback((u: AuthUser) => {
    setOperatingAsState(u);
    setStoredOperatingAs(u);
  }, []);

  const clearOperatingAs = useCallback(() => {
    setOperatingAsState(null);
    clearStoredOperatingAs();
  }, []);

  const logout = useCallback(() => {
    clearToken();
    clearStoredOperatingAs();
    setUser(null);
    setOperatingAsState(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, loading, operatingAs, login, register, setOperatingAs, clearOperatingAs, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve ser usado dentro de AuthProvider");
  return ctx;
}
