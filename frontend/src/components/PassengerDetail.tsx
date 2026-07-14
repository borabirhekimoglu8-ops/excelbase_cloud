"use client";

import { ChangeEvent, useEffect, useState } from "react";
import {
  Passenger,
  deletePassenger,
  fetchPassengers,
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

export function PassengerDetail({ id, onClose }: { id: number; onClose: () => void }) {
  const { notify, bump } = useStore();
  const { user } = useAuth();
  const canWrite = user.role !== "viewer";
  const [passenger, setPassenger] = useState<Passenger | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);

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
    setBusy(true);
    try {
      await setPassengerPhoto(id, file);
      notify("Fotoğraf güncellendi");
      bump();
      const list = await fetchPassengers();
      setPassenger(list.find((p) => p.id === id) ?? null);
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
      const list = await fetchPassengers();
      setPassenger(list.find((p) => p.id === id) ?? null);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Silinemedi", "error");
    } finally {
      setBusy(false);
    }
  }

  const { tone, label } = passengerStatusTone(passenger);
  const hasIssues = passenger.issues.length > 0;

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
            <p className="ic-section-title">Biyometrik Fotoğraf</p>
            <span className={passenger.photo ? "ic-pill ic-pill-ok" : "ic-pill ic-pill-bad"}>
              {passenger.photo ? "1 / 1 MEVCUT" : "0 / 1 EKSİK"}
            </span>
          </div>
          <div className="ic-row compact">
            <div className="ic-row-id">
              <span className="ic-filetype pdf">FOTO</span>
              <div className="ic-row-copy">
                <p className="ic-row-title">{passenger.photo ? "Biyometrik fotoğraf" : "Fotoğraf yüklenmedi"}</p>
                <p className="ic-row-meta">{passenger.photo ? "Yolcu profilinde kullanılıyor" : "Kontrolden önce ekleyin"}</p>
              </div>
            </div>
            {canWrite && (
              <div style={{ display: "flex", gap: 8, flex: "0 0 auto" }}>
                <label className="ic-pill ic-pill-info" style={{ cursor: "pointer" }}>
                  {passenger.photo ? "DEĞİŞTİR" : "EKLE"}
                  <input type="file" accept="image/*" onChange={handlePhoto} disabled={busy} style={{ display: "none" }} />
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
