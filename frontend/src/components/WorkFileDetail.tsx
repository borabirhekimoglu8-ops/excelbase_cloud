"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  createWorkspaceNote,
  createWorkspaceTask,
  fetchOfficeDocuments,
  fetchPassengers,
  fetchWorkspaceNotes,
  fetchWorkspaceTasks,
  getWorkFile,
  linkPassengerToWorkFile,
  openOfficeDocument,
  toggleWorkspaceTask,
  unlinkPassengerFromWorkFile,
  updateWorkFile,
  uploadOfficeDocument,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useStore } from "@/lib/store";
import type { Passenger } from "@/lib/api";
import type {
  OfficeDocument,
  OfficeDocumentCategory,
  WorkFile,
  WorkFileStatus,
  WorkspaceNote,
  WorkspaceTask,
} from "@/lib/workspace";

const STATUS_LABELS: Record<WorkFileStatus, string> = {
  open: "Açık",
  waiting: "Bekliyor",
  blocked: "Engelli / dikkat",
  done: "Tamamlandı",
  archived: "Arşiv",
};

const DOCUMENT_LABELS: Record<OfficeDocumentCategory, string> = {
  letter: "Dilekçe / yazı",
  passenger_list: "Yolcu listesi",
  official_form: "Resmi form",
  contract: "Sözleşme",
  invoice: "Fatura",
  correspondence: "Yazışma",
  spreadsheet: "Excel / tablo",
  other: "Diğer evrak",
};

function dateLabel(value: string): string {
  if (!value) return "—";
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return value;
  return `${match[3]}.${match[2]}.${match[1]}`;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function WorkFileDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { user } = useAuth();
  const { version, bump, notify } = useStore();
  const [workFile, setWorkFile] = useState<WorkFile | null>(null);
  const [tasks, setTasks] = useState<WorkspaceTask[]>([]);
  const [notes, setNotes] = useState<WorkspaceNote[]>([]);
  const [documents, setDocuments] = useState<OfficeDocument[]>([]);
  const [passengers, setPassengers] = useState<Passenger[]>([]);
  const [passengerQuery, setPassengerQuery] = useState("");
  const [documentCategory, setDocumentCategory] = useState<OfficeDocumentCategory>("other");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const [file, taskRows, noteRows, documentRows, passengerRows] = await Promise.all([
      getWorkFile(id),
      fetchWorkspaceTasks({ work_file_id: id }),
      fetchWorkspaceNotes({ work_file_id: id }),
      fetchOfficeDocuments({ work_file_id: id }),
      fetchPassengers(),
    ]);
    setWorkFile(file);
    setTasks(taskRows);
    setNotes(noteRows);
    setDocuments(documentRows);
    setPassengers(passengerRows);
  }, [id]);

  useEffect(() => {
    setError("");
    void refresh().catch((reason) => setError(reason instanceof Error ? reason.message : "İş dosyası açılamadı."));
  }, [refresh, version]);

  const linkedPassengers = useMemo(() => {
    if (!workFile) return [];
    const wanted = new Set(workFile.passenger_record_uids);
    return passengers.filter((passenger) => wanted.has(passenger.record_uid));
  }, [passengers, workFile]);

  const passengerCandidates = useMemo(() => {
    const query = passengerQuery.trim().toLocaleLowerCase("tr-TR");
    if (!query || !workFile) return [];
    const linked = new Set(workFile.passenger_record_uids);
    return passengers
      .filter((passenger) => !linked.has(passenger.record_uid))
      .filter((passenger) => (
        passenger.full_name.toLocaleLowerCase("tr-TR").includes(query)
        || passenger.passport_no.toLocaleLowerCase("tr-TR").includes(query)
      ))
      .slice(0, 6);
  }, [passengerQuery, passengers, workFile]);

  async function setStatus(status: WorkFileStatus) {
    if (!workFile) return;
    setBusy("status");
    try {
      await updateWorkFile(workFile.id, { status });
      bump();
      notify(`İş durumu “${STATUS_LABELS[status]}” olarak güncellendi.`);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "Durum güncellenemedi.", "error");
    } finally {
      setBusy("");
    }
  }

  async function addTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const title = String(data.get("title") ?? "").trim();
    if (!title) return;
    setBusy("task");
    try {
      await createWorkspaceTask({
        title,
        due_at: String(data.get("due_at") ?? ""),
        priority: "normal",
        work_file_id: id,
        assignee: user.name,
      });
      event.currentTarget.reset();
      bump();
      await refresh();
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "Görev eklenemedi.", "error");
    } finally {
      setBusy("");
    }
  }

  async function addNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const body = String(data.get("body") ?? "").trim();
    if (!body) return;
    setBusy("note");
    try {
      await createWorkspaceNote({ body, author: user.name, work_file_id: id });
      form.reset();
      bump();
      await refresh();
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "Not eklenemedi.", "error");
    } finally {
      setBusy("");
    }
  }

  async function toggleTask(task: WorkspaceTask) {
    setBusy(`task-${task.id}`);
    try {
      await toggleWorkspaceTask(task.id, task.status !== "done");
      bump();
      await refresh();
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "Görev güncellenemedi.", "error");
    } finally {
      setBusy("");
    }
  }

  async function uploadDocument(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy("document");
    try {
      await uploadOfficeDocument(file, {
        title: file.name.replace(/\.[^.]+$/, ""),
        category: documentCategory,
        document_date: new Date().toISOString().slice(0, 10),
        work_file_id: id,
      });
      bump();
      await refresh();
      notify(`${file.name} iş dosyasına eklendi.`);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "Evrak yüklenemedi.", "error");
    } finally {
      setBusy("");
    }
  }

  async function openDocument(document: OfficeDocument) {
    setBusy(document.id);
    try {
      const opened = await openOfficeDocument(document.id);
      downloadBlob(opened.blob, opened.metadata.filename);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "Evrak açılamadı.", "error");
    } finally {
      setBusy("");
    }
  }

  async function linkPassenger(passenger: Passenger) {
    setBusy(`passenger-${passenger.record_uid}`);
    try {
      await linkPassengerToWorkFile(id, passenger.record_uid);
      setPassengerQuery("");
      bump();
      await refresh();
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "Yolcu bağlanamadı.", "error");
    } finally {
      setBusy("");
    }
  }

  async function unlinkPassenger(passenger: Passenger) {
    setBusy(`passenger-${passenger.record_uid}`);
    try {
      await unlinkPassengerFromWorkFile(id, passenger.record_uid);
      bump();
      await refresh();
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "Yolcu bağlantısı kaldırılamadı.", "error");
    } finally {
      setBusy("");
    }
  }

  if (error) {
    return (
      <div className="ops-empty">
        <strong>İş dosyası açılamadı</strong>
        <p>{error}</p>
        <button className="ops-secondary" type="button" onClick={onBack}>İŞLERE DÖN</button>
      </div>
    );
  }

  if (!workFile) return <div className="ops-empty"><p>İş dosyası hazırlanıyor…</p></div>;

  return (
    <div className="ops-page">
      <section className="ops-detail-hero">
        <div className="ops-detail-head">
          <div>
            <p className="ops-work-code">{workFile.file_no || "KODSUZ DOSYA"}</p>
            <h1>{workFile.title}</h1>
            <p>{[workFile.company, workFile.route, workFile.category].filter(Boolean).join(" · ")}</p>
          </div>
          <span className={`ops-badge ${workFile.status}`}>{STATUS_LABELS[workFile.status]}</span>
        </div>
        <div className="ops-detail-stats">
          <div><strong>{linkedPassengers.length}</strong><span>YOLCU</span></div>
          <div><strong>{documents.length}</strong><span>EVRAK</span></div>
          <div><strong>{tasks.filter((task) => task.status !== "done").length}</strong><span>AÇIK GÖREV</span></div>
        </div>
      </section>

      <section className="ops-module-card">
        <div className="ops-section-heading">
          <div><p className="ops-eyebrow">GENEL BİLGİLER</p><h2>Dosya durumu</h2></div>
          <select
            aria-label="İş durumu"
            value={workFile.status}
            disabled={busy === "status"}
            onChange={(event) => void setStatus(event.target.value as WorkFileStatus)}
          >
            {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <div className="ops-kv">
          <div><span>Firma / Muhatap</span><strong>{workFile.company || "—"}</strong></div>
          <div><span>Hat / Güzergâh</span><strong>{workFile.route || "—"}</strong></div>
          <div><span>Sorumlu</span><strong>{workFile.owner || "—"}</strong></div>
          <div><span>Öncelik</span><strong>{workFile.priority.toLocaleUpperCase("tr-TR")}</strong></div>
          <div><span>Başlangıç</span><strong>{dateLabel(workFile.start_date)}</strong></div>
          <div><span>Son tarih</span><strong>{dateLabel(workFile.due_date)}</strong></div>
        </div>
        {workFile.description && <p className="ops-detail-description">{workFile.description}</p>}
      </section>

      <section className="ops-module-card">
        <div className="ops-section-heading">
          <div><p className="ops-eyebrow">BAĞLI KAYITLAR</p><h2>Yolcular</h2></div>
          <span>{linkedPassengers.length} kişi</span>
        </div>
        <label className="ic-search">
          <span aria-hidden="true">⌕</span>
          <input
            aria-label="İş dosyasına yolcu ara"
            value={passengerQuery}
            onChange={(event) => setPassengerQuery(event.target.value)}
            placeholder="İsim veya pasaport ile yolcu bağla"
          />
        </label>
        {passengerCandidates.length > 0 && (
          <div className="ops-search-results">
            {passengerCandidates.map((passenger) => (
              <button type="button" key={passenger.record_uid} onClick={() => void linkPassenger(passenger)}>
                <span><strong>{passenger.full_name}</strong><small>{passenger.passport_no}</small></span>
                <b>BAĞLA</b>
              </button>
            ))}
          </div>
        )}
        <div className="ops-note-list">
          {linkedPassengers.map((passenger) => (
            <div className="ops-note-row" key={passenger.record_uid}>
              <div><strong>{passenger.full_name}</strong><small>{passenger.passport_no} · {dateLabel(passenger.departure_date)}</small></div>
              <button
                className="ops-danger-link"
                type="button"
                disabled={busy === `passenger-${passenger.record_uid}`}
                onClick={() => void unlinkPassenger(passenger)}
              >
                KALDIR
              </button>
            </div>
          ))}
          {!linkedPassengers.length && <div className="ops-empty-inline">Bu iş dosyasına henüz yolcu bağlanmadı.</div>}
        </div>
      </section>

      <section className="ops-module-card">
        <div className="ops-section-heading">
          <div><p className="ops-eyebrow">BELGE YÖNETİMİ</p><h2>Evraklar</h2></div>
          <span>{documents.length} dosya</span>
        </div>
        <div className="ops-document-upload-row">
          <label className="ops-field">
            <span>Evrak türü</span>
            <select value={documentCategory} onChange={(event) => setDocumentCategory(event.target.value as OfficeDocumentCategory)}>
              {Object.entries(DOCUMENT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="ops-upload-label">
            {busy === "document" ? "YÜKLENİYOR…" : "EVRAK SEÇ"}
            <input
              aria-label="İş dosyasına evrak seç"
              type="file"
              disabled={busy === "document"}
              accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx,.csv,.ods"
              onChange={(event) => void uploadDocument(event)}
            />
          </label>
        </div>
        <div className="ops-document-list">
          {documents.map((document) => (
            <div className="ops-document-row" key={document.id}>
              <span className="ops-file-code">{document.filename.split(".").pop()?.slice(0, 3).toUpperCase() || "EVR"}</span>
              <div><strong>{document.title || document.filename}</strong><small>{DOCUMENT_LABELS[document.category]} · {dateLabel(document.document_date)}</small></div>
              <div className="ops-document-actions">
                <button type="button" disabled={busy === document.id} onClick={() => void openDocument(document)}>İNDİR</button>
              </div>
            </div>
          ))}
          {!documents.length && <div className="ops-empty-inline">İş dosyasına henüz evrak eklenmedi.</div>}
        </div>
      </section>

      <section className="ops-module-card">
        <div className="ops-section-heading">
          <div><p className="ops-eyebrow">İŞ AKIŞI</p><h2>Görevler</h2></div>
          <span>{tasks.filter((task) => task.status !== "done").length} açık</span>
        </div>
        <form className="ops-inline-form task" onSubmit={addTask}>
          <input name="title" required aria-label="Yeni görev" placeholder="Yeni görev yazın" />
          <input name="due_at" type="date" aria-label="Görev son tarihi" />
          <button className="ops-primary" disabled={busy === "task"} type="submit">EKLE</button>
        </form>
        <div className="ops-task-list">
          {tasks.map((task) => (
            <div className={`ops-task-row${task.status === "done" ? " done" : ""}`} key={task.id}>
              <label>
                <input
                  type="checkbox"
                  checked={task.status === "done"}
                  disabled={busy === `task-${task.id}`}
                  onChange={() => void toggleTask(task)}
                />
                <span><strong>{task.title}</strong><small>{task.assignee || "Atanmamış"} · {dateLabel(task.due_at)}</small></span>
              </label>
              <span className={`ops-badge ${task.priority}`}>{task.priority.toLocaleUpperCase("tr-TR")}</span>
            </div>
          ))}
          {!tasks.length && <div className="ops-empty-inline">Henüz görev eklenmedi.</div>}
        </div>
      </section>

      <section className="ops-module-card">
        <div className="ops-section-heading">
          <div><p className="ops-eyebrow">DOSYA NOTLARI</p><h2>Notlar</h2></div>
          <span>{notes.length} not</span>
        </div>
        <form className="ops-inline-form" onSubmit={addNote}>
          <input name="body" required aria-label="Yeni not" placeholder="Operasyon notu ekleyin" />
          <button className="ops-primary" disabled={busy === "note"} type="submit">EKLE</button>
        </form>
        <div className="ops-note-list">
          {notes.map((note) => (
            <div className="ops-note-row" key={note.id}>
              <div><strong>{note.body}</strong><small>{note.author || "Yerel kullanıcı"} · {dateLabel(note.created_at)}</small></div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
