"use client";

import { ReactNode, useState } from "react";
import type { DateScope } from "@/lib/api";
import { downloadLocal, type LocalDownloadKind } from "@/lib/offline/downloads";
import { useStore } from "@/lib/store";

export function LocalDownloadButton({
  kind,
  scope,
  ids,
  className,
  children,
}: {
  kind: LocalDownloadKind;
  scope?: DateScope;
  ids?: number[];
  className?: string;
  children: ReactNode;
}) {
  const { notify } = useStore();
  const [busy, setBusy] = useState(false);

  async function handleDownload() {
    setBusy(true);
    try {
      await downloadLocal(kind, { scope, ids });
    } catch (error) {
      notify(error instanceof Error ? error.message : "Dosya hazırlanamadı.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button className={className} disabled={busy} onClick={() => void handleDownload()} type="button">
      {busy ? "Hazırlanıyor…" : children}
    </button>
  );
}
