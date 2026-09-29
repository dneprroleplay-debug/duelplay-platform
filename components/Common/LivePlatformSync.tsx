"use client";

import { useEffect, useRef } from "react";

export default function LivePlatformSync() {
  const versionRef = useRef("");
  const initializedRef = useRef(false);
  const reloadScheduledRef = useRef(false);

  useEffect(() => {
    let disposed = false;
    let loading = false;

    const check = async () => {
      if (
        disposed ||
        loading ||
        document.visibilityState === "hidden" ||
        reloadScheduledRef.current
      ) {
        return;
      }

      loading = true;

      try {
        const response = await fetch(
          `/api/platform-version?ts=${Date.now()}`,
          {
            cache: "no-store",
            headers: {
              "Cache-Control": "no-cache",
            },
          }
        );

        if (!response.ok) return;

        const data = await response.json();
        const nextVersion = String(data.version || "");

        if (!nextVersion) return;

        if (!initializedRef.current) {
          versionRef.current = nextVersion;
          initializedRef.current = true;
          return;
        }

        if (
          versionRef.current &&
          nextVersion !== versionRef.current
        ) {
          versionRef.current = nextVersion;

          if (reloadScheduledRef.current) return;

          reloadScheduledRef.current = true;

          // Full browser reload:
          // fresh HTML + fresh React state + fresh API data +
          // fresh global settings for every opened client.
          window.location.reload();
        }
      } catch {
        // Temporary network failure: keep checking.
      } finally {
        loading = false;
      }
    };

    void check();

    const timer = window.setInterval(() => {
      void check();
    }, 1000);

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void check();
      }
    };

    document.addEventListener(
      "visibilitychange",
      onVisibility
    );

    return () => {
      disposed = true;
      window.clearInterval(timer);
      document.removeEventListener(
        "visibilitychange",
        onVisibility
      );
    };
  }, []);

  return null;
}
