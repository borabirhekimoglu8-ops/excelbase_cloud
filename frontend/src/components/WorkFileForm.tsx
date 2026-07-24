"use client";

import { FormEvent, useMemo, useState } from "react";
import { createWorkFile } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useStore } from "@/lib/store";
import type { WorkFileInput, WorkFilePriority, WorkFileStatus } from "@/lib/workspace";

function todayIso(): string {
  const date = new Date();
  return [
    String(date.getFullYear()).padStart(4, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function splitTags(value: string): string[] {
  return value
    .split(/[,;\n]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function WorkFileForm({
  onCancel,
  onSaved,
}: {
  onCancel: () => void;
  onSaved: (id: string) => void;
}) {
  const { user } = useAuth();
  const { bump, notify } = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<WorkFileStatus>("open");
  const [priority, setPriority] = useState<WorkFilePriority>("normal");
  const defaultDate = useMemo(todayIso, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const input: WorkFileInput = {
      file_no: String(data.get("file_no") ?? ""),
      title: String(data.get("title") ?? ""),
      category: String(data.get("category") ?? ""),
      company: String(data.get("company") ?? ""),
      route: String(data.get("route") ?? ""),
      status,
      priority,
      owner: String(data.get("owner") ?? user.name),
      description: String(data.get("description") ?? ""),
      start_date: String(data.get("start_date") ?? ""),
      due_date: String(data.get("due_date") ?? ""),
      tags: splitTags(String(data.get("tags") ?? "")),
    };

    setBusy(true);
    setError("");
    try {
      const created = await createWorkFile(input);
      bump();
      notify(`${created.file_no || created.title} iş dosyası oluşturuldu.`);
      onSaved(created.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "İş dosyası oluşturulamadı.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="ops-form" onSubmit={submit}>
      <section className="ops-detail-hero">
        <div>
          <p className="ops-work-code">YENİ OPERASYON KAYDI</p>
          <h1>İş dosyasını açın</h1>
          <p>C kodu, firma, hat, görev ve evraklar bu dosyada birlikte takip edilir.</p>
        </div>
      </section>

      {error && <div className="ops-form-error" role="alert">{error}</div>}

      <section className="ops-form-section">
        <h2>Dosya kimliği</h2>
        <p>Kurum içinde dosyayı bulacağınız temel bilgiler.</p>
        <div className="ops-form-grid">
          <label className="ops-field">
            <span>C kodu / Dosya no</span>
            <input name="file_no" aria-label="C kodu" placeholder="C-2026-001" autoCapitalize="characters" />
          </label>
          <label className="ops-field">
            <span>İş türü</span>
            <select name="category" defaultValue="Gate Visa">
              <option>Gate Visa</option>
              <option>Feribot Operasyonu</option>
              <option>Resmi Yazışma</option>
              <option>Satış ve Raporlama</option>
              <option>Finans</option>
              <option>Genel Operasyon</option>
            </select>
          </label>
          <label className="ops-field full">
            <span>Dosya başlığı</span>
            <input name="title" required placeholder="Örn. 28 Temmuz Samos kapı vizesi operasyonu" />
          </label>
          <label className="ops-field">
            <span>Firma / Muhatap</span>
            <input name="company" placeholder="İDO, acente veya kurum" />
          </label>
          <label className="ops-field">
            <span>Hat / Güzergâh</span>
            <input name="route" placeholder="Kuşadası – Samos" />
          </label>
        </div>
      </section>

      <section className="ops-form-section">
        <h2>Takip bilgileri</h2>
        <p>Öncelik ve tarihler ana ekrandaki dikkat sırasını belirler.</p>
        <div className="ops-form-grid">
          <label className="ops-field">
            <span>Durum</span>
            <select value={status} onChange={(event) => setStatus(event.target.value as WorkFileStatus)}>
              <option value="open">Açık</option>
              <option value="waiting">Bekliyor</option>
              <option value="blocked">Engelli / Dikkat</option>
              <option value="done">Tamamlandı</option>
              <option value="archived">Arşiv</option>
            </select>
          </label>
          <label className="ops-field">
            <span>Öncelik</span>
            <select value={priority} onChange={(event) => setPriority(event.target.value as WorkFilePriority)}>
              <option value="low">Düşük</option>
              <option value="normal">Normal</option>
              <option value="high">Yüksek</option>
              <option value="urgent">Acil</option>
            </select>
          </label>
          <label className="ops-field">
            <span>Başlangıç tarihi</span>
            <input name="start_date" type="date" defaultValue={defaultDate} />
          </label>
          <label className="ops-field">
            <span>Son tarih</span>
            <input name="due_date" type="date" />
          </label>
          <label className="ops-field full">
            <span>Sorumlu</span>
            <input name="owner" defaultValue={user.name} />
          </label>
        </div>
      </section>

      <section className="ops-form-section">
        <h2>Notlar ve etiketler</h2>
        <label className="ops-field">
          <span>Açıklama</span>
          <textarea name="description" placeholder="Operasyonun kapsamı, beklenen işlem ve önemli ayrıntılar…" />
        </label>
        <label className="ops-field">
          <span>Etiketler</span>
          <input name="tags" placeholder="samos, kapı vizesi, temmuz" />
        </label>
      </section>

      <div className="ops-form-actions">
        <button className="ops-secondary" type="button" onClick={onCancel} disabled={busy}>VAZGEÇ</button>
        <button className="ops-primary" type="submit" disabled={busy}>
          {busy ? "KAYDEDİLİYOR…" : "İŞ DOSYASINI KAYDET"}
        </button>
      </div>
    </form>
  );
}
