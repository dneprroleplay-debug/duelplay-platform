"use client";

import {
  createContext,
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
  const [user, setUser] = useState<HeaderUser | null>(
    readStoredUser
  );

  const [loading, setLoading] = useState(
    () => readStoredUser() === null
  );

  const refresh = async () => {
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
  };

  useEffect(() => {
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
  }, []);

  const logout = async () => {
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
  };

  const value = useMemo(
    () => ({
      user,
      loading,
      refresh,
      logout,
    }),
    [user, loading]
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
