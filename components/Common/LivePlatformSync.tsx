"use client";

import { useEffect, useRef } from "react";

type PlatformEvent = {
  version?: string;
};

export default function LivePlatformSync() {
  const versionRef = useRef("");
  const reloadScheduledRef = useRef(false);

  useEffect(() => {
    let disposed = false;
    let source: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const closeSource = () => {
      if (source) {
        source.close();
        source = null;
      }
    };

    const scheduleReconnect = () => {
      if (
        disposed ||
        document.visibilityState !== "visible" ||
        reconnectTimer
      ) {
        return;
      }

      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, 3000);
    };

    const handlePlatformChange = (raw: string) => {
      let payload: PlatformEvent = {};

      try {
        payload = JSON.parse(raw) as PlatformEvent;
      } catch {
        return;
      }

      const next = String(payload.version || "");

      if (!next || next === versionRef.current) {
        return;
      }

      versionRef.current = next;

      if (reloadScheduledRef.current) {
        return;
      }

      reloadScheduledRef.current = true;
      closeSource();

      // Give the SSE connection a moment to close cleanly before
      // replacing the current document with the fresh platform state.
      window.setTimeout(() => {
        if (!disposed) {
          window.location.reload();
        }
      }, 50);
    };

    function connect() {
      if (
        disposed ||
        document.visibilityState !== "visible" ||
        source
      ) {
        return;
      }

      const since = versionRef.current
        ? `?since=${encodeURIComponent(versionRef.current)}`
        : "";

      const nextSource = new EventSource(
        `/api/platform-version/stream${since}`
      );

      source = nextSource;

      nextSource.addEventListener("ready", (event) => {
        const message = event as MessageEvent<string>;

        try {
          const payload = JSON.parse(message.data) as PlatformEvent;
          const next = String(payload.version || "");

          if (next) {
            versionRef.current = next;
          }
        } catch {}
      });

      nextSource.addEventListener("platform-changed", (event) => {
        const message = event as MessageEvent<string>;
        handlePlatformChange(message.data);
      });

      nextSource.onerror = () => {
        if (source === nextSource) {
          nextSource.close();
          source = null;
        }

        scheduleReconnect();
      };
    }

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        if (!source && !reloadScheduledRef.current) {
          connect();
        }
      } else {
        closeSource();

        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
      }
    };

    connect();

    document.addEventListener(
      "visibilitychange",
      onVisibility
    );

    return () => {
      disposed = true;
      closeSource();

      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }

      document.removeEventListener(
        "visibilitychange",
        onVisibility
      );
    };
  }, []);

  return null;
}
