import { startTransition, useEffect, useRef, useState } from "react";
import { getErrorMessage, launcherApi } from "../api/api-client";
import { COMMAND_CENTER_POLL_INTERVAL_MS, emptyObserverCommandCenterSnapshot } from "../services/observer-command-center";
import type {
  ObserverCommandActionResponse,
  ObserverCommandCenterSnapshot,
} from "../types";

type UseObserverCommandCenterResult = {
  snapshot: ObserverCommandCenterSnapshot;
  loading: boolean;
  error: string | null;
  busyActionPath: string | null;
  refresh: () => Promise<ObserverCommandCenterSnapshot>;
  runAction: (path: string) => Promise<ObserverCommandActionResponse>;
};

export function useObserverCommandCenter(
  preferredMapKey?: string | null,
): UseObserverCommandCenterResult {
  const [snapshot, setSnapshot] = useState<ObserverCommandCenterSnapshot>(
    emptyObserverCommandCenterSnapshot,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyActionPath, setBusyActionPath] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const mapKeyRef = useRef<string | null>(preferredMapKey ?? null);

  useEffect(() => {
    mapKeyRef.current = preferredMapKey ?? null;
  }, [preferredMapKey]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadSnapshot = async (markLoaded = false) => {
      try {
        const nextSnapshot = await launcherApi.getObserverCommandCenterSnapshot(
          mapKeyRef.current,
        );
        if (cancelled || !mountedRef.current) {
          return nextSnapshot;
        }
        startTransition(() => {
          setSnapshot(nextSnapshot);
        });
        setError(null);
        if (markLoaded) {
          setLoading(false);
        }
        return nextSnapshot;
      } catch (nextError) {
        if (!cancelled && mountedRef.current) {
          setError(getErrorMessage(nextError));
          if (markLoaded) {
            setLoading(false);
          }
        }
        throw nextError;
      }
    };

    void loadSnapshot(true).catch(() => undefined);
    const timer = window.setInterval(() => {
      void loadSnapshot(false).catch(() => undefined);
    }, COMMAND_CENTER_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [preferredMapKey]);

  const refresh = async () => {
    const nextSnapshot = await launcherApi.getObserverCommandCenterSnapshot(
      mapKeyRef.current,
    );
    if (mountedRef.current) {
      startTransition(() => {
        setSnapshot(nextSnapshot);
      });
      setError(null);
      setLoading(false);
    }
    return nextSnapshot;
  };

  const runAction = async (path: string) => {
    setBusyActionPath(path);
    try {
      const result = await launcherApi.runObserverCommandAction(
        path,
        mapKeyRef.current,
      );
      if (mountedRef.current) {
        startTransition(() => {
          setSnapshot(result.snapshot);
        });
        setError(null);
      }
      return result;
    } catch (nextError) {
      if (mountedRef.current) {
        setError(getErrorMessage(nextError));
      }
      throw nextError;
    } finally {
      if (mountedRef.current) {
        setBusyActionPath((current) => (current === path ? null : current));
      }
    }
  };

  return {
    snapshot,
    loading,
    error,
    busyActionPath,
    refresh,
    runAction,
  };
}
