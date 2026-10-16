"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type HeaderUser = {
  id: string;
  nickname: string;
  balance: string;
  role?: string;
  avatarUrl?: string | null;
  steamId?: string | null;
  steamAvatarUrl?: string | null;
};

type AuthContextValue = {
  user: HeaderUser | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const STORAGE_KEY = "duelplay-auth-user-v1";

function readStoredUser(): HeaderUser | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);

    if (!raw) return null;

    const parsed = JSON.parse(raw);

    if (!parsed || typeof parsed.id !== "string") {
      return null;
    }

    return parsed as HeaderUser;
  } catch {
    return null;
  }
}

function storeUser(user: HeaderUser | null) {
  if (typeof window === "undefined") return;

  try {
    if (user) {
      window.sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(user)
      );
    } else {
      window.sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch {}
}

export function AuthProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  // Always start from the server-rendered (signed-out) state so the first
  // client render matches SSR. The cached session is applied in the mount
  // effect below, which runs after hydration and cannot cause error #418.
  const [user, setUser] = useState<HeaderUser | null>(null);

  const [loading, setLoading] = useState(true);

  // A stable identity is required: consumers list `refresh` in effect
  // dependency arrays. If it changed on every auth update, those effects would
  // re-run after each refresh and start an infinite request loop.
  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/auth/me", {
        cache: "no-store",
      });

      const d = await r.json().catch(() => ({}));
      const nextUser = d.user ?? null;

      setUser(nextUser);
      storeUser(nextUser);
    } catch {
      // ?? ?????????? ??? ??????????? ???????????? ??-??
      // ????????? ??????? ??????.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Restore the cached session after hydration to avoid a signed-out flash,
    // then verify it against the server.
    const stored = readStoredUser();

    if (stored) {
      setUser(stored);
      setLoading(false);
    }

    void refresh();

    const onAuth = () => {
      void refresh();
    };

    const onWalletUpdated = () => {
      void refresh();
    };

    window.addEventListener(
      "duelplay:auth-changed",
      onAuth
    );

    window.addEventListener(
      "duelplay:wallet-updated",
      onWalletUpdated
    );

    const timer = window.setInterval(() => {
      if (document.visibilityState !== "hidden") {
        void refresh();
      }
    }, 10000);

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void refresh();
      }
    };

    document.addEventListener(
      "visibilitychange",
      onVisibility
    );

    return () => {
      window.clearInterval(timer);

      document.removeEventListener(
        "visibilitychange",
        onVisibility
      );

      window.removeEventListener(
        "duelplay:auth-changed",
        onAuth
      );

      window.removeEventListener(
        "duelplay:wallet-updated",
        onWalletUpdated
      );
    };
  }, [refresh]);

  useEffect(() => {
    if (!user) return;
    let disposed = false;

    const ping = async () => {
      if (disposed || document.visibilityState === "hidden") return;
      try {
        await fetch("/api/auth/heartbeat", { method: "POST", cache: "no-store" });
      } catch {}
    };

    if (document.visibilityState === "visible") {
      void ping();
    }

    const interval = window.setInterval(() => {
      void ping();
    }, 35000);

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void ping();
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [user?.id]);

  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
      });
    } finally {
      setUser(null);
      storeUser(null);

      window.dispatchEvent(
        new Event("duelplay:auth-changed")
      );

      window.location.href = "/";
    }
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      refresh,
      logout,
    }),
    [user, loading, refresh, logout]
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const value = useContext(AuthContext);

  if (!value) {
    throw new Error(
      "useAuth must be used inside AuthProvider"
    );
  }

  return value;
}
