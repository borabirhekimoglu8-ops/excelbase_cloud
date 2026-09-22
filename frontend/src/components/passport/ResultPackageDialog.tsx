"use client";

import { ChangeEvent, useState } from "react";

import { saveBlob } from "@/lib/offline/exporter";
import type { PassportCandidate } from "@/lib/passport/candidates";
import { createPackageCode, exportPassportPackage, importPassportPackage } from "@/lib/passport/resultPackage";

export function ResultPackageDialog({
  candidates,
  onImported,
  notify,
}: {
  candidates: PassportCandidate[];
  onImported: () => void;
  notify: (text: string, tone?: "ok" | "warn" | "error") => void;
}) {
  const [code, setCode] = useState("");
  const [shown, setShown] = useState("");
  const [busy, setBusy] = useState(false);

  async function exportPack() {
    setBusy(true);
    try {
      const next = createPackageCode();
      const blob = await exportPassportPackage(candidates, next);
      await saveBlob(blob, "pasaport-sonuc.excelbase-passport");
      setShown(next);
      notify(`${candidates.length} kayıt şifreli pakete alındı.`, "ok");
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "Paket oluşturulamadı.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function onImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!code.trim()) {
      notify("Paket kodunu girin.", "error");
      return;
    }
    setBusy(true);
    try {
      const added = await importPassportPackage(file, code.trim());
      notify(`${added} kayıt içe aktarıldı.`, "ok");
      onImported();
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "Paket açılamadı.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="ops-module-card xb-passport-package">
      <div>
        <p className="ops-eyebrow">Aktarım</p>
        <h2>Şifreli sonuç paketi</h2>
        <p>HTTPS canlı PWA yerel OCR’ye bağlanamaz. Ofis PC’de işleyip paketi buraya alın. Kod ayrı taşınır.</p>
      </div>
      <div className="xb-passport-actions">
        <button type="button" disabled={busy || !candidates.length} onClick={() => void exportPack()}>
          Paket dışa aktar
        </button>
        <label className="xb-package-import">
          <span>Paket içe aktar</span>
          <input type="file" accept=".excelbase-passport,application/json" disabled={busy} onChange={onImport} />
        </label>
      </div>
      <label>
        <span>Paket kodu</span>
        <input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} autoComplete="off" spellCheck={false} />
      </label>
      {shown ? <p className="xb-package-code">Kod (bir kez gösterilir): <code>{shown}</code></p> : null}
    </section>
  );
}
