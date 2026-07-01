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
import { PassengerPhoto } from "@/components/PassengerCard";

const FIELDS: { key: keyof Passenger; label: string; mono?: boolean }[] = [
  { key: "no", label: "No" },
  { key: "first_name", label: "Ad" },
  { key: "last_name", label: "Soyad" },
  { key: "passport_no", label: "Pasaport No", mono: true },
  { key: "voucher", label: "Voucher" },
  { key: "departure_date", label: "Gidiş Tarihi" },
  { key: "arrival_date", label: "Varış Tarihi" },
  { key: "adult_fee", label: "Vize Ücreti Yetişkin" },
  { key: "child_fee", label: "Vize Ücreti Çocuk" },
];

export function PassengerDetail({ id, onClose }: { id: number; onClose: () => void }) {
  const { notify, bump } = useStore();
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
        <div className="sheet" onClick={(e) => e.stopPropagation()}>
          <p className="muted">Yükleniyor...</p>
        </div>
      </div>
    );
  }

  const passportClean = form.passport_no?.replace(/[^A-Za-z0-9]/g, "") ?? "";
  const passportHint = !form.passport_no
    ? "⚪ Pasaport boş"
    : passportClean.length < 6
      ? "🔴 Çok kısa"
      : "🟢 Format uygun";

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
      onClose();
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
      onClose();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Silinemedi", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-head">
          <button className="ghost-btn" onClick={onClose}>
            ← Kapat
          </button>
          <span className="eyebrow">Yolcu detayı</span>
        </div>

        <div className="detail-hero">
          <PassengerPhoto passenger={passenger} />
          <div>
            <h2>{passenger.full_name || "Yolcu"}</h2>
            <p className="passport">{passenger.passport_no || "Pasaport yok"}</p>
          </div>
        </div>

        <div className="photo-actions">
          <label className="soft-btn">
            {passenger.photo ? "Fotoğrafı değiştir" : "Fotoğraf ekle"}
            <input type="file" accept="image/*" onChange={handlePhoto} disabled={busy} />
          </label>
          {passenger.photo && (
            <button className="soft-btn danger" onClick={handlePhotoRemove} disabled={busy}>
              Fotoğrafı sil
            </button>
          )}
        </div>

        <div className="detail-form">
          {FIELDS.map((field) => (
            <label key={field.key} className="field">
              <span>{field.label}</span>
              <input
                type="text"
                className={field.mono ? "mono" : ""}
                value={form[field.key] ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, [field.key]: e.target.value }))}
              />
            </label>
          ))}
          <p className="hint">{passportHint}</p>
          <label className="field">
            <span>Kaynak Dosya</span>
            <input type="text" value={passenger.source_file} disabled />
          </label>
        </div>

        <div className="detail-actions">
          <button className="primary-btn" onClick={handleSave} disabled={saving || busy}>
            {saving ? "Kaydediliyor..." : "Kaydet"}
          </button>
          <button className="soft-btn danger" onClick={handleDelete} disabled={busy}>
            Sil
          </button>
        </div>
      </div>
    </div>
  );
}
