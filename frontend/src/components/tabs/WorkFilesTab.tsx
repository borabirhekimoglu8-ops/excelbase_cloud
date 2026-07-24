"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { WorkFileCard } from "@/components/WorkFileCard";
import {
  createCodeRecord,
  fetchCodeRecords,
  fetchOfficeDocuments,
  fetchWorkFiles,
  fetchWorkspaceTasks,
} from "@/lib/api";
import { useStore } from "@/lib/store";
import type {
  CodeRecord,
  CodeRecordStatus,
  OfficeDocument,
  WorkFile,
  WorkFileStatus,
  WorkspaceTask,
} from "@/lib/workspace";

type WorkFilter = "all" | WorkFileStatus;
type View = "work-files" | "codes";

const FILTERS: Array<{ value: WorkFilter; label: string }> = [
  { value: "all", label: "Tümü" },
  { value: "open", label: "Açık" },
  { value: "waiting", label: "Bekliyor" },
  { value: "blocked", label: "Dikkat" },
  { value: "done", label: "Tamamlandı" },
  { value: "archived", label: "Arşiv" },
];

const CODE_STATUS_LABELS: Record<CodeRecordStatus, string> = {
  active: "AKTİF",
  inactive: "PASİF",
  expired: "SÜRESİ DOLDU",
  archived: "ARŞİV",
};

export function WorkFilesTab({
  onCreate,
  onOpen,
}: {
  onCreate: () => void;
  onOpen: (id: string) => void;
}) {
  const { version, bump, notify } = useStore();
  const [view, setView] = useState<View>("work-files");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<WorkFilter>("all");
  const [workFiles, setWorkFiles] = useState<WorkFile[]>([]);
  const [codeRecords, setCodeRecords] = useState<CodeRecord[]>([]);
  const [tasks, setTasks] = useState<WorkspaceTask[]>([]);
  const [documents, setDocuments] = useState<OfficeDocument[]>([]);
  const [showCodeForm, setShowCodeForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setError("");
    Promise.all([
      fetchWorkFiles(),
      fetchCodeRecords(),
      fetchWorkspaceTasks(),
      fetchOfficeDocuments(),
    ]).then(([files, codes, taskRows, documentRows]) => {
      if (!active) return;
      setWorkFiles(files);
      setCodeRecords(codes);
      setTasks(taskRows);
      setDocuments(documentRows);
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : "İş dosyaları okunamadı.");
    });
    return () => { active = false; };
  }, [version]);

  const visibleFiles = useMemo(() => {
    const folded = query.trim().toLocaleLowerCase("tr-TR");
    return workFiles.filter((workFile) => {
      if (filter !== "all" && workFile.status !== filter) return false;
      if (!folded) return true;
      return [
        workFile.file_no,
        workFile.title,
        workFile.category,
        workFile.company,
        workFile.route,
        workFile.owner,
        workFile.description,
        ...workFile.tags,
      ].join(" ").toLocaleLowerCase("tr-TR").includes(folded);
    });
  }, [filter, query, workFiles]);

  const visibleCodes = useMemo(() => {
    const folded = query.trim().toLocaleLowerCase("tr-TR");
    if (!folded) return codeRecords;
    return codeRecords.filter((record) => (
      [record.code, record.title, record.category, record.description, ...record.tags]
        .join(" ")
        .toLocaleLowerCase("tr-TR")
        .includes(folded)
    ));
  }, [codeRecords, query]);

  async function createCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    try {
      await createCodeRecord({
        code: String(data.get("code") ?? ""),
        title: String(data.get("title") ?? ""),
        category: String(data.get("category") ?? ""),
        status: String(data.get("status") ?? "active") as CodeRecordStatus,
        description: String(data.get("description") ?? ""),
        valid_from: String(data.get("valid_from") ?? ""),
        valid_to: String(data.get("valid_to") ?? ""),
        tags: String(data.get("tags") ?? "").split(/[,;\n]/).map((tag) => tag.trim()).filter(Boolean),
      });
      form.reset();
      setShowCodeForm(false);
      bump();
      notify("C kodu kayıt altına alındı.");
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "C kodu kaydedilemedi.", "error");
    } finally {
      setBusy(false);
    }
  }

  const openCount = workFiles.filter((file) => file.status === "open" || file.status === "waiting").length;
  const attentionCount = workFiles.filter((file) => file.status === "blocked" || file.priority === "urgent").length;

  return (
    <div className="ops-page">
      <section className="ops-page-heading">
        <div>
          <p className="ops-eyebrow">OPERASYON DOSYALARI</p>
          <h1>İş Dosyaları</h1>
          <p>C kodları, görevler, yolcular ve evraklar aynı operasyon kaydında.</p>
        </div>
        <button className="ops-primary ops-heading-action" type="button" onClick={onCreate}>+ YENİ İŞ</button>
      </section>

      <div className="ops-metric-grid">
        <article><span>Açık işler</span><strong>{openCount}</strong><small>Aktif ve bekleyen dosyalar</small></article>
        <article className={attentionCount ? "attention" : ""}><span>Dikkat isteyen</span><strong>{attentionCount}</strong><small>Engelli veya acil kayıt</small></article>
      </div>

      <div className="ops-toolbar">
        <div className="ops-segments" role="tablist" aria-label="İş kayıt türü">
          <button className={view === "work-files" ? "active" : ""} role="tab" aria-selected={view === "work-files"} onClick={() => setView("work-files")} type="button">
            İŞ DOSYALARI
          </button>
          <button className={view === "codes" ? "active" : ""} role="tab" aria-selected={view === "codes"} onClick={() => setView("codes")} type="button">
            C KODLARI
          </button>
        </div>
        <label className="ic-search">
          <span aria-hidden="true">⌕</span>
          <input
            aria-label={view === "work-files" ? "İş dosyası ara" : "C kodu ara"}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={view === "work-files" ? "C kodu, başlık, firma veya hat ara" : "Kod, başlık veya kategori ara"}
          />
        </label>
        {view === "work-files" && (
          <div className="ops-segments" aria-label="İş durumu filtreleri">
            {FILTERS.map((item) => (
              <button key={item.value} className={filter === item.value ? "active" : ""} type="button" onClick={() => setFilter(item.value)}>
                {item.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {error && <div className="ops-form-error" role="alert">{error}</div>}

      {view === "work-files" && (
        <>
          <div className="ops-work-list">
            {visibleFiles.map((workFile) => {
              const taskRows = tasks.filter((task) => task.work_file_id === workFile.id);
              const nextTask = taskRows.find((task) => task.status !== "done");
              return (
                <WorkFileCard
                  key={workFile.id}
                  workFile={workFile}
                  onOpen={onOpen}
                  documentCount={documents.filter((document) => document.work_file_id === workFile.id).length}
                  taskCount={taskRows.filter((task) => task.status !== "done").length}
                  nextAction={nextTask?.title}
                />
              );
            })}
          </div>
          {!visibleFiles.length && (
            <div className="ops-empty">
              <strong>{workFiles.length ? "Filtreye uyan iş bulunamadı" : "İlk iş dosyanızı oluşturun"}</strong>
              <p>Bir C kodu veya operasyon başlığıyla başlayıp yolcu, evrak ve görevleri aynı dosyaya bağlayabilirsiniz.</p>
              <button className="ops-primary" type="button" onClick={onCreate}>YENİ İŞ DOSYASI</button>
            </div>
          )}
        </>
      )}

      {view === "codes" && (
        <>
          <button className="ops-secondary" type="button" onClick={() => setShowCodeForm((value) => !value)}>
            {showCodeForm ? "FORMU KAPAT" : "+ YENİ C KODU"}
          </button>
          {showCodeForm && (
            <form className="ops-form-section" onSubmit={createCode}>
              <h2>C kodunu kaydedin</h2>
              <div className="ops-form-grid">
                <label className="ops-field"><span>C kodu</span><input name="code" required aria-label="C kodu" placeholder="C-2026-001" /></label>
                <label className="ops-field"><span>Durum</span><select name="status"><option value="active">Aktif</option><option value="inactive">Pasif</option><option value="expired">Süresi doldu</option><option value="archived">Arşiv</option></select></label>
                <label className="ops-field full"><span>Başlık</span><input name="title" required placeholder="Kodun kullanım amacı" /></label>
                <label className="ops-field"><span>Kategori</span><input name="category" placeholder="Operasyon, tarife, resmi kod…" /></label>
                <label className="ops-field"><span>Etiketler</span><input name="tags" placeholder="samos, acente" /></label>
                <label className="ops-field"><span>Geçerlilik başlangıcı</span><input name="valid_from" type="date" /></label>
                <label className="ops-field"><span>Geçerlilik sonu</span><input name="valid_to" type="date" /></label>
                <label className="ops-field full"><span>Açıklama</span><textarea name="description" /></label>
              </div>
              <button className="ops-primary" disabled={busy} type="submit">{busy ? "KAYDEDİLİYOR…" : "C KODUNU KAYDET"}</button>
            </form>
          )}

          <div className="ops-code-list">
            {visibleCodes.map((record) => (
              <article className="ops-code-card" key={record.id}>
                <div>
                  <p className="ops-work-code">{record.code}</p>
                  <h3>{record.title}</h3>
                  <p>{[record.category, record.valid_to ? `Bitiş ${record.valid_to}` : ""].filter(Boolean).join(" · ")}</p>
                </div>
                <span className={`ops-badge ${record.status}`}>{CODE_STATUS_LABELS[record.status]}</span>
                {record.description && <small>{record.description}</small>}
              </article>
            ))}
          </div>
          {!visibleCodes.length && <div className="ops-empty"><strong>Henüz C kodu yok</strong><p>Kodları açıklaması, geçerlilik tarihi ve etiketleriyle aranabilir bir arşivde tutabilirsiniz.</p></div>}
        </>
      )}
    </div>
  );
}
