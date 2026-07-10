"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useState } from "react";
import {
  V8Identity,
  V8ImportPreview,
  V8Operation,
  V8Passenger,
  commitV8Import,
  createV8Operation,
  createV8Passenger,
  getV8ApiUrl,
  listV8Operations,
  listV8Passengers,
  revealV8Passport,
  setV8ApiUrl,
  stageV8Import,
  uploadV8PassengerPhoto,
} from "@/lib/api-v8";
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
  const [preview, setPreview] = useState<V8ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("V8 pilot bağlantısı bekleniyor.");
  const [apiUrl, setApiUrl] = useState("");

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
  }, []);

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
    setPreview(null);
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

  async function stageImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) return;
    setBusy(true);
    try {
      const result = await stageV8Import(identity, selected.id, file);
      setPreview(result);
      setMessage(`${result.batch.valid_rows} geçerli, ${result.batch.invalid_rows} hatalı satır.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Import staging başarısız.");
    } finally {
      setBusy(false);
    }
  }

  async function commitImport() {
    if (!selected || !preview) return;
    setBusy(true);
    try {
      const result = await commitV8Import(identity, preview.batch.id);
      setPreview(null);
      await selectOperation(selected);
      setMessage(`${result.created} yolcu commit edildi; ${result.skipped_duplicates} duplicate atlandı.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Import commit başarısız.");
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

              <form className={styles.importBox} onSubmit={stageImport}>
                <input name="file" type="file" accept=".xlsx,.xls,.xlsm,.ods,.csv" required />
                <button disabled={busy} type="submit">Import önizle</button>
              </form>

              {preview && (
                <div className={styles.preview}>
                  <strong>{preview.batch.filename}</strong>
                  <span>{preview.batch.valid_rows} geçerli · {preview.batch.invalid_rows} hatalı</span>
                  <button disabled={busy || preview.batch.valid_rows === 0} onClick={() => void commitImport()} type="button">
                    Geçerli satırları commit et
                  </button>
                </div>
              )}

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
