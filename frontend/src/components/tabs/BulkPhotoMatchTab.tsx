"use client";

import { ChangeEvent, DragEvent, useCallback, useEffect, useState } from "react";
import {
  assignUnmatchedPhoto,
  deleteUnmatchedPhoto,
  fetchPassengers,
  fetchUnmatchedPhotos,
  matchPhotos,
  type MatchPhotosResponse,
  type Passenger,
  type UnmatchedPhoto,
} from "@/lib/api";
import { IMAGE_ACCEPT } from "@/lib/imageFormat";
import { useStore } from "@/lib/store";
import { EmptyState } from "@/components/ui/EmptyState";

type BulkPhotoMatchTabProps = {
  onOpenPassengers?: () => void;
};

export function BulkPhotoMatchTab({ onOpenPassengers }: BulkPhotoMatchTabProps) {
  const { bump, notify, summary } = useStore();
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState<MatchPhotosResponse | null>(null);
  const [unmatched, setUnmatched] = useState<UnmatchedPhoto[]>([]);
  const [passengers, setPassengers] = useState<Passenger[]>([]);
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [loadingQueue, setLoadingQueue] = useState(true);

  const refreshQueue = useCallback(async () => {
    setLoadingQueue(true);
    try {
      const [items, rows] = await Promise.all([
        fetchUnmatchedPhotos(),
        fetchPassengers({}),
      ]);
      setUnmatched(items);
      setPassengers(rows);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "Eşleşmeyen fotoğraflar okunamadı.", "error");
    } finally {
      setLoadingQueue(false);
    }
  }, [notify]);

  useEffect(() => {
    void refreshQueue();
  }, [refreshQueue, summary.unmatched_photo_count, summary.passenger_count]);

  async function runMatch(files: File[]) {
    if (!files.length) return;
    if (summary.passenger_count === 0) {
      notify("Önce yolcu listesini yükleyin; fotoğraflar listede eşleşir.", "error");
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const next = await matchPhotos(files);
      setResult(next);
      bump();
      await refreshQueue();
      if (next.matched > 0) {
        notify(`${next.matched} fotoğraf otomatik eşleşti.`, "ok");
      } else if (next.unmatched.length) {
        notify(`${next.unmatched.length} fotoğraf eşleşmedi — aşağıdan atayın.`, "error");
      }
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "Fotoğraflar eşleştirilemedi.", "error");
    } finally {
      setBusy(false);
    }
  }

  function onPick(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    void runMatch(files);
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    const files = Array.from(event.dataTransfer.files ?? []);
    void runMatch(files);
  }

  async function handleAssign(item: UnmatchedPhoto) {
    const passengerId = Number(assignments[item.id] ?? "");
    if (!passengerId) return;
    setBusy(true);
    try {
      await assignUnmatchedPhoto(item.id, passengerId);
      bump();
      await refreshQueue();
      notify(`${item.filename} atandı.`, "ok");
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "Atama başarısız.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ops-page xb-photo-match">
      <section className="ops-page-heading">
        <div>
          <p className="ops-eyebrow">Biyometrik</p>
          <h1>Toplu fotoğraf eşleştir</h1>
          <p>
            Klasördeki vesikalıkları sürükleyip bırakın. Dosya adındaki isim, pasaport veya voucher ile
            yolcuya otomatik bağlanır.
          </p>
        </div>
      </section>

      <label
        className={`xb-photo-drop${dragging ? " dragging" : ""}${busy ? " busy" : ""}`}
        onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <strong>{busy ? "Eşleştiriliyor…" : "Fotoğraf veya ZIP bırakın"}</strong>
        <span>JPG, PNG, HEIC, WEBP, GIF, BMP, TIFF · toplu seçim · ZIP içinden de okur</span>
        <em>{summary.passenger_count} yolcu listede · {summary.missing_photo} fotosuz</em>
        <input
          type="file"
          accept={`${IMAGE_ACCEPT},.zip,application/zip`}
          multiple
          aria-label="Toplu biyometrik fotoğraf seç"
          disabled={busy || summary.passenger_count === 0}
          onChange={onPick}
        />
      </label>

      {result && (
        <section className="ops-module-card xb-photo-result" aria-live="polite">
          <div className="ops-section-heading">
            <div>
              <p className="ops-eyebrow">Son işlem</p>
              <h2>{result.matched} eşleşti · {result.unmatched.length} bekliyor</h2>
            </div>
          </div>
          {result.matches.length > 0 && (
            <ul className="xb-photo-match-list">
              {result.matches.slice(0, 12).map((item) => (
                <li key={`${item.filename}-${item.passenger_id}`}>
                  <strong>{item.passenger_name}</strong>
                  <small>{item.filename} · {item.method} · %{Math.round(item.confidence * 100)}</small>
                </li>
              ))}
            </ul>
          )}
          {result.matches.length > 12 && (
            <p className="xb-photo-more">+{result.matches.length - 12} eşleşme daha</p>
          )}
        </section>
      )}

      <section className="ops-module-card">
        <div className="ops-section-heading">
          <div>
            <p className="ops-eyebrow">Elle atama</p>
            <h2>Eşleşmeyen fotoğraflar</h2>
          </div>
          <span>{unmatched.length}</span>
        </div>

        {loadingQueue ? (
          <p className="ops-empty-inline">Kuyruk okunuyor…</p>
        ) : unmatched.length === 0 ? (
          <EmptyState
            title="Bekleyen fotoğraf yok"
            body="Otomatik eşleşenler yolcu kartına yazıldı. Fotosuz kalanlar için Kapı listesine bakın."
            action={onOpenPassengers ? (
              <button className="ops-primary" type="button" onClick={onOpenPassengers}>
                Fotosuz yolcular
              </button>
            ) : undefined}
          />
        ) : (
          <div className="xb-photo-queue">
            {unmatched.map((item) => (
              <div className="ic-row compact" key={item.id}>
                <div className="ic-row-id">
                  <span className="ic-avatar">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={item.photo_url} alt={item.filename} />
                  </span>
                  <div className="ic-row-copy">
                    <p className="ic-row-title">{item.filename}</p>
                    <select
                      value={assignments[item.id] ?? ""}
                      onChange={(event) => setAssignments((cur) => ({ ...cur, [item.id]: event.target.value }))}
                      disabled={busy}
                      aria-label={`${item.filename} için yolcu seç`}
                    >
                      <option value="">Yolcu seçin</option>
                      {passengers.map((passenger) => (
                        <option key={passenger.id} value={passenger.id}>
                          {passenger.full_name} · {passenger.passport_no}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="xb-photo-queue-actions">
                  <button
                    className="ic-section-link"
                    type="button"
                    disabled={busy || !assignments[item.id]}
                    onClick={() => void handleAssign(item)}
                  >
                    Ata
                  </button>
                  <button
                    className="ic-section-link"
                    type="button"
                    style={{ color: "var(--ido-red)" }}
                    disabled={busy}
                    onClick={async () => {
                      await deleteUnmatchedPhoto(item.id);
                      bump();
                      await refreshQueue();
                    }}
                  >
                    Kaldır
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
