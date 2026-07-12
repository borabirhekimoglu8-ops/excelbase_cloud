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
};

export type Toast = { id: number; text: string; tone: "ok" | "warn" | "error" };

type StoreValue = {
  summary: OperationSummary;
  connected: boolean;
  version: number;
  refresh: () => Promise<void>;
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

  const refresh = useCallback(async () => {
    try {
      const data = await fetchSummary(dateScope);
      setSummary(data);
      setConnected(true);
    } catch {
      setConnected(false);
    }
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
