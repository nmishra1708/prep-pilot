import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { authRequest } from "./api";
import { setCurrentUserId } from "../storage/userScope";
import { claimLegacyBrowserData } from "../storage/legacyMigration";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  legacyDataOwner?: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  login: (email: string, password: string, rememberMe: boolean) => Promise<void>;
  signup: (input: { name: string; email: string; password: string; confirmPassword: string; acceptTerms: true }) => Promise<void>;
  logout: () => Promise<void>;
  logoutAll: () => Promise<void>;
  updateUser: (user: AuthUser) => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function setUserAndMigrate(user: AuthUser | null) {
  setCurrentUserId(user?.id ?? null);
  if (user?.legacyDataOwner) await claimLegacyBrowserData(user.id);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const acceptUser = useCallback(async (nextUser: AuthUser | null) => {
    await setUserAndMigrate(nextUser);
    setUser(nextUser);
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const { user: nextUser } = await authRequest<{ user: AuthUser }>("/api/auth/me");
      await acceptUser(nextUser);
    } catch (error) {
      if (error instanceof Error && !error.message.includes("Authentication required") && !error.message.includes("Session expired")) throw error;
      await acceptUser(null);
    }
  }, [acceptUser]);

  useEffect(() => {
    let active = true;
    void refreshUser().catch(() => { if (active) void acceptUser(null); }).finally(() => { if (active) setIsLoading(false); });
    const expire = () => { void acceptUser(null); };
    window.addEventListener("auth:expired", expire);
    return () => {
      active = false;
      window.removeEventListener("auth:expired", expire);
    };
  }, [acceptUser, refreshUser]);

  const login = useCallback(async (email: string, password: string, rememberMe: boolean) => {
    const result = await authRequest<{ user: AuthUser }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password, rememberMe }),
    });
    await acceptUser(result.user);
  }, [acceptUser]);

  const signup = useCallback(async (input: { name: string; email: string; password: string; confirmPassword: string; acceptTerms: true }) => {
    const result = await authRequest<{ user: AuthUser }>("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify(input),
    });
    if (result.user.legacyDataOwner) await claimLegacyBrowserData(result.user.id);
  }, []);

  const logout = useCallback(async () => {
    try { await authRequest<void>("/api/auth/logout", { method: "POST" }); }
    finally { await acceptUser(null); }
  }, [acceptUser]);

  const logoutAll = useCallback(async () => {
    try { await authRequest<void>("/api/auth/logout-all", { method: "POST" }); }
    finally { await acceptUser(null); }
  }, [acceptUser]);

  const updateUser = useCallback((nextUser: AuthUser) => setUser(nextUser), []);
  const value = useMemo(() => ({ user, isLoading, login, signup, logout, logoutAll, updateUser, refreshUser }), [
    user, isLoading, login, signup, logout, logoutAll, updateUser, refreshUser,
  ]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider.");
  return value;
}
