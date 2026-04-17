"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { AuthUser } from "@/types/arenzyra";
import { fetchSession, login as loginApi, logout as logoutApi } from "@/lib/auth";
import {
  AUTH_STORAGE_EVENT,
  hasStoredAuthSession,
} from "@/lib/auth-storage";

type AuthContextType = {
  user: AuthUser | null;
  loading: boolean;
  refresh: () => Promise<void>;
  login: (
    email: string,
    password: string,
    rememberDevice?: boolean,
  ) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    if (!hasStoredAuthSession()) {
      setUser(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const data = await fetchSession();
      setUser(data.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }

  async function login(
    email: string,
    password: string,
    rememberDevice = true,
  ) {
    setLoading(true);
    try {
      const data = await loginApi(email, password, rememberDevice);
      setUser(data.user);
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    setLoading(true);
    try {
      await logoutApi();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    function syncFromStorage() {
      if (!hasStoredAuthSession()) {
        setUser(null);
        setLoading(false);
        return;
      }

      void load();
    }

    window.addEventListener(AUTH_STORAGE_EVENT, syncFromStorage);
    window.addEventListener("storage", syncFromStorage);

    return () => {
      window.removeEventListener(AUTH_STORAGE_EVENT, syncFromStorage);
      window.removeEventListener("storage", syncFromStorage);
    };
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, refresh: load, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
