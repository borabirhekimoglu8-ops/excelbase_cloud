"use client";

import { useEffect, useMemo, useState } from "react";
import { WorkFileCard } from "@/components/WorkFileCard";
import {
  fetchOfficeDocuments,
  fetchWorkFiles,
  fetchWorkspaceTasks,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useStore } from "@/lib/store";
import type { OfficeDocument, WorkFile, WorkspaceTask } from "@/lib/workspace";

type HomeTabProps = {
  onNavigate: (target: string) => void;
  onOpenWorkFile: (id: string) => void;
  onAssistant: () => void;
};

function isActiveWorkFile(workFile: WorkFile): boolean {
  return workFile.status === "open" || workFile.status === "waiting" || workFile.status === "blocked";
}

function localIsoDate(): string {
  const now = new Date();
  return [
    String(now.getFullYear()).padStart(4, "0"),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

function workFileRank(workFile: WorkFile): number {
  const priority = { urgent: 4, high: 3, normal: 2, low: 1 }[workFile.priority];
  const overdue = workFile.due_date && workFile.due_date < localIsoDate() ? 10 : 0;
  const blocked = workFile.status === "blocked" ? 5 : 0;
  return priority + overdue + blocked;
}

export function HomeTab({ onNavigate, onOpenWorkFile, onAssistant }: HomeTabProps) {
  const { user } = useAuth();
  const { summary, version } = useStore();
  const [workFiles, setWorkFiles] = useState<WorkFile[]>([]);
  const [tasks, setTasks] = useState<WorkspaceTask[]>([]);
  const [documents, setDocuments] = useState<OfficeDocument[]>([]);
  const [workspaceError, setWorkspaceError] = useState("");

  useEffect(() => {
    let active = true;
    setWorkspaceError("");
    Promise.all([fetchWorkFiles(), fetchWorkspaceTasks(), fetchOfficeDocuments()])
      .then(([fileRows, taskRows, documentRows]) => {
        if (!active) return;
        setWorkFiles(fileRows);
        setTasks(taskRows);
        setDocuments(documentRows);
      })
      .catch((reason) => {
        if (!active) return;
        setWorkspaceError(reason instanceof Error ? reason.message : "Çalışma alanı özeti okunamadı.");
      });
    return () => {
      active = false;
    };
  }, [version]);

  const activeFiles = useMemo(
    () => workFiles.filter(isActiveWorkFile).sort((a, b) => workFileRank(b) - workFileRank(a)),
    [workFiles],
  );
  const openTasks = tasks.filter((task) => task.status !== "done");
  const urgentTasks = openTasks.filter((task) => task.priority === "urgent" || task.priority === "high");
  const readyCount = summary.ready_count || Math.max(0, summary.passenger_count - summary.missing_count);
  const todayLabel = new Intl.DateTimeFormat("tr-TR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date());

  return (
    <div className="ops-page">
      <section className="ops-home-hero">
        <div>
          <p className="ops-eyebrow">ÇALIŞMA ALANI</p>
          <h1>Günaydın, {user.name.split(" ")[0] || "Operasyon"}</h1>
          <p>{todayLabel} · İşler, yolcular ve evraklar cihazınızda şifreli tutuluyor.</p>
        </div>
        <span className="ops-status-mark">ÇEVRİMDIŞI HAZIR</span>
      </section>

      <div className="ops-metric-grid">
        <article>
          <span>Açık iş</span>
          <strong>{activeFiles.length}</strong>
          <small>{workFiles.length} toplam dosya</small>
        </article>
        <article className={urgentTasks.length ? "attention" : ""}>
          <span>Açık görev</span>
          <strong>{openTasks.length}</strong>
          <small>{urgentTasks.length} öncelikli</small>
        </article>
        <article>
          <span>Yolcu</span>
          <strong>{summary.passenger_count}</strong>
          <small>{readyCount} kayıt hazır</small>
        </article>
        <article className={summary.missing_count ? "attention" : ""}>
          <span>Eksik evrak</span>
          <strong>{summary.missing_count}</strong>
          <small>{documents.length} genel evrak arşivde</small>
        </article>
      </div>

      {workspaceError && <div className="ops-form-error" role="alert">{workspaceError}</div>}

      <section className="ops-module-card">
        <div className="ops-module-head">
          <div>
            <p className="ops-eyebrow">AKTİF MODÜL</p>
            <h2>Gate Visa Checklist</h2>
            <p className="ops-module-copy">Yolcu listeleri, biyometrik fotoğraflar, PDF evraklar ve günlük çıktılar.</p>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/ido-logo.jpg" alt="İDO" />
        </div>
        <div className="ops-gate-progress">
          <div>
            <strong>{summary.passenger_count}</strong>
            <span>YOLCU</span>
          </div>
          <div>
            <strong>{summary.readiness_percent}%</strong>
            <span>HAZIRLIK</span>
          </div>
          <div>
            <strong>{summary.today_count}</strong>
            <span>BUGÜN</span>
          </div>
        </div>
        <div className="ops-home-actions">
          <button className="ops-primary" type="button" onClick={() => onNavigate("passengers")}>
            YOLCULARI AÇ
          </button>
          <button className="ops-secondary" type="button" onClick={() => onNavigate("import")}>
            TOPLU LİSTE
          </button>
          <button className="ops-secondary" type="button" onClick={() => onNavigate("records")}>
            KAYIT KLASÖRLERİ
          </button>
        </div>
      </section>

      <section className="ops-module-card">
        <div className="ops-section-heading">
          <div>
            <p className="ops-eyebrow">ÖNCELİKLİ TAKİP</p>
            <h2>Aktif iş dosyaları</h2>
          </div>
          <button className="ops-section-link" type="button" onClick={() => onNavigate("work-files")}>
            TÜMÜNÜ GÖR
          </button>
        </div>
        <div className="ops-work-list">
          {activeFiles.slice(0, 3).map((workFile) => {
            const fileTasks = tasks.filter((task) => task.work_file_id === workFile.id);
            const nextTask = fileTasks.find((task) => task.status !== "done");
            return (
              <WorkFileCard
                key={workFile.id}
                workFile={workFile}
                onOpen={onOpenWorkFile}
                documentCount={documents.filter((document) => document.work_file_id === workFile.id).length}
                taskCount={fileTasks.filter((task) => task.status !== "done").length}
                nextAction={nextTask?.title}
              />
            );
          })}
        </div>
        {!activeFiles.length && (
          <div className="ops-empty-inline">
            Aktif iş dosyası yok. Yeni bir C kodu veya operasyon dosyasıyla başlayabilirsiniz.
          </div>
        )}
      </section>

      <button className="ops-assistant-card" type="button" onClick={onAssistant}>
        <span className="ops-assistant-mark" aria-hidden="true">S</span>
        <span>
          <strong>Claude Sonnet Asistan</strong>
          <small>Operasyon özetini gerçek Sonnet ile değerlendirin; bağımsız çalışma alanını açın.</small>
        </span>
        <b aria-hidden="true">›</b>
      </button>
    </div>
  );
}
