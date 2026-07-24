"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import {
  fetchUnifiedDocuments,
  fetchWorkFiles,
  openOfficeDocument,
  openPassengerDocument,
  uploadOfficeDocument,
} from "@/lib/api";
import { useStore } from "@/lib/store";
import type {
  OfficeDocumentCategory,
  UnifiedDocumentMetadata,
  WorkFile,
} from "@/lib/workspace";

type DocumentFilter = "all" | "pdf" | "spreadsheet" | "letter";

const CATEGORY_LABELS: Record<string, string> = {
  letter: "Dilekçe / yazı",
  passenger_list: "Yolcu listesi",
  official_form: "Resmi form",
  contract: "Sözleşme",
  invoice: "Fatura",
  correspondence: "Yazışma",
  spreadsheet: "Excel / tablo",
  passport: "Pasaport",
  application_form: "Başvuru formu",
  hotel: "Otel rezervasyonu",
  ferry: "Feribot bileti",
  insurance: "Seyahat sigortası",
  bank: "Banka evrakı",
  other: "Diğer evrak",
};

function extension(filename: string): string {
  return filename.split(".").pop()?.toLocaleUpperCase("tr-TR").slice(0, 4) || "EVR";
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function DocumentsTab({
  onOpenGallery,
  autoOpenUpload = false,
}: {
  onOpenGallery: () => void;
  autoOpenUpload?: boolean;
}) {
  const { version, bump, notify } = useStore();
  const [documents, setDocuments] = useState<UnifiedDocumentMetadata[]>([]);
  const [workFiles, setWorkFiles] = useState<WorkFile[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<DocumentFilter>("all");
  const [showUpload, setShowUpload] = useState(autoOpenUpload);
  const [category, setCategory] = useState<OfficeDocumentCategory>("other");
  const [workFileId, setWorkFileId] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (autoOpenUpload) setShowUpload(true);
  }, [autoOpenUpload]);

  useEffect(() => {
    let active = true;
    setError("");
    Promise.all([fetchUnifiedDocuments(), fetchWorkFiles()])
      .then(([documentRows, fileRows]) => {
        if (!active) return;
        setDocuments(documentRows);
        setWorkFiles(fileRows);
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : "Evrak merkezi açılamadı.");
      });
    return () => { active = false; };
  }, [version]);

  const workFileById = useMemo(() => new Map(workFiles.map((file) => [file.id, file])), [workFiles]);

  const visible = useMemo(() => {
    const folded = query.trim().toLocaleLowerCase("tr-TR");
    return documents.filter((document) => {
      if (filter === "pdf" && document.mime !== "application/pdf" && !document.filename.toLocaleLowerCase("tr-TR").endsWith(".pdf")) return false;
      if (filter === "spreadsheet" && document.category !== "spreadsheet" && !/\.(xlsx?|csv|ods)$/i.test(document.filename)) return false;
      if (filter === "letter" && document.category !== "letter" && document.category !== "correspondence") return false;
      if (!folded) return true;
      const work = workFileById.get(document.work_file_id);
      return [
        document.title,
        document.filename,
        CATEGORY_LABELS[document.category] ?? document.category,
        document.passenger_name,
        work?.file_no,
        work?.title,
      ].join(" ").toLocaleLowerCase("tr-TR").includes(folded);
    });
  }, [documents, filter, query, workFileById]);

  async function openDocument(document: UnifiedDocumentMetadata) {
    setBusy(document.id);
    try {
      if (document.source === "office") {
        const opened = await openOfficeDocument(document.id);
        downloadBlob(opened.blob, opened.metadata.filename);
      } else if (document.passenger_id !== null) {
        const documentId = document.id.split(":").at(-1) ?? "";
        const opened = await openPassengerDocument(document.passenger_id, documentId);
        downloadBlob(opened.blob, opened.metadata.filename);
      }
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "Evrak açılamadı.", "error");
    } finally {
      setBusy("");
    }
  }

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy("upload");
    try {
      await uploadOfficeDocument(file, {
        title: file.name.replace(/\.[^.]+$/, ""),
        category,
        document_date: new Date().toISOString().slice(0, 10),
        work_file_id: workFileId,
      });
      bump();
      setShowUpload(false);
      notify(`${file.name} şifreli evrak merkezine kaydedildi.`);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "Evrak yüklenemedi.", "error");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="ops-page">
      <section className="ops-page-heading">
        <div>
          <p className="ops-eyebrow">MERKEZİ BELGE ARŞİVİ</p>
          <h1>Evrak Merkezi</h1>
          <p>Yolcu PDF’leri ve genel ofis belgeleri tek, aranabilir görünümde.</p>
        </div>
        <button className="ops-primary ops-heading-action" type="button" onClick={() => setShowUpload((value) => !value)}>
          + EVRAK
        </button>
      </section>

      {showUpload && (
        <section className="ops-form-section">
          <h2>Evrakı arşive ekleyin</h2>
          <p>Bir iş dosyasına bağlayabilir veya genel arşivde saklayabilirsiniz.</p>
          <div className="ops-form-grid">
            <label className="ops-field">
              <span>Evrak türü</span>
              <select value={category} onChange={(event) => setCategory(event.target.value as OfficeDocumentCategory)}>
                <option value="letter">Dilekçe / yazı</option>
                <option value="passenger_list">Yolcu listesi</option>
                <option value="official_form">Resmi form</option>
                <option value="contract">Sözleşme</option>
                <option value="invoice">Fatura</option>
                <option value="correspondence">Yazışma</option>
                <option value="spreadsheet">Excel / tablo</option>
                <option value="other">Diğer</option>
              </select>
            </label>
            <label className="ops-field">
              <span>Bağlı iş dosyası</span>
              <select value={workFileId} onChange={(event) => setWorkFileId(event.target.value)}>
                <option value="">Genel arşiv</option>
                {workFiles.map((file) => <option key={file.id} value={file.id}>{file.file_no || "KODSUZ"} · {file.title}</option>)}
              </select>
            </label>
          </div>
          <label className="ops-upload-label">
            {busy === "upload" ? "YÜKLENİYOR…" : "DOSYA SEÇ VE KAYDET"}
            <input
              aria-label="Evrak merkezine dosya seç"
              type="file"
              disabled={busy === "upload"}
              accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx,.csv,.ods"
              onChange={(event) => void upload(event)}
            />
          </label>
        </section>
      )}

      <div className="ops-toolbar">
        <label className="ic-search">
          <span aria-hidden="true">⌕</span>
          <input aria-label="Evrak ara" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Dosya, yolcu, C kodu veya iş ara" />
        </label>
        <div className="ops-segments" role="tablist" aria-label="Evrak türleri">
          {([
            ["all", "Tümü"],
            ["pdf", "PDF"],
            ["spreadsheet", "Excel"],
            ["letter", "Dilekçe"],
          ] as Array<[DocumentFilter, string]>).map(([value, label]) => (
            <button key={value} role="tab" aria-selected={filter === value} className={filter === value ? "active" : ""} type="button" onClick={() => setFilter(value)}>
              {label}
            </button>
          ))}
          <button type="button" onClick={onOpenGallery}>Fotoğraflar</button>
        </div>
      </div>

      {error && <div className="ops-form-error" role="alert">{error}</div>}

      <div className="ops-document-list">
        {visible.map((document) => {
          const work = workFileById.get(document.work_file_id);
          const owner = document.passenger_name
            ? document.passenger_name
            : work
              ? `${work.file_no || "KODSUZ"} · ${work.title}`
              : "Genel arşiv";
          return (
            <article className="ops-document-row" data-testid={`document-row-${document.id}`} key={document.id}>
              <span className="ops-file-code">{extension(document.filename)}</span>
              <div>
                <strong>{document.title || document.filename}</strong>
                <small>{owner}</small>
                <small>{CATEGORY_LABELS[document.category] ?? document.category} · {humanSize(document.size)} · {document.document_date}</small>
              </div>
              <div className="ops-document-actions">
                <button disabled={busy === document.id} type="button" onClick={() => void openDocument(document)}>
                  {busy === document.id ? "…" : "İNDİR"}
                </button>
              </div>
            </article>
          );
        })}
      </div>

      {!visible.length && (
        <div className="ops-empty">
          <strong>{documents.length ? "Aramanızla eşleşen evrak yok" : "Evrak merkezi boş"}</strong>
          <p>Genel belgeleri buradan ekleyebilir; yolcu PDF’lerini mevcut yolcu kayıtlarından yönetebilirsiniz.</p>
          <button className="ops-primary" type="button" onClick={() => setShowUpload(true)}>EVRAK YÜKLE</button>
        </div>
      )}
    </div>
  );
}
