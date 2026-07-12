"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  V8Identity,
  V8Operation,
  V8Passenger,
  autoImportV8Excel,
  commitV8Import,
  createV8Operation,
  createV8Passenger,
  getV8ApiUrl,
  getV8SetupStatus,
  listV8Operations,
  listV8Passengers,
  matchV8Photos,
  revealV8Passport,
  runV8Setup,
  setV8ApiUrl,
  stageV8Import,
  migrateV7ToV8,
  uploadV8PassengerPhoto,
} from "@/lib/api-v8";
import { downloadUrl } from "@/lib/api";
import styles from "./V8Pilot.module.css";

const EMPTY_IDENTITY: V8Identity = { userId: "", organizationId: "", token: "" };

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

  const hasIdentity = Boolean(identity.token || (identity.userId && identity.organizationId));

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
      if (selected) await selectOperation(selected);
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
      const page = await listV8Operations(identity);
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

  async function selectOperation(operation: V8Operation) {
    setSelected(operation);
    setRevealed({});
    setBusy(true);
    try {
      const page = await listV8Passengers(identity, operation.id);
      setPassengers(page.items);
      setPassengerTotal(page.total);
      setMessage(`${operation.code}: ${page.total} yolcu.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Yolcular yüklenemedi.");
    } finally {
      setBusy(false);
    }
  }

  function saveIdentity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setV8ApiUrl(apiUrl);
    setApiUrl(getV8ApiUrl());
    window.localStorage.setItem("excelbase-v8-identity", JSON.stringify(identity));
    setMessage(identity.token ? "JWT kimliği kaydedildi." : "Geliştirme kimliği kaydedildi.");
    void refreshOperations();
  }

  async function addOperation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // event.currentTarget is nulled once the handler yields, so capture it first.
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    try {
      await createV8Operation(identity, {
        code: String(form.get("code") ?? ""),
        route_origin: String(form.get("origin") ?? ""),
        route_destination: String(form.get("destination") ?? ""),
        departure_date: String(form.get("departure") ?? ""),
        vessel_name: String(form.get("vessel") ?? ""),
      });
      formElement.reset();
      await refreshOperations();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Operasyon oluşturulamadı.");
    } finally {
      setBusy(false);
    }
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
      await selectOperation(selected);
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
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !selected) return;
    setBusy(true);
    try {
      setMessage(`${file.name} işleniyor…`);
      const staged = await stageV8Import(identity, selected.id, file);
      if (staged.batch.valid_rows === 0) {
        setMessage(`${file.name}: geçerli satır bulunamadı (${staged.batch.invalid_rows} hatalı satır).`);
        return;
      }
      const result = await commitV8Import(identity, staged.batch.id);
      await selectOperation(selected);
      setMessage(
        `${result.created} yolcu eklendi` +
          (result.skipped_duplicates > 0 ? `, ${result.skipped_duplicates} kayıt zaten vardı` : "") +
          (result.invalid_rows > 0 ? `, ${result.invalid_rows} hatalı satır atlandı` : "") +
          ".",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Import başarısız.");
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
          <h2>Operasyonlar {operationTotal > 0 ? `(${operationTotal})` : ""}</h2>
          <form className={styles.stack} onSubmit={addOperation}>
            <input name="code" placeholder="KUS-SAM-20260710" required />
            <div className={styles.grid}>
              <input name="origin" placeholder="Kuşadası" required />
              <input name="destination" placeholder="Samos Vathy" required />
            </div>
            <div className={styles.grid}>
              <input name="departure" type="date" required />
              <input name="vessel" placeholder="Gemi" />
            </div>
            <button disabled={busy} type="submit">Operasyon oluştur</button>
          </form>
          <div className={styles.list}>
            {operations.map((operation) => (
              <button
                key={operation.id}
                className={selected?.id === operation.id ? styles.selected : styles.listItem}
                onClick={() => void selectOperation(operation)}
                type="button"
              >
                <strong>{operation.code}</strong>
                <span>{operation.route_origin} → {operation.route_destination}</span>
                <small>{operation.departure_date} · {operation.status} · v{operation.version}</small>
              </button>
            ))}
          </div>
        </div>

        <div className={styles.card}>
          <h2>{selected ? `${selected.code} (${passengerTotal})` : "Operasyon seçin"}</h2>
          {selected && (
            <>
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
                Bu operasyona Excel yükle — otomatik işlenir
                <input
                  accept=".xlsx,.xls,.xlsm,.ods,.csv"
                  hidden
                  onChange={(event) => void importIntoSelected(event)}
                  type="file"
                />
              </label>

              <div className={styles.list}>
                {passengers.map((passenger) => (
                  <div className={styles.passenger} key={passenger.id}>
                    <strong>{passenger.full_name}</strong>
                    <span>
                      {revealed[passenger.id] ?? passenger.passport_masked} · {passenger.voucher || "Voucher yok"}
                    </span>
                    <small>
                      {passenger.adult_fee} {passenger.currency} · v{passenger.version}
                      {passenger.photo_object_key ? " · fotoğraf var" : ""}
                    </small>
                    <div className={styles.grid}>
                      {!revealed[passenger.id] && (
                        <button disabled={busy} onClick={() => void revealPassport(passenger)} type="button">
                          Pasaportu göster
                        </button>
                      )}
                      <label className={styles.listItem}>
                        Fotoğraf yükle
                        <input
                          accept="image/jpeg,image/png,image/webp"
                          hidden
                          onChange={(event) => void uploadPhoto(passenger, event)}
                          type="file"
                        />
                      </label>
                    </div>
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
