"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  V8Identity,
  V8Operation,
  V8OperationSummary,
  V8Passenger,
  autoImportV8Excel,
  commitV8Import,
  createV8Passenger,
  deleteV8Passenger,
  deleteV8PassengerPhoto,
  downloadV8Package,
  downloadV8Template,
  exportV8Operation,
  fetchV8Manifest,
  fetchV8PassengerPhoto,
  getV8ApiUrl,
  getV8OperationSummary,
  getV8SetupStatus,
  listV8Operations,
  listV8Passengers,
  matchV8Photos,
  revealV8Passport,
  runV8Setup,
  setV8ApiUrl,
  stageV8Import,
  migrateV7ToV8,
  updateV8Operation,
  updateV8Passenger,
  uploadV8PassengerPhoto,
} from "@/lib/api-v8";
import { downloadUrl } from "@/lib/api";
import styles from "./V8Pilot.module.css";

const EMPTY_IDENTITY: V8Identity = { userId: "", organizationId: "", token: "" };

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Taslak",
  DOCUMENT_COLLECTION: "Evrak toplama",
  PHYSICAL_CONTROL: "Fiziki kontrol",
  READY_FOR_SUBMISSION: "Teslime hazır",
  SUBMITTED: "Teslim edildi",
  APPROVED: "Onaylandı",
  COMPLETED: "Tamamlandı",
  ARCHIVED: "Arşiv",
};

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function V8Pilot() {
  const [identity, setIdentity] = useState<V8Identity>(EMPTY_IDENTITY);
  const [operations, setOperations] = useState<V8Operation[]>([]);
  const [operationTotal, setOperationTotal] = useState(0);
  const [selected, setSelected] = useState<V8Operation | null>(null);
  const [passengers, setPassengers] = useState<V8Passenger[]>([]);
  const [passengerTotal, setPassengerTotal] = useState(0);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("V8 pilot bağlantısı bekleniyor.");
  const [apiUrl, setApiUrl] = useState("");
  const [setupNeeded, setSetupNeeded] = useState(false);
  const [migrationSummary, setMigrationSummary] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sortOrder, setSortOrder] = useState("");
  const [summary, setSummary] = useState<V8OperationSummary | null>(null);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [operationNotes, setOperationNotes] = useState("");
  const [operationDateFrom, setOperationDateFrom] = useState("");
  const [operationDateTo, setOperationDateTo] = useState("");

  const hasIdentity = Boolean(identity.token || (identity.userId && identity.organizationId));
  const operationFilterActive = Boolean(operationDateFrom || operationDateTo);
  const filteredOperations = operations.filter((operation) => {
    const departureDate = operation.departure_date.slice(0, 10);
    return (
      (!operationDateFrom || departureDate >= operationDateFrom) &&
      (!operationDateTo || departureDate <= operationDateTo)
    );
  });

  useEffect(() => {
    setApiUrl(getV8ApiUrl());
    const saved = window.localStorage.getItem("excelbase-v8-identity");
    if (saved) {
      try {
        setIdentity({ ...EMPTY_IDENTITY, ...(JSON.parse(saved) as V8Identity) });
      } catch {
        window.localStorage.removeItem("excelbase-v8-identity");
      }
    }
    getV8SetupStatus()
      .then((status) => setSetupNeeded(status.setup_required))
      .catch(() => setSetupNeeded(false));
  }, []);

  async function completeSetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    try {
      const result = await runV8Setup({
        email: String(form.get("setupEmail") ?? ""),
        display_name: String(form.get("setupName") ?? ""),
      });
      const nextIdentity: V8Identity = {
        userId: result.user_id,
        organizationId: result.organization_id,
        token: result.token,
      };
      setIdentity(nextIdentity);
      window.localStorage.setItem("excelbase-v8-identity", JSON.stringify(nextIdentity));
      setSetupNeeded(false);
      setMessage("Kurulum tamamlandı; hoş geldiniz!");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Kurulum tamamlanamadı.");
    } finally {
      setBusy(false);
    }
  }

  async function migrateFromV7(options: { silent?: boolean } = {}) {
    const { silent = false } = options;
    if (!silent) {
      setBusy(true);
      setMigrationSummary([]);
    }
    try {
      if (!silent) setMessage("V7 verileri okunuyor…");
      const backupResponse = await fetch(downloadUrl("/api/backup"), { cache: "no-store" });
      if (!backupResponse.ok) {
        throw new Error(`V7 yedeği alınamadı (${backupResponse.status}).`);
      }
      const backup = (await backupResponse.json()) as { passengers?: Array<Record<string, unknown>> };
      const records = backup.passengers ?? [];
      if (records.length === 0) {
        if (!silent) setMessage("V7 tarafında taşınacak yolcu bulunamadı.");
        return;
      }
      setMessage(`${records.length} V7 kaydı V8'e taşınıyor…`);
      const report = await migrateV7ToV8(identity, { passengers: records });

      let photosMoved = 0;
      let photosFailed = 0;
      for (const link of report.photo_links) {
        try {
          const photoResponse = await fetch(
            downloadUrl(`/api/photo/${encodeURIComponent(link.photo_ref)}`),
            { cache: "no-store" },
          );
          if (!photoResponse.ok) {
            photosFailed += 1;
            continue;
          }
          const blob = await photoResponse.blob();
          const file = new File([blob], link.photo_ref, { type: blob.type || "image/jpeg" });
          await uploadV8PassengerPhoto(identity, link.passenger_id, file);
          photosMoved += 1;
          setMessage(`Fotoğraflar taşınıyor: ${photosMoved}/${report.photo_links.length}`);
        } catch {
          photosFailed += 1;
        }
      }

      const lines = [
        `${report.created_operations} yeni operasyon oluşturuldu.`,
        `${report.created_passengers} yolcu taşındı; ${report.duplicate_passengers} kayıt zaten V8'de olduğu için atlandı.`,
      ];
      if (report.skipped_without_passport > 0) {
        lines.push(`${report.skipped_without_passport} kayıt pasaport numarası olmadığı için taşınamadı.`);
      }
      if (report.invalid_passports > 0) {
        lines.push(`${report.invalid_passports} kayıt geçersiz pasaport numarası nedeniyle taşınamadı.`);
      }
      if (report.photo_links.length > 0) {
        lines.push(
          `${photosMoved} fotoğraf taşındı${photosFailed > 0 ? `, ${photosFailed} fotoğraf taşınamadı` : ""}.`,
        );
      }
      setMigrationSummary(lines);
      setMessage("V7 taşıması tamamlandı.");
      await refreshOperations();
    } catch (error) {
      if (!silent) setMessage(error instanceof Error ? error.message : "V7 taşıması başarısız.");
    } finally {
      if (!silent) setBusy(false);
    }
  }

  // Sayfa açıldığında V7 tarafında veri varsa kullanıcıdan tuş beklemeden
  // V8'e taşınır; işlem idempotent olduğundan her açılışta güvenle denenir.
  const autoSyncStarted = useRef(false);
  useEffect(() => {
    if (!hasIdentity || setupNeeded || autoSyncStarted.current) return;
    autoSyncStarted.current = true;
    void migrateFromV7({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasIdentity, setupNeeded]);

  async function importExcelFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;
    setBusy(true);
    setMigrationSummary([]);
    try {
      let operationsCreated = 0;
      let passengersCreated = 0;
      let duplicates = 0;
      const problems: string[] = [];
      for (const [index, file] of files.entries()) {
        setMessage(`Excel işleniyor (${index + 1}/${files.length}): ${file.name}`);
        try {
          const report = await autoImportV8Excel(identity, file);
          operationsCreated += report.created_operations;
          passengersCreated += report.created_passengers;
          duplicates += report.duplicate_passengers;
          if (report.skipped_without_passport > 0 || report.invalid_passports > 0) {
            problems.push(
              `${file.name}: ${report.skipped_without_passport + report.invalid_passports} satır pasaport sorunu nedeniyle atlandı.`,
            );
          }
        } catch (error) {
          problems.push(`${file.name}: ${error instanceof Error ? error.message : "işlenemedi"}`);
        }
      }
      const lines = [
        `${passengersCreated} yolcu eklendi, ${operationsCreated} operasyon oluşturuldu.`,
      ];
      if (duplicates > 0) lines.push(`${duplicates} kayıt zaten var olduğu için atlandı.`);
      lines.push(...problems);
      setMigrationSummary(lines);
      setMessage("Excel içe aktarma tamamlandı.");
      await refreshOperations();
    } finally {
      setBusy(false);
    }
  }

  async function bulkUploadPhotos(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;
    setBusy(true);
    setMigrationSummary([]);
    try {
      setMessage(`${files.length} fotoğraf eşleştiriliyor…`);
      const report = await matchV8Photos(identity, files);
      const lines = [`${report.matched} fotoğraf yolcularla eşleşti ve kaydedildi.`];
      if (report.unmatched.length > 0) {
        lines.push(`Eşleşmeyenler: ${report.unmatched.join(", ")}`);
      }
      setMigrationSummary(lines);
      setMessage("Fotoğraf yükleme tamamlandı.");
      setPhotoUrls({});
      if (selected) await loadPassengers(selected);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Fotoğraflar yüklenemedi.");
    } finally {
      setBusy(false);
    }
  }

  const refreshOperations = useCallback(async () => {
    if (!hasIdentity) return;
    setBusy(true);
    try {
      const page = await listV8Operations(identity, { limit: 500 });
      setOperations(page.items);
      setOperationTotal(page.total);
      setMessage(`${page.total} V8 operasyonundan ${page.items.length} tanesi yüklendi.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Operasyonlar yüklenemedi.");
    } finally {
      setBusy(false);
    }
  }, [identity, hasIdentity]);

  useEffect(() => {
    void refreshOperations();
  }, [refreshOperations]);

  const loadPassengers = useCallback(
    async (operation: V8Operation) => {
      setBusy(true);
      try {
        const [page, summaryData] = await Promise.all([
          listV8Passengers(identity, operation.id, {
            search: search.trim() || undefined,
            status: statusFilter || undefined,
            sort: sortOrder || undefined,
          }),
          getV8OperationSummary(identity, operation.id),
        ]);
        setPassengers(page.items);
        setPassengerTotal(page.total);
        setSummary(summaryData);
        setMessage(`${operation.code}: ${page.total} yolcu.`);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Yolcular yüklenemedi.");
      } finally {
        setBusy(false);
      }
    },
    [identity, search, statusFilter, sortOrder],
  );

  async function selectOperation(operation: V8Operation) {
    setSelected(operation);
    setRevealed({});
    setEditingId(null);
    setOperationNotes(operation.notes ?? "");
    await loadPassengers(operation);
  }

  // Fotoğraflar korumalı uçtan geldiği için yetkili istekle indirilip
  // tarayıcıda geçici URL olarak gösterilir.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const passenger of passengers) {
        if (!passenger.photo_object_key || photoUrls[passenger.id]) continue;
        try {
          const blob = await fetchV8PassengerPhoto(identity, passenger.id);
          if (cancelled) return;
          setPhotoUrls((current) => ({ ...current, [passenger.id]: URL.createObjectURL(blob) }));
        } catch {
          /* foto yüklenemezse kart fotosuz gösterilir */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passengers]);

  async function changeOperationStatus(nextStatus: string) {
    if (!selected || nextStatus === selected.status) return;
    setBusy(true);
    try {
      const updated = await updateV8Operation(identity, selected.id, {
        version: selected.version,
        status: nextStatus,
      });
      setSelected(updated);
      setMessage(`Durum güncellendi: ${STATUS_LABELS[updated.status] ?? updated.status}.`);
      await refreshOperations();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Durum güncellenemedi.");
    } finally {
      setBusy(false);
    }
  }

  async function saveOperationNotes() {
    if (!selected) return;
    setBusy(true);
    try {
      const updated = await updateV8Operation(identity, selected.id, {
        version: selected.version,
        notes: operationNotes,
      });
      setSelected(updated);
      setMessage("Operasyon notu kaydedildi.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Not kaydedilemedi.");
    } finally {
      setBusy(false);
    }
  }

  async function download(kindOrAction: "excel" | "csv" | "package" | "template" | "manifest") {
    setBusy(true);
    try {
      if (kindOrAction === "manifest") {
        if (!selected) return;
        const html = await fetchV8Manifest(identity, selected.id);
        const win = window.open("", "_blank");
        if (win) {
          win.document.write(html);
          win.document.close();
        }
        setMessage("Manifest yeni sekmede açıldı.");
        return;
      }
      if (kindOrAction === "template") {
        const result = await downloadV8Template(identity);
        saveBlob(result.blob, result.filename);
        setMessage("Şablon indirildi.");
        return;
      }
      if (!selected) return;
      const result =
        kindOrAction === "package"
          ? await downloadV8Package(identity, selected.id)
          : await exportV8Operation(identity, selected.id, kindOrAction);
      saveBlob(result.blob, result.filename);
      setMessage(`${result.filename} indirildi.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "İndirme başarısız.");
    } finally {
      setBusy(false);
    }
  }

  async function savePassengerEdit(passenger: V8Passenger, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      const passportInput = String(form.get("editPassport") ?? "").trim();
      await updateV8Passenger(identity, passenger.id, {
        version: passenger.version,
        first_name: String(form.get("editFirstName") ?? "").trim(),
        last_name: String(form.get("editLastName") ?? "").trim(),
        // Maskeli değer değiştirilmediyse pasaporta dokunma.
        ...(passportInput && !passportInput.includes("*") ? { passport_no: passportInput } : {}),
        voucher: String(form.get("editVoucher") ?? "").trim(),
        adult_fee: String(form.get("editAdultFee") || "0.00"),
        child_fee: String(form.get("editChildFee") || "0.00"),
      });
      setEditingId(null);
      if (selected) await loadPassengers(selected);
      setMessage(`${passenger.full_name} güncellendi.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Yolcu güncellenemedi.");
    } finally {
      setBusy(false);
    }
  }

  async function removePassenger(passenger: V8Passenger) {
    if (!window.confirm(`${passenger.full_name} silinsin mi?`)) return;
    setBusy(true);
    try {
      await deleteV8Passenger(identity, passenger.id, passenger.version);
      if (selected) await loadPassengers(selected);
      setMessage(`${passenger.full_name} silindi.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Yolcu silinemedi.");
    } finally {
      setBusy(false);
    }
  }

  async function removePhoto(passenger: V8Passenger) {
    setBusy(true);
    try {
      await deleteV8PassengerPhoto(identity, passenger.id);
      setPhotoUrls((current) => {
        const next = { ...current };
        delete next[passenger.id];
        return next;
      });
      if (selected) await loadPassengers(selected);
      setMessage(`${passenger.full_name} fotoğrafı silindi.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Fotoğraf silinemedi.");
    } finally {
      setBusy(false);
    }
  }

  // Arama/filtre değiştikçe liste kısa bir gecikmeyle kendiliğinden yenilenir.
  useEffect(() => {
    if (!selected) return;
    const timer = setTimeout(() => void loadPassengers(selected), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, statusFilter, sortOrder]);

  function saveIdentity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setV8ApiUrl(apiUrl);
    setApiUrl(getV8ApiUrl());
    window.localStorage.setItem("excelbase-v8-identity", JSON.stringify(identity));
    setMessage(identity.token ? "JWT kimliği kaydedildi." : "Geliştirme kimliği kaydedildi.");
    void refreshOperations();
  }

  async function addPassenger(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    try {
      await createV8Passenger(identity, selected.id, {
        first_name: String(form.get("firstName") ?? ""),
        last_name: String(form.get("lastName") ?? ""),
        passport_no: String(form.get("passport") ?? ""),
        voucher: String(form.get("voucher") ?? ""),
        adult_fee: String(form.get("adultFee") || "0.00"),
        child_fee: String(form.get("childFee") || "0.00"),
        currency: "EUR",
      });
      formElement.reset();
      await selectOperation(selected);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Yolcu oluşturulamadı.");
    } finally {
      setBusy(false);
    }
  }

  async function revealPassport(passenger: V8Passenger) {
    setBusy(true);
    try {
      const result = await revealV8Passport(identity, passenger.id);
      setRevealed((current) => ({ ...current, [passenger.id]: result.passport_no }));
      setMessage("Pasaport görüntüleme audit kaydına işlendi.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Pasaport gösterilemedi.");
    } finally {
      setBusy(false);
    }
  }

  async function uploadPhoto(passenger: V8Passenger, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !selected) return;
    setBusy(true);
    try {
      await uploadV8PassengerPhoto(identity, passenger.id, file);
      setPhotoUrls((current) => {
        const next = { ...current };
        delete next[passenger.id];
        return next;
      });
      await loadPassengers(selected);
      setMessage(`${passenger.full_name} için fotoğraf yüklendi.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Fotoğraf yüklenemedi.");
    } finally {
      setBusy(false);
    }
  }

  // Tek adımlı import: dosya seçilir seçilmez doğrulanır ve geçerli satırlar
  // otomatik commit edilir; kullanıcıdan ek onay istenmez.
  async function importIntoSelected(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0 || !selected) return;
    const operation = selected;
    setBusy(true);
    setMigrationSummary([]);
    try {
      let created = 0;
      let skippedDuplicates = 0;
      let invalidRows = 0;
      let successfulFiles = 0;
      const problems: string[] = [];

      for (const [index, file] of files.entries()) {
        setMessage(`Excel işleniyor (${index + 1}/${files.length}): ${file.name}`);
        try {
          const staged = await stageV8Import(identity, operation.id, file);
          if (staged.batch.valid_rows === 0) {
            invalidRows += staged.batch.invalid_rows;
            problems.push(
              `${file.name}: geçerli satır bulunamadı (${staged.batch.invalid_rows} hatalı satır).`,
            );
            continue;
          }

          const result = await commitV8Import(identity, staged.batch.id);
          created += result.created;
          skippedDuplicates += result.skipped_duplicates;
          invalidRows += result.invalid_rows;
          successfulFiles += 1;
        } catch (error) {
          problems.push(
            `${file.name}: ${error instanceof Error ? error.message : "işlenemedi"}`,
          );
        }
      }

      await selectOperation(operation);
      const lines = [
        `${files.length} dosyadan ${successfulFiles} tanesi işlendi; ${created} yolcu eklendi.`,
      ];
      if (skippedDuplicates > 0) {
        lines.push(`${skippedDuplicates} kayıt zaten bulunduğu için atlandı.`);
      }
      if (invalidRows > 0) {
        lines.push(`${invalidRows} hatalı satır atlandı.`);
      }
      lines.push(...problems);
      setMigrationSummary(lines);
      setMessage(
        problems.length === 0
          ? "Toplu Excel içe aktarma tamamlandı."
          : "Toplu içe aktarma tamamlandı; bazı dosyalarda sorun var.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>GATE VISA PAX · V8 PILOT</p>
          <h1>İlişkisel Operasyon Çekirdeği</h1>
        </div>
        <span className={styles.status}>{busy ? "İşleniyor" : message}</span>
      </header>

      {setupNeeded && (
        <section className={styles.card}>
          <h2>Hoş geldiniz — ilk kurulum</h2>
          <p>Adınızı ve e-postanızı girin; hesabınız oluşturulsun ve otomatik giriş yapılsın.</p>
          <form className={styles.stack} onSubmit={completeSetup}>
            <input name="setupName" placeholder="Adınız" required />
            <input name="setupEmail" type="email" placeholder="E-posta adresiniz" required />
            <button disabled={busy} type="submit">Kurulumu tamamla</button>
          </form>
        </section>
      )}

      <section className={styles.card}>
        <h2>Kimlik</h2>
        <p>JWT girildiğinde Bearer doğrulaması kullanılır; boşsa geliştirme başlıkları gönderilir.</p>
        <form className={styles.stack} onSubmit={saveIdentity}>
          <input
            aria-label="API adresi"
            placeholder="API adresi (örn. https://excelbase-v8.onrender.com)"
            value={apiUrl}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setApiUrl(event.target.value)}
          />
          <input
            aria-label="JWT"
            placeholder="JWT (production)"
            value={identity.token ?? ""}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setIdentity({ ...identity, token: event.target.value })}
          />
          <div className={styles.grid}>
            <input
              aria-label="Organization ID"
              placeholder="Organization UUID (dev)"
              value={identity.organizationId}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setIdentity({ ...identity, organizationId: event.target.value })}
            />
            <input
              aria-label="User ID"
              placeholder="User UUID (dev)"
              value={identity.userId}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setIdentity({ ...identity, userId: event.target.value })}
            />
          </div>
          <button type="submit">Kimliği kaydet</button>
        </form>
      </section>

      {hasIdentity && (
        <section className={styles.card}>
          <h2>Excel ve fotoğraf yükle — gerisi otomatik</h2>
          <p>
            Excel dosyalarını seçmeniz yeterli: operasyonlar gidiş tarihlerine göre kendiliğinden
            oluşturulur, yolcular yerleştirilir, tekrar eden kayıtlar atlanır. Fotoğraflarda ise dosya
            adındaki pasaport numarası veya ad-soyad ile doğru yolcu otomatik bulunur (ZIP de olur).
            V7 tarafında veri varsa sayfa açılışında kendiliğinden V8&apos;e taşınır.
          </p>
          <div className={styles.grid}>
            <label className={styles.listItem}>
              Excel yükle (çoklu seçilebilir)
              <input
                accept=".xlsx,.xls,.xlsm,.ods,.csv"
                hidden
                multiple
                onChange={(event) => void importExcelFiles(event)}
                type="file"
              />
            </label>
            <label className={styles.listItem}>
              Fotoğraf yükle (çoklu / ZIP)
              <input
                accept="image/*,.zip,.heic,.heif"
                hidden
                multiple
                onChange={(event) => void bulkUploadPhotos(event)}
                type="file"
              />
            </label>
          </div>
          <button disabled={busy} onClick={() => void migrateFromV7()} type="button">
            V7 verilerini V8&apos;e taşı (elle tetikle)
          </button>
          {migrationSummary.length > 0 && (
            <ul>
              {migrationSummary.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className={styles.columns}>
        <div className={styles.card}>
          <h2>
            Operasyonlar{" "}
            {operationTotal > 0
              ? `(${operationFilterActive ? `${filteredOperations.length}/` : ""}${operationTotal})`
              : ""}
          </h2>
          <p>Operasyonlar Excel yüklediğinizde gidiş tarihine göre otomatik oluşur.</p>
          <div className={styles.stack}>
            <div className={styles.grid}>
              <label className={styles.filterField}>
                <span>Başlangıç tarihi</span>
                <input
                  aria-label="Operasyon başlangıç tarihi"
                  max={operationDateTo || undefined}
                  onChange={(event) => setOperationDateFrom(event.target.value)}
                  type="date"
                  value={operationDateFrom}
                />
              </label>
              <label className={styles.filterField}>
                <span>Bitiş tarihi</span>
                <input
                  aria-label="Operasyon bitiş tarihi"
                  min={operationDateFrom || undefined}
                  onChange={(event) => setOperationDateTo(event.target.value)}
                  type="date"
                  value={operationDateTo}
                />
              </label>
            </div>
            {operationFilterActive && (
              <button
                disabled={busy}
                onClick={() => {
                  setOperationDateFrom("");
                  setOperationDateTo("");
                }}
                type="button"
              >
                Tarih filtresini temizle
              </button>
            )}
          </div>
          <div className={styles.list}>
            {filteredOperations.length === 0 ? (
              <p>Bu tarih aralığında operasyon bulunamadı.</p>
            ) : (
              filteredOperations.map((operation) => (
                <button
                  key={operation.id}
                  className={selected?.id === operation.id ? styles.selected : styles.listItem}
                  onClick={() => void selectOperation(operation)}
                  type="button"
                >
                  <strong>{operation.code}</strong>
                  <span>{operation.route_origin} → {operation.route_destination}</span>
                  <small>
                    {operation.departure_date} · {STATUS_LABELS[operation.status] ?? operation.status}
                  </small>
                </button>
              ))
            )}
          </div>
        </div>

        <div className={styles.card}>
          <h2>{selected ? `${selected.code} (${passengerTotal})` : "Operasyon seçin"}</h2>
          {selected && (
            <>
              {summary && (
                <div className={styles.summary}>
                  <span>👥 {summary.passenger_count} yolcu</span>
                  <span>✅ %{summary.readiness_percent} hazır</span>
                  <span>📷 {summary.with_photo} fotoğraflı</span>
                  <span>🎫 {summary.missing_voucher} voucher eksik</span>
                  <span>💶 {summary.total_fee} EUR toplam</span>
                </div>
              )}

              <div className={styles.grid}>
                <select
                  aria-label="Operasyon durumu"
                  value={selected.status}
                  onChange={(event: ChangeEvent<HTMLSelectElement>) => void changeOperationStatus(event.target.value)}
                >
                  {Object.entries(STATUS_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
                <button disabled={busy} onClick={() => void saveOperationNotes()} type="button">
                  Notu kaydet
                </button>
              </div>
              <input
                aria-label="Operasyon notu"
                placeholder="Operasyon notu / görevli"
                value={operationNotes}
                onChange={(event: ChangeEvent<HTMLInputElement>) => setOperationNotes(event.target.value)}
              />

              <div className={styles.actions}>
                <button disabled={busy} onClick={() => void download("excel")} type="button">Excel indir</button>
                <button disabled={busy} onClick={() => void download("csv")} type="button">CSV indir</button>
                <button disabled={busy} onClick={() => void download("manifest")} type="button">Manifest</button>
                <button disabled={busy} onClick={() => void download("package")} type="button">Paket (ZIP)</button>
                <button disabled={busy} onClick={() => void download("template")} type="button">Şablon</button>
              </div>

              <form className={styles.stack} onSubmit={addPassenger}>
                <div className={styles.grid}>
                  <input name="firstName" placeholder="Ad" required />
                  <input name="lastName" placeholder="Soyad" required />
                </div>
                <div className={styles.grid}>
                  <input name="passport" placeholder="Pasaport" required />
                  <input name="voucher" placeholder="Voucher" />
                </div>
                <div className={styles.grid}>
                  <input name="adultFee" inputMode="decimal" placeholder="Yetişkin ücret" />
                  <input name="childFee" inputMode="decimal" placeholder="Çocuk ücret" />
                </div>
                <button disabled={busy} type="submit">Yolcu ekle</button>
              </form>

              <label className={styles.importBox}>
                Bu operasyona Excel yükle — çoklu seçilebilir
                <input
                  accept=".xlsx,.xls,.xlsm,.ods,.csv"
                  hidden
                  multiple
                  onChange={(event) => void importIntoSelected(event)}
                  type="file"
                />
              </label>

              <div className={styles.stack}>
                <input
                  aria-label="Yolcu ara"
                  placeholder="Ara: ad, soyad, voucher veya pasaport no"
                  value={search}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => setSearch(event.target.value)}
                />
                <div className={styles.grid}>
                  <select
                    aria-label="Durum filtresi"
                    value={statusFilter}
                    onChange={(event: ChangeEvent<HTMLSelectElement>) => setStatusFilter(event.target.value)}
                  >
                    <option value="">Tümü</option>
                    <option value="fotosuz">Fotoğrafsız</option>
                    <option value="fotografli">Fotoğraflı</option>
                    <option value="vouchersiz">Voucher eksik</option>
                    <option value="ucretsiz">Ücret girilmemiş</option>
                    <option value="eksik">Eksikler (herhangi biri)</option>
                    <option value="hazir">Hazır</option>
                  </select>
                  <select
                    aria-label="Sıralama"
                    value={sortOrder}
                    onChange={(event: ChangeEvent<HTMLSelectElement>) => setSortOrder(event.target.value)}
                  >
                    <option value="">Soyada göre</option>
                    <option value="arrival">Varış tarihine göre</option>
                    <option value="recent">Son eklenen</option>
                  </select>
                </div>
              </div>

              <div className={styles.list}>
                {passengers.map((passenger) => (
                  <div className={styles.passenger} key={passenger.id}>
                    <div className={styles.passengerRow}>
                      {photoUrls[passenger.id] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img alt={passenger.full_name} className={styles.photo} src={photoUrls[passenger.id]} />
                      ) : (
                        <div className={styles.noPhoto}>Foto yok</div>
                      )}
                      <div>
                        <strong>{passenger.full_name}</strong>
                        <span className={styles.block}>
                          {revealed[passenger.id] ?? passenger.passport_masked} · {passenger.voucher || "Voucher yok"}
                        </span>
                        <small className={styles.block}>
                          {passenger.adult_fee} {passenger.currency}
                          {passenger.arrival_date ? ` · varış ${passenger.arrival_date}` : ""}
                        </small>
                      </div>
                    </div>

                    {editingId === passenger.id ? (
                      <form className={styles.stack} onSubmit={(event) => void savePassengerEdit(passenger, event)}>
                        <div className={styles.grid}>
                          <input defaultValue={passenger.first_name} name="editFirstName" placeholder="Ad" required />
                          <input defaultValue={passenger.last_name} name="editLastName" placeholder="Soyad" required />
                        </div>
                        <div className={styles.grid}>
                          <input
                            defaultValue={revealed[passenger.id] ?? passenger.passport_masked}
                            name="editPassport"
                            placeholder="Pasaport"
                          />
                          <input defaultValue={passenger.voucher} name="editVoucher" placeholder="Voucher" />
                        </div>
                        <div className={styles.grid}>
                          <input defaultValue={passenger.adult_fee} inputMode="decimal" name="editAdultFee" placeholder="Yetişkin ücret" />
                          <input defaultValue={passenger.child_fee} inputMode="decimal" name="editChildFee" placeholder="Çocuk ücret" />
                        </div>
                        <div className={styles.grid}>
                          <button disabled={busy} type="submit">Kaydet</button>
                          <button disabled={busy} onClick={() => setEditingId(null)} type="button">Vazgeç</button>
                        </div>
                      </form>
                    ) : (
                      <div className={styles.actions}>
                        {!revealed[passenger.id] && (
                          <button disabled={busy} onClick={() => void revealPassport(passenger)} type="button">
                            Pasaportu göster
                          </button>
                        )}
                        <button disabled={busy} onClick={() => setEditingId(passenger.id)} type="button">
                          Düzenle
                        </button>
                        <label className={styles.uploadBtn}>
                          Fotoğraf yükle
                          <input
                            accept="image/*,.heic,.heif"
                            hidden
                            onChange={(event) => void uploadPhoto(passenger, event)}
                            type="file"
                          />
                        </label>
                        {passenger.photo_object_key && (
                          <button disabled={busy} onClick={() => void removePhoto(passenger)} type="button">
                            Fotoğrafı sil
                          </button>
                        )}
                        <button disabled={busy} onClick={() => void removePassenger(passenger)} type="button">
                          Sil
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
