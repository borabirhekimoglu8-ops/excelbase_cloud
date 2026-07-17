"use client";

import { useEffect, useState } from "react";
import { RecordFolder, fetchRecordFolders } from "@/lib/api";
import { LocalDownloadButton } from "@/components/LocalDownloadButton";
import { useStore } from "@/lib/store";

function folderDateLabel(value: string): string {
  if (value === "Tarihsiz" || !value) return "Kayıt tarihi bilinmeyen";
  const parts = value.split("-").map(Number);
  const date = new Date(parts[0], (parts[1] || 1) - 1, parts[2] || 1);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "long", year: "numeric" }).format(date);
}

function folderWeekday(value: string): string {
  if (value === "Tarihsiz" || !value) return "ÖNCEKİ KAYITLAR";
  const parts = value.split("-").map(Number);
  const date = new Date(parts[0], (parts[1] || 1) - 1, parts[2] || 1);
  if (Number.isNaN(date.getTime())) return "KAYIT KLASÖRÜ";
  return new Intl.DateTimeFormat("tr-TR", { weekday: "long" }).format(date).toLocaleUpperCase("tr-TR");
}

export function RecordsTab({ onCreate, canCreate = true }: { onCreate: () => void; canCreate?: boolean }) {
  const { dateScope, version } = useStore();
  const [folders, setFolders] = useState<RecordFolder[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openDate, setOpenDate] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    fetchRecordFolders({ ...dateScope, field: "created" })
      .then((response) => {
        if (!active) return;
        setFolders(response.groups);
        setTotal(response.total_count);
      })
      .catch((reason) => {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : "Kayıt klasörleri açılamadı.");
      })
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [dateScope, version]);

  const ready = folders.reduce((sum, folder) => sum + folder.ready_count, 0);
  const pending = folders.reduce((sum, folder) => sum + folder.review_count + folder.draft_count, 0);

  return (
    <div className="ic-records-page">
      <section className="ic-records-hero">
        <div className="ic-records-hero-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/ido-logo.jpg" alt="İDO" />
          <div>
            <p>GATE VISA CHECKLIST</p>
            <h2>Günlük kayıt klasörleri</h2>
            <span>Her yolcu, evraklarıyla birlikte oluşturulduğu günün klasöründe saklanır.</span>
          </div>
        </div>
        <div className="ic-records-stats">
          <div><strong>{total}</strong><span>YOLCU</span></div>
          <div><strong>{folders.length}</strong><span>KLASÖR</span></div>
          <div><strong>{ready}</strong><span>HAZIR</span></div>
          <div><strong>{pending}</strong><span>BEKLİYOR</span></div>
        </div>
        {canCreate && <button className="ic-records-new" type="button" onClick={onCreate}>+ YENİ YOLCU KAYDI</button>}
      </section>

      <div className="ic-section-head">
        <div>
          <p className="ic-section-title">Kayıt tarihine göre klasörler</p>
          <p className="ic-section-caption">Sefer tarihinden bağımsız günlük dosya düzeni</p>
        </div>
        <span className="ic-pill ic-pill-info">{folders.length} KLASÖR</span>
      </div>

      {loading && <div className="ic-records-loading">Kayıt klasörleri hazırlanıyor…</div>}
      {error && <div className="ic-record-error" role="alert">{error}</div>}
      {!loading && !error && folders.length === 0 && (
        <div className="ic-records-empty">
          <span className="ic-records-empty-mark">+</span>
          <h3>Bu tarihte kayıt klasörü yok</h3>
          <p>İlk yolcu kaydını açın veya Yükle sekmesinden toplu Excel aktarın.</p>
          {canCreate && <button type="button" onClick={onCreate}>YENİ KAYIT AÇ</button>}
        </div>
      )}

      <div className="ic-folder-list">
        {folders.map((folder) => {
          const open = openDate === folder.date_key;
          const missing = folder.review_count + folder.draft_count;
          return (
            <article className={`ic-folder-card${open ? " open" : ""}`} key={folder.date_key}>
              <button className="ic-folder-head" type="button" onClick={() => setOpenDate(open ? "" : folder.date_key)} aria-expanded={open}>
                <span className="ic-folder-icon" aria-hidden="true"><span /></span>
                <span className="ic-folder-copy">
                  <small>{folderWeekday(folder.date_key)}</small>
                  <strong>{folderDateLabel(folder.date_key)}</strong>
                  <span>{folder.count} yolcu · {folder.document_count} PDF · {folder.with_photo} JPG</span>
                </span>
                <span className="ic-folder-status">
                  <span className="ic-pill ic-pill-ok">{folder.ready_count} HAZIR</span>
                  {missing > 0 && <span className="ic-pill ic-pill-warn">{missing} EKSİK</span>}
                  <b aria-hidden="true">{open ? "−" : "+"}</b>
                </span>
              </button>

              {open && (
                <div className="ic-folder-body">
                  <div className="ic-folder-breakdown">
                    <div><span>Hazır</span><strong>{folder.ready_count}</strong></div>
                    <div><span>Kontrol</span><strong>{folder.review_count}</strong></div>
                    <div><span>Taslak</span><strong>{folder.draft_count}</strong></div>
                    <div><span>Fotoğraf</span><strong>{folder.with_photo}/{folder.count}</strong></div>
                  </div>
                  <LocalDownloadButton className="ic-folder-primary" kind="record-package" ids={folder.passenger_ids} recordDate={folder.date_key}>
                    TARİH KLASÖRÜNÜ ZIP İNDİR
                  </LocalDownloadButton>
                  <div className="ic-folder-actions">
                    <LocalDownloadButton kind="daily-list" ids={folder.passenger_ids}>İDO LİSTESİ</LocalDownloadButton>
                    <LocalDownloadButton kind="excel" ids={folder.passenger_ids}>EXCEL</LocalDownloadButton>
                  </div>
                  {folder.date_key === "Tarihsiz" && (
                    <p className="ic-folder-legacy-note">Bu eski kayıtların kesin oluşturulma tarihi bulunamadığı için ayrı klasörde tutulur.</p>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
