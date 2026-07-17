"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_CATEGORY_LABELS,
  DocumentCategory,
  ManualPassengerInput,
  addPassengerDocuments,
  createPassengerRecord,
  fetchPassengers,
  setPassengerPhoto,
  updatePassenger,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useStore } from "@/lib/store";

type FormKey = Exclude<keyof ManualPassengerInput, "created_by" | "save_as_draft">;

type StagedDocument = {
  id: string;
  file: File;
  category: DocumentCategory;
};

const MAX_PHOTO_BYTES = 25 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

function localDate(date = new Date()): string {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part, index) => String(part).padStart(index === 0 ? 4 : 2, "0"))
    .join("-");
}

function emptyForm(): Record<FormKey, string> {
  return {
    no: "",
    first_name: "",
    last_name: "",
    passport_no: "",
    voucher: "",
    departure_date: "",
    arrival_date: "",
    adult_fee: "",
    child_fee: "",
    record_date: localDate(),
  };
}

function documentId(file: File, index: number): string {
  return `${file.name}-${file.size}-${file.lastModified}-${Date.now()}-${index}`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024 ** 2) return `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
  return `${(bytes / 1024 ** 2).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} MB`;
}

function completeRecordError(
  form: Record<FormKey, string>,
  photo: File | null,
  documents: StagedDocument[],
): string {
  if (!form.first_name.trim() || !form.last_name.trim()) return "Ad ve soyad alanlarını doldurun.";
  if (!form.passport_no.trim()) return "Pasaport numarasını girin.";
  if (!form.voucher.trim()) return "Rezervasyon / voucher numarasını girin.";
  if (!form.departure_date || !form.arrival_date) return "Gidiş ve varış tarihlerini seçin.";
  if (form.arrival_date < form.departure_date) return "Varış tarihi gidiş tarihinden önce olamaz.";
  if (!form.adult_fee.trim() && !form.child_fee.trim()) return "Yetişkin veya çocuk ücretini girin.";
  if (!photo) return "JPG biyometrik fotoğrafı ekleyin.";
  if (!documents.some((item) => item.category === "passport")) return "Pasaport PDF evrakını ekleyin.";
  if (!documents.some((item) => item.category === "application_form")) return "Başvuru formu PDF evrakını ekleyin.";
  return "";
}

export function PassengerRecordForm({
  onCancel,
  onSaved,
}: {
  onCancel: () => void;
  onSaved: (passengerId: number) => void;
}) {
  const { user } = useAuth();
  const { notify, bump } = useStore();
  const [form, setForm] = useState<Record<FormKey, string>>(emptyForm);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState("");
  const [documents, setDocuments] = useState<StagedDocument[]>([]);
  const [saving, setSaving] = useState<"draft" | "complete" | "">("");
  const [formError, setFormError] = useState("");

  const dirty = useMemo(
    () => Object.entries(form).some(([key, value]) => key !== "record_date" && value.trim()) || Boolean(photo) || documents.length > 0,
    [documents.length, form, photo],
  );

  useEffect(() => {
    if (!photo) {
      setPhotoPreview("");
      return;
    }
    const url = URL.createObjectURL(photo);
    setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  function setValue(key: FormKey, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
    if (formError) setFormError("");
  }

  function cancel() {
    if (dirty && !window.confirm("Kaydedilmemiş yolcu bilgileri silinsin mi?")) return;
    onCancel();
  }

  function handlePhoto(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0] ?? null;
    input.value = "";
    if (!file) return;
    if (!/\.jpe?g$/i.test(file.name) || (file.type && !/^image\/jpe?g$/i.test(file.type))) {
      setFormError("Biyometrik fotoğraf yalnızca JPG/JPEG formatında olabilir.");
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      setFormError("Biyometrik fotoğraf 25 MB sınırını aşıyor.");
      return;
    }
    setPhoto(file);
    setFormError("");
  }

  function handleDocuments(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const files = Array.from(input.files ?? []);
    input.value = "";
    if (!files.length) return;
    const invalid = files.find((file) => (
      !/\.pdf$/i.test(file.name)
      || Boolean(file.type && file.type !== "application/pdf" && file.type !== "application/octet-stream")
      || file.size > MAX_DOCUMENT_BYTES
    ));
    if (invalid) {
      setFormError(`${invalid.name}: yalnızca 25 MB altındaki PDF evraklar kabul edilir.`);
      return;
    }
    setDocuments((current) => [
      ...current,
      ...files.map((file, index) => ({ id: documentId(file, index), file, category: "other" as const })),
    ]);
    setFormError("");
  }

  function setDocumentCategory(id: string, category: DocumentCategory) {
    setDocuments((current) => current.map((item) => (item.id === id ? { ...item, category } : item)));
  }

  async function save(asDraft: boolean) {
    if (saving) return;
    const validation = asDraft ? "" : completeRecordError(form, photo, documents);
    if (validation) {
      setFormError(validation);
      return;
    }
    if (!form.record_date) {
      setFormError("Kayıt tarihini seçin.");
      return;
    }
    if (form.departure_date && form.arrival_date && form.arrival_date < form.departure_date) {
      setFormError("Varış tarihi gidiş tarihinden önce olamaz.");
      return;
    }

    setSaving(asDraft ? "draft" : "complete");
    setFormError("");
    let passengerId: number | null = null;
    try {
      if (form.passport_no.trim() && form.departure_date) {
        const possibleDuplicates = await fetchPassengers({ search: form.passport_no.trim() });
        const duplicate = possibleDuplicates.find((item) => (
          item.passport_no.toLocaleUpperCase("tr-TR") === form.passport_no.trim().toLocaleUpperCase("tr-TR")
          && item.departure_date === form.departure_date
        ));
        if (duplicate && !window.confirm(
          `${duplicate.full_name || duplicate.passport_no} için aynı pasaport ve sefer tarihli kayıt zaten var. Yine de yeni kayıt açılsın mı?`,
        )) return;
      }
      const passenger = await createPassengerRecord({
        ...form,
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        passport_no: form.passport_no.trim().toLocaleUpperCase("tr-TR"),
        voucher: form.voucher.trim().toLocaleUpperCase("tr-TR"),
        created_by: user.name,
        save_as_draft: asDraft,
      });
      passengerId = passenger.id;

      if (photo) await setPassengerPhoto(passenger.id, photo);
      for (const category of DOCUMENT_CATEGORIES) {
        const files = documents.filter((item) => item.category === category).map((item) => item.file);
        if (files.length) await addPassengerDocuments(passenger.id, files, category);
      }

      bump();
      notify(asDraft ? "Yolcu kaydı taslak olarak oluşturuldu" : "Yolcu kaydı ve evrakları oluşturuldu");
      onSaved(passenger.id);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Yolcu kaydı oluşturulamadı.";
      if (passengerId !== null) {
        try {
          await updatePassenger(passengerId, { record_status: "draft" });
        } catch {
          // The record itself is already durable; the original attachment error remains actionable.
        }
        setFormError(`Yolcu kaydı açıldı ancak eklerden biri yüklenemedi: ${detail}. Kayıt yolcular ekranında taslak olarak duruyor.`);
        bump();
      } else {
        setFormError(detail);
      }
    } finally {
      setSaving("");
    }
  }

  return (
    <div className="ic-record-form">
      <section className="ic-record-intro">
        <div>
          <p className="ic-record-eyebrow">YENİ YOLCU DOSYASI</p>
          <h2>Tek kayıtta bilgi ve evrak</h2>
          <p>Excel şablonundaki alanları doldurun; JPG fotoğraf ve PDF evrakları aynı yolcu klasörüne bağlayın.</p>
        </div>
        <div className="ic-record-date-seal">
          <span>KAYIT TARİHİ</span>
          <strong>{form.record_date || "—"}</strong>
          <small>{user.name}</small>
        </div>
      </section>

      {formError && <div className="ic-record-error" role="alert">{formError}</div>}

      <section className="ic-form-section">
        <div className="ic-form-section-head">
          <span>01</span>
          <div><h3>Kayıt bilgisi</h3><p>Dosyanın hangi günlük klasörde tutulacağını belirler.</p></div>
        </div>
        <label className="ic-form-field full">
          <span>Kayıt tarihi</span>
          <input type="date" value={form.record_date} onChange={(event) => setValue("record_date", event.target.value)} />
        </label>
      </section>

      <section className="ic-form-section">
        <div className="ic-form-section-head">
          <span>02</span>
          <div><h3>Yolcu ve rezervasyon</h3><p>İDO Gate Visa yolcu listesi alanları.</p></div>
        </div>
        <div className="ic-form-grid">
          <label className="ic-form-field compact"><span>No</span><input inputMode="numeric" value={form.no} onChange={(event) => setValue("no", event.target.value)} placeholder="Otomatik / isteğe bağlı" /></label>
          <label className="ic-form-field"><span>Ad</span><input autoCapitalize="words" value={form.first_name} onChange={(event) => setValue("first_name", event.target.value)} placeholder="Yolcunun adı" /></label>
          <label className="ic-form-field"><span>Soyad</span><input autoCapitalize="characters" value={form.last_name} onChange={(event) => setValue("last_name", event.target.value)} placeholder="Yolcunun soyadı" /></label>
          <label className="ic-form-field"><span>Pasaport No</span><input autoCapitalize="characters" autoCorrect="off" value={form.passport_no} onChange={(event) => setValue("passport_no", event.target.value.toLocaleUpperCase("tr-TR"))} placeholder="U12345678" /></label>
          <label className="ic-form-field"><span>Rezervasyon / Voucher</span><input autoCapitalize="characters" autoCorrect="off" value={form.voucher} onChange={(event) => setValue("voucher", event.target.value.toLocaleUpperCase("tr-TR"))} placeholder="Rezervasyon numarası" /></label>
        </div>
      </section>

      <section className="ic-form-section">
        <div className="ic-form-section-head">
          <span>03</span>
          <div><h3>Sefer ve ücret</h3><p>Kayıt tarihi ile sefer tarihi birbirinden bağımsızdır.</p></div>
        </div>
        <div className="ic-form-grid two">
          <label className="ic-form-field"><span>Gidiş tarihi</span><input type="date" value={form.departure_date} max={form.arrival_date || undefined} onChange={(event) => setValue("departure_date", event.target.value)} /></label>
          <label className="ic-form-field"><span>Varış tarihi</span><input type="date" value={form.arrival_date} min={form.departure_date || undefined} onChange={(event) => setValue("arrival_date", event.target.value)} /></label>
          <label className="ic-form-field"><span>Vize ücreti · Yetişkin</span><input inputMode="decimal" value={form.adult_fee} onChange={(event) => setValue("adult_fee", event.target.value)} placeholder="0,00" /></label>
          <label className="ic-form-field"><span>Vize ücreti · Çocuk</span><input inputMode="decimal" value={form.child_fee} onChange={(event) => setValue("child_fee", event.target.value)} placeholder="0,00" /></label>
        </div>
      </section>

      <section className="ic-form-section">
        <div className="ic-form-section-head">
          <span>04</span>
          <div><h3>Biyometrik fotoğraf</h3><p>Tek bir gerçek JPG/JPEG dosyası, en fazla 25 MB.</p></div>
        </div>
        <div className="ic-record-photo">
          <div className="ic-record-photo-preview">
            {photoPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photoPreview} alt="Seçilen biyometrik fotoğraf" />
            ) : <span>JPG</span>}
          </div>
          <div className="ic-record-photo-copy">
            <strong>{photo?.name ?? "Fotoğraf seçilmedi"}</strong>
            <small>{photo ? formatSize(photo.size) : "Yolcunun biyometrik fotoğrafını ekleyin"}</small>
            <div className="ic-record-file-actions">
              <label className="ic-record-file-button primary">{photo ? "JPG DEĞİŞTİR" : "JPG SEÇ"}<input type="file" accept=".jpg,.jpeg,image/jpeg" onChange={handlePhoto} /></label>
              {photo && <button type="button" onClick={() => setPhoto(null)}>Kaldır</button>}
            </div>
          </div>
        </div>
      </section>

      <section className="ic-form-section">
        <div className="ic-form-section-head">
          <span>05</span>
          <div><h3>PDF evraklar</h3><p>Çoklu seçim yapın ve her evraka doğru belge türünü atayın.</p></div>
          <span className="ic-record-count">{documents.length}</span>
        </div>

        <label className="ic-record-pdf-drop">
          <span className="ic-filetype pdf">PDF</span>
          <span><strong>PDF evrak seç</strong><small>Bir veya birden fazla dosya seçebilirsiniz</small></span>
          <input type="file" accept=".pdf,application/pdf" multiple onChange={handleDocuments} />
        </label>

        {documents.length > 0 && (
          <div className="ic-record-document-list">
            {documents.map((item) => (
              <article className="ic-record-document" key={item.id}>
                <div className="ic-record-document-copy">
                  <strong title={item.file.name}>{item.file.name}</strong>
                  <small>{formatSize(item.file.size)}</small>
                </div>
                <label>
                  <span>Evrak türü</span>
                  <select value={item.category} onChange={(event) => setDocumentCategory(item.id, event.target.value as DocumentCategory)}>
                    {DOCUMENT_CATEGORIES.map((category) => <option value={category} key={category}>{DOCUMENT_CATEGORY_LABELS[category]}</option>)}
                  </select>
                </label>
                <button type="button" aria-label={`${item.file.name} evrakını kaldır`} onClick={() => setDocuments((current) => current.filter((document) => document.id !== item.id))}>KALDIR</button>
              </article>
            ))}
          </div>
        )}
      </section>

      <div className="ic-record-savebar">
        <button className="secondary" type="button" disabled={Boolean(saving)} onClick={() => void save(true)}>
          {saving === "draft" ? "KAYDEDİLİYOR…" : "TASLAK KAYDET"}
        </button>
        <button className="primary" type="button" disabled={Boolean(saving)} onClick={() => void save(false)}>
          {saving === "complete" ? "OLUŞTURULUYOR…" : "TAMAMLA VE KAYDET"}
        </button>
        <button className="cancel" type="button" disabled={Boolean(saving)} onClick={cancel}>VAZGEÇ</button>
      </div>
    </div>
  );
}
