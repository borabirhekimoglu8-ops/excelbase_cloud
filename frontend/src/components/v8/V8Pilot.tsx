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
  listV8Operations,
  listV8Passengers,
  stageV8Import,
} from "@/lib/api-v8";
import styles from "./V8Pilot.module.css";

const EMPTY_IDENTITY: V8Identity = { userId: "", organizationId: "" };

export function V8Pilot() {
  const [identity, setIdentity] = useState<V8Identity>(EMPTY_IDENTITY);
  const [operations, setOperations] = useState<V8Operation[]>([]);
  const [selected, setSelected] = useState<V8Operation | null>(null);
  const [passengers, setPassengers] = useState<V8Passenger[]>([]);
  const [preview, setPreview] = useState<V8ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("V8 pilot bağlantısı bekleniyor.");

  useEffect(() => {
    const saved = window.localStorage.getItem("excelbase-v8-identity");
    if (saved) {
      try {
        setIdentity(JSON.parse(saved) as V8Identity);
      } catch {
        window.localStorage.removeItem("excelbase-v8-identity");
      }
    }
  }, []);

  const refreshOperations = useCallback(async () => {
    if (!identity.userId || !identity.organizationId) return;
    setBusy(true);
    try {
      const data = await listV8Operations(identity);
      setOperations(data);
      setMessage(`${data.length} V8 operasyonu yüklendi.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Operasyonlar yüklenemedi.");
    } finally {
      setBusy(false);
    }
  }, [identity]);

  useEffect(() => {
    void refreshOperations();
  }, [refreshOperations]);

  async function selectOperation(operation: V8Operation) {
    setSelected(operation);
    setPreview(null);
    setBusy(true);
    try {
      const data = await listV8Passengers(identity, operation.id);
      setPassengers(data);
      setMessage(`${operation.code}: ${data.length} yolcu.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Yolcular yüklenemedi.");
    } finally {
      setBusy(false);
    }
  }

  function saveIdentity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    window.localStorage.setItem("excelbase-v8-identity", JSON.stringify(identity));
    setMessage("Geliştirme kimliği kaydedildi.");
    void refreshOperations();
  }

  async function addOperation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await createV8Operation(identity, {
        code: String(form.get("code") ?? ""),
        route_origin: String(form.get("origin") ?? ""),
        route_destination: String(form.get("destination") ?? ""),
        departure_date: String(form.get("departure") ?? ""),
        vessel_name: String(form.get("vessel") ?? ""),
      });
      event.currentTarget.reset();
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
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await createV8Passenger(identity, selected.id, {
        first_name: String(form.get("firstName") ?? ""),
        last_name: String(form.get("lastName") ?? ""),
        passport_no: String(form.get("passport") ?? ""),
        voucher: String(form.get("voucher") ?? ""),
        adult_fee: String(form.get("adultFee") ?? "0.00"),
        child_fee: String(form.get("childFee") ?? "0.00"),
        currency: "EUR",
      });
      event.currentTarget.reset();
      await selectOperation(selected);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Yolcu oluşturulamadı.");
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
        <h2>Geliştirme kimliği</h2>
        <p>Production’da bu alan OIDC oturumuyla değiştirilecektir.</p>
        <form className={styles.grid} onSubmit={saveIdentity}>
          <input
            aria-label="Organization ID"
            placeholder="Organization UUID"
            value={identity.organizationId}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setIdentity({ ...identity, organizationId: event.target.value })}
          />
          <input
            aria-label="User ID"
            placeholder="User UUID"
            value={identity.userId}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setIdentity({ ...identity, userId: event.target.value })}
          />
          <button type="submit">Kimliği kaydet</button>
        </form>
      </section>

      <section className={styles.columns}>
        <div className={styles.card}>
          <h2>Operasyonlar</h2>
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
          <h2>{selected ? selected.code : "Operasyon seçin"}</h2>
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
                    <span>{passenger.passport_no} · {passenger.voucher || "Voucher yok"}</span>
                    <small>{passenger.adult_fee} {passenger.currency} · v{passenger.version}</small>
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
