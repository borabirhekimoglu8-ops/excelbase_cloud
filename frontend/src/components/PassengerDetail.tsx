"use client";

import { ChangeEvent, useEffect, useState } from "react";
import {
  Passenger,
  PassengerDocument,
  addPassengerDocuments,
  deletePassenger,
  deletePassengerDocument,
  downloadPassengerDocument,
  fetchPassengers,
  openPassengerDocument,
  removePassengerPhoto,
  setPassengerPhoto,
  updatePassenger,
} from "@/lib/api";
import { useStore } from "@/lib/store";
import { useAuth } from "@/lib/auth";
import { PassengerPhoto, passengerStatusTone } from "@/components/PassengerCard";
import { AppHeaderScreen } from "@/components/ido/AppHeader";

const FIELDS: { key: keyof Passenger; label: string; type?: string }[] = [
  { key: "no", label: "No" },
  { key: "first_name", label: "Ad" },
  { key: "last_name", label: "Soyad" },
  { key: "passport_no", label: "Pasaport No" },
  { key: "voucher", label: "Rezervasyon / Voucher" },
  { key: "departure_date", label: "Sefer Tarihi (Gidiş)" },
  { key: "arrival_date", label: "Varış Tarihi" },
  { key: "adult_fee", label: "Vize Ücreti Yetişkin" },
  { key: "child_fee", label: "Vize Ücreti Çocuk" },
];

function formatDocumentSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / 1024 ** 2).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} MB`;
}

function formatDocumentDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Eklenme tarihi bilinmiyor";
  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

function releaseObjectUrl(url: string) {
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function PassengerDetail({ id, onClose }: { id: number; onClose: () => void }) {
  const { notify, bump } = useStore();
  const { user } = useAuth();
  const canWrite = user.role !== "viewer";
  const [passenger, setPassenger] = useState<Passenger | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [documentsBusy, setDocumentsBusy] = useState(false);
  const [documentAction, setDocumentAction] = useState("");

  async function refreshPassenger() {
    const list = await fetchPassengers();
    setPassenger(list.find((p) => p.id === id) ?? null);
  }

  useEffect(() => {
    let active = true;
    // Detay tek yolcu endpoint'i yerine mevcut listeden çekilir.
    fetchPassengers().then((list) => {
      if (!active) return;
      const found = list.find((p) => p.id === id) ?? null;
      setPassenger(found);
      if (found) {
        setForm({
          no: found.no,
          first_name: found.first_name,
          last_name: found.last_name,
          passport_no: found.passport_no,
          voucher: found.voucher,
          departure_date: found.departure_date,
          arrival_date: found.arrival_date,
          adult_fee: found.adult_fee,
          child_fee: found.child_fee,
        });
      }
    });
    return () => {
      active = false;
    };
  }, [id]);

  if (!passenger) {
    return (
      <div className="sheet-overlay" onClick={onClose}>
        <div className="sheet ido-sheet" onClick={(e) => e.stopPropagation()}>
          <AppHeaderScreen title="Yolcu Detayı" onBack={onClose} />
          <div className="ido-content">
            <p className="muted">Yükleniyor…</p>
          </div>
        </div>
      </div>
    );
  }

  async function handleSave() {
    setSaving(true);
    try {
      await updatePassenger(id, form as Partial<Passenger>);
      notify("Yolcu güncellendi");
      bump();
      onClose();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Kaydedilemedi", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm("Bu yolcuyu silmek istediğinize emin misiniz?")) return;
    setBusy(true);
    try {
      await deletePassenger(id);
      notify("Yolcu silindi", "warn");
      bump();
      onClose();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Silinemedi", "error");
    } finally {
      setBusy(false);
    }
  }

  async function handlePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const extensionIsJpeg = /\.jpe?g$/i.test(file.name);
    const mimeIsJpeg = !file.type || file.type === "image/jpeg" || file.type === "image/jpg";
    if (!extensionIsJpeg || !mimeIsJpeg) {
      notify("Biyometrik fotoğraf yalnızca JPG/JPEG formatında yüklenebilir.", "error");
      event.target.value = "";
      return;
    }
    setBusy(true);
    try {
      await setPassengerPhoto(id, file);
      notify("JPG biyometrik fotoğraf güncellendi");
      bump();
      await refreshPassenger();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Fotoğraf yüklenemedi", "error");
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  }

  async function handlePhotoRemove() {
    setBusy(true);
    try {
      await removePassengerPhoto(id);
      notify("Fotoğraf silindi", "warn");
      bump();
      await refreshPassenger();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Silinemedi", "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleDocuments(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) return;
    setDocumentsBusy(true);
    try {
      await addPassengerDocuments(id, files);
      notify(`${files.length} PDF evrak yolcuya eklendi`);
      bump();
      await refreshPassenger();
    } catch (err) {
      notify(err instanceof Error ? err.message : "PDF evraklar yüklenemedi", "error");
    } finally {
      setDocumentsBusy(false);
      event.target.value = "";
    }
  }

  async function handleDocumentOpen(document: PassengerDocument) {
    setDocumentAction(`${document.id}:open`);
    try {
      const file = await openPassengerDocument(id, document.id);
      const url = URL.createObjectURL(file.blob);
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      window.document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      releaseObjectUrl(url);
    } catch (err) {
      notify(err instanceof Error ? err.message : "PDF evrak açılamadı", "error");
    } finally {
      setDocumentAction("");
    }
  }

  async function handleDocumentDownload(document: PassengerDocument) {
    setDocumentAction(`${document.id}:download`);
    try {
      await downloadPassengerDocument(id, document.id);
    } catch (err) {
      notify(err instanceof Error ? err.message : "PDF evrak indirilemedi", "error");
    } finally {
      setDocumentAction("");
    }
  }

  async function handleDocumentDelete(document: PassengerDocument) {
    if (!window.confirm(`“${document.filename}” evrakını silmek istediğinize emin misiniz?`)) return;
    setDocumentAction(`${document.id}:delete`);
    try {
      await deletePassengerDocument(id, document.id);
      notify("PDF evrak silindi", "warn");
      bump();
      await refreshPassenger();
    } catch (err) {
      notify(err instanceof Error ? err.message : "PDF evrak silinemedi", "error");
    } finally {
      setDocumentAction("");
    }
  }

  const { tone, label } = passengerStatusTone(passenger);
  const hasIssues = passenger.issues.length > 0;
  const documents = passenger.documents ?? [];

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet ido-sheet" onClick={(e) => e.stopPropagation()}>
        <AppHeaderScreen
          title="Yolcu Detayı"
          onBack={onClose}
          action={
            canWrite ? (
              <button className="ido-header-action" onClick={handleDelete} disabled={busy} type="button">
                SİL
              </button>
            ) : undefined
          }
        />
        <div className="ido-content has-sticky">
          <div className="ic-profile">
            <div className="ic-profile-id">
              <div className="ic-profile-photo">
                <PassengerPhoto passenger={passenger} />
              </div>
              <div className="ic-profile-copy">
                <p className="ic-profile-name">{passenger.full_name || "İsimsiz yolcu"}</p>
                <p className="ic-profile-meta">{passenger.passport_no || "Pasaport yok"}</p>
                {(passenger.departure_date || passenger.voucher) && (
                  <p className="ic-profile-meta sm">
                    {[passenger.voucher, passenger.departure_date && `Sefer ${passenger.departure_date}`]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                )}
              </div>
            </div>
            <span className={`ic-pill ic-pill-${tone}`}>{label === "HAZIR" ? "DOSYA HAZIR" : label}</span>
          </div>

          <div className={`ic-verify${hasIssues ? " warn" : ""}`} style={hasIssues ? { background: "var(--ido-amber-tint)", color: "var(--ido-amber)" } : undefined}>
            <span>
              {hasIssues
                ? `${passenger.issues.length} zorunlu alan/belge eksik`
                : "Zorunlu alan ve belgeler doğrulandı"}
            </span>
            <span>{hasIssues ? "!" : "✓"}</span>
          </div>

          <section className="ic-document-quick" aria-label="PDF evrak yükleme alanı">
            <div className="ic-document-quick-copy">
              <span className="ic-filetype pdf">PDF</span>
              <div>
                <p>PDF Evrak Yükleme</p>
                <span>{documents.length ? `${documents.length} evrak kayıtlı · yeni evrak ekleyebilirsiniz` : "Bir veya birden fazla PDF dosyası seçin"}</span>
              </div>
            </div>
            {canWrite ? (
              <label className={`ic-document-quick-action${documentsBusy ? " disabled" : ""}`}>
                {documentsBusy ? "EKLENİYOR…" : "PDF SEÇ"}
                <input
                  type="file"
                  accept=".pdf,application/pdf"
                  aria-label="Yolcu PDF evraklarını hızlı yükle"
                  multiple
                  onChange={handleDocuments}
                  disabled={documentsBusy || busy}
                />
              </label>
            ) : (
              <span className="ic-pill ic-pill-neutral">SADECE GÖRÜNTÜLEME</span>
            )}
          </section>

          <div className="ic-detail-block">
            <p className="ic-detail-title">Kimlik / Sefer Bilgileri</p>
            {FIELDS.map((field) => (
              <div className="ic-detail-line editable" key={field.key}>
                <span>{field.label}</span>
                <input
                  type={field.type ?? "text"}
                  value={form[field.key] ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, [field.key]: e.target.value }))}
                  disabled={!canWrite}
                />
              </div>
            ))}
            <div className="ic-detail-line">
              <span>Kaynak Dosya</span>
              <span>{passenger.source_file || "—"}</span>
            </div>
          </div>

          <div className="ic-section-head">
            <p className="ic-section-title">JPG Biyometrik Fotoğraf</p>
            <span className={passenger.photo ? "ic-pill ic-pill-ok" : "ic-pill ic-pill-bad"}>
              {passenger.photo ? "1 / 1 MEVCUT" : "0 / 1 EKSİK"}
            </span>
          </div>
          <div className="ic-row compact">
            <div className="ic-row-id">
              <span className="ic-filetype pdf">FOTO</span>
              <div className="ic-row-copy">
                <p className="ic-row-title">{passenger.photo ? "JPG biyometrik fotoğraf" : "JPG fotoğraf yüklenmedi"}</p>
                <p className="ic-row-meta">{passenger.photo ? "Yolcu profilinde kullanılıyor" : "Yalnızca .jpg veya .jpeg kabul edilir"}</p>
              </div>
            </div>
            {canWrite && (
              <div style={{ display: "flex", gap: 8, flex: "0 0 auto" }}>
                <label className="ic-pill ic-pill-info" style={{ cursor: "pointer" }}>
                  {passenger.photo ? "JPG DEĞİŞTİR" : "JPG EKLE"}
                  <input
                    type="file"
                    accept=".jpg,.jpeg,image/jpeg"
                    aria-label="JPG biyometrik fotoğraf seç"
                    onChange={handlePhoto}
                    disabled={busy}
                    style={{ display: "none" }}
                  />
                </label>
                {passenger.photo && (
                  <button
                    className="ic-pill ic-pill-bad"
                    style={{ border: 0, cursor: "pointer" }}
                    onClick={handlePhotoRemove}
                    disabled={busy}
                    type="button"
                  >
                    SİL
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="ic-section-head ic-document-heading">
            <div>
              <p className="ic-section-title">PDF Evraklar</p>
              <p className="ic-section-caption">Yolcuya ait başvuru evrakları şifreli cihaz kasasında saklanır.</p>
            </div>
            <span className={documents.length ? "ic-pill ic-pill-ok" : "ic-pill ic-pill-neutral"}>
              {documents.length} EVRAK
            </span>
          </div>

          {documents.length ? (
            <div className="ic-document-list" aria-label="Yolcu PDF evrakları">
              {documents.map((document) => (
                <div className="ic-row compact ic-document-row" key={document.id}>
                  <div className="ic-row-id">
                    <span className="ic-filetype pdf">PDF</span>
                    <div className="ic-row-copy">
                      <p className="ic-row-title" title={document.filename}>{document.filename}</p>
                      <p className="ic-row-meta">
                        {formatDocumentSize(document.size)} · {formatDocumentDate(document.created_at)}
                      </p>
                    </div>
                  </div>
                  <div className="ic-document-actions">
                    <button
                      className="ic-pill ic-pill-info"
                      type="button"
                      onClick={() => void handleDocumentOpen(document)}
                      disabled={Boolean(documentAction)}
                      aria-label={`${document.filename} PDF evrakını görüntüle`}
                    >
                      {documentAction === `${document.id}:open` ? "AÇILIYOR…" : "GÖRÜNTÜLE"}
                    </button>
                    <button
                      className="ic-pill ic-pill-neutral"
                      type="button"
                      onClick={() => void handleDocumentDownload(document)}
                      disabled={Boolean(documentAction)}
                      aria-label={`${document.filename} PDF evrakını indir`}
                    >
                      {documentAction === `${document.id}:download` ? "İNDİRİLİYOR…" : "İNDİR"}
                    </button>
                    {canWrite ? (
                      <button
                        className="ic-pill ic-pill-bad"
                        type="button"
                        onClick={() => void handleDocumentDelete(document)}
                        disabled={Boolean(documentAction)}
                        aria-label={`${document.filename} PDF evrakını sil`}
                      >
                        {documentAction === `${document.id}:delete` ? "SİLİNİYOR…" : "SİL"}
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="ic-empty-document">
              <span className="ic-filetype pdf">PDF</span>
              <div>
                <p>Henüz PDF evrak eklenmedi</p>
                <span>Bir veya birden fazla PDF dosyasını aynı anda seçebilirsiniz.</span>
              </div>
            </div>
          )}

          {canWrite ? (
            <label className={`ic-btn-outline ic-document-upload${documentsBusy ? " disabled" : ""}`}>
              {documentsBusy ? "PDF EVRAKLAR EKLENİYOR…" : "PDF EVRAK EKLE"}
              <input
                type="file"
                accept=".pdf,application/pdf"
                aria-label="Yolcu PDF evraklarını seç"
                multiple
                onChange={handleDocuments}
                disabled={documentsBusy || busy}
              />
            </label>
          ) : null}
        </div>

        {canWrite && (
          <div className="ic-sticky">
            <button className="ic-btn-primary" onClick={handleSave} disabled={saving || busy} type="button">
              {saving ? "KAYDEDİLİYOR…" : "DEĞİŞİKLİKLERİ KAYDET"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
