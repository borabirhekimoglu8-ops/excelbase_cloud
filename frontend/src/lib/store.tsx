"use client";

import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { DateScope, OperationSummary, fetchSummary } from "@/lib/api";

const emptySummary: OperationSummary = {
  passenger_count: 0,
  ready_count: 0,
  missing_count: 0,
  adult_total: 0,
  child_total: 0,
  total_fee: 0,
  with_photo: 0,
  missing_photo: 0,
  missing_passport: 0,
  missing_voucher: 0,
  missing_fee: 0,
  duplicates: 0,
  readiness_percent: 0,
  issue_counts: {},
  loaded_files: [],
  import_history: [],
  today_count: 0,
  can_undo: false,
  last_batch_id: "",
  unmatched_photo_count: 0,
  persistence: "device-encrypted",
  version: "",
};

export type Toast = { id: number; text: string; tone: "ok" | "warn" | "error" };

type StoreValue = {
  summary: OperationSummary;
  connected: boolean;
  version: number;
  refresh: () => Promise<boolean>;
  bump: () => void;
  notify: (text: string, tone?: Toast["tone"]) => void;
  toasts: Toast[];
  dateScope: DateScope;
  setDateScope: (scope: DateScope) => void;
};

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [summary, setSummary] = useState<OperationSummary>(emptySummary);
  const [connected, setConnected] = useState(true);
  const [version, setVersion] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dateScope, setDateScope] = useState<DateScope>({ range: "Tümü", start: "", end: "" });
  const toastId = useRef(1);
  const changeRefreshTimer = useRef<number | null>(null);
  const refreshSequence = useRef(0);
  const inFlightRefresh = useRef<{ key: string; promise: Promise<boolean> } | null>(null);

  const refresh = useCallback((): Promise<boolean> => {
    const key = `${dateScope.range}\u0000${dateScope.start}\u0000${dateScope.end}`;
    if (inFlightRefresh.current?.key === key) return inFlightRefresh.current.promise;

    const sequence = ++refreshSequence.current;
    const promise = (async () => {
      try {
        const data = await fetchSummary(dateScope);
        if (sequence === refreshSequence.current) {
          setSummary(data);
          setConnected(true);
        }
        return true;
      } catch {
        if (sequence === refreshSequence.current) setConnected(false);
        return false;
      } finally {
        if (inFlightRefresh.current?.key === key) inFlightRefresh.current = null;
      }
    })();
    inFlightRefresh.current = { key, promise };
    return promise;
  }, [dateScope]);

  const bump = useCallback(() => {
    setVersion((v) => v + 1);
    void refresh();
  }, [refresh]);

  const notify = useCallback((text: string, tone: Toast["tone"] = "ok") => {
    const id = toastId.current++;
    setToasts((list) => [...list, { id, text, tone }]);
    window.setTimeout(() => {
      setToasts((list) => list.filter((t) => t.id !== id));
    }, 3200);
  }, []);

  useEffect(() => {
    void refresh();
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const refreshWhenChanged = () => {
      if (changeRefreshTimer.current !== null) window.clearTimeout(changeRefreshTimer.current);
      changeRefreshTimer.current = window.setTimeout(() => {
        changeRefreshTimer.current = null;
        void refresh();
      }, 180);
    };
    window.addEventListener("focus", refreshWhenVisible);
    window.addEventListener("excelbase:vault-change", refreshWhenChanged);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("focus", refreshWhenVisible);
      window.removeEventListener("excelbase:vault-change", refreshWhenChanged);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      if (changeRefreshTimer.current !== null) window.clearTimeout(changeRefreshTimer.current);
    };
  }, [refresh]);

  const value = useMemo(
    () => ({ summary, connected, version, refresh, bump, notify, toasts, dateScope, setDateScope }),
    [summary, connected, version, refresh, bump, notify, toasts, dateScope],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}

export function formatAmount(value: number): string {
  if (!value) return "0";
  return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 }).format(value);
}
