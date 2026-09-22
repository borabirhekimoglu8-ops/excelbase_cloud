"use client";

import { useEffect, useMemo, useState } from "react";
import { WorkFileCard } from "@/components/WorkFileCard";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  fetchOfficeDocuments,
  fetchWorkFiles,
  fetchWorkspaceTasks,
  lastBackupAt,
} from "@/lib/api";
import { downloadLocal } from "@/lib/offline/downloads";
import { useAuth } from "@/lib/auth";
import { useStore } from "@/lib/store";
import { PRODUCT } from "@/lib/product";
import type { OfficeDocument, WorkFile, WorkspaceTask } from "@/lib/workspace";

type HomeTabProps = {
  onNavigate: (target: string) => void;
  onOpenWorkFile: (id: string) => void;
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

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  return Math.floor((Date.now() - then) / 86_400_000);
}

export function HomeTab({ onNavigate, onOpenWorkFile }: HomeTabProps) {
  const { user } = useAuth();
  const { summary, version, notify } = useStore();
  const [workFiles, setWorkFiles] = useState<WorkFile[]>([]);
  const [tasks, setTasks] = useState<WorkspaceTask[]>([]);
  const [documents, setDocuments] = useState<OfficeDocument[]>([]);
  const [workspaceError, setWorkspaceError] = useState("");
  const [backupAt, setBackupAt] = useState<string | null>(null);
  const [closingDay, setClosingDay] = useState(false);

  useEffect(() => {
    let active = true;
    setWorkspaceError("");
    Promise.all([fetchWorkFiles(), fetchWorkspaceTasks(), fetchOfficeDocuments(), lastBackupAt()])
      .then(([fileRows, taskRows, documentRows, lastBackup]) => {
        if (!active) return;
        setWorkFiles(fileRows);
        setTasks(taskRows);
        setDocuments(documentRows);
        setBackupAt(lastBackup);
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
  const backupAge = daysSince(backupAt);
  const todayLabel = new Intl.DateTimeFormat("tr-TR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());

  async function closeDay() {
    setClosingDay(true);
    try {
      await downloadLocal("package");
      notify("Teslim paketi hazır.", "ok");
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "Teslim paketi oluşturulamadı.", "error");
    } finally {
      setClosingDay(false);
    }
  }

  const queue = [
    summary.unmatched_photo_count > 0 && {
      key: "unmatched",
      title: `${summary.unmatched_photo_count} eşleşmemiş fotoğraf`,
      detail: "Toplu fotoğraf ekranından yolcuya bağlayın",
      target: "bulk-photos",
      attention: true,
    },
    summary.missing_photo > 0 && {
      key: "fotosuz",
      title: `${summary.missing_photo} fotosuz yolcu`,
      detail: "Kapı listesinde fotoğrafı olmayan kayıtlar",
      target: "passengers-fotosuz",
      attention: true,
    },
    summary.missing_count > 0 && {
      key: "eksik",
      title: `${summary.missing_count} eksik evrak`,
      detail: "Pasaport, voucher veya zorunlu PDF eksik",
      target: "passengers-eksik",
      attention: true,
    },
    urgentTasks.length > 0 && {
      key: "tasks",
      title: `${urgentTasks.length} öncelikli görev`,
      detail: `${openTasks.length} açık görev · iş dosyalarına bakın`,
      target: "work-files",
      attention: true,
    },
    (backupAge === null || backupAge >= 3) && {
      key: "backup",
      title: backupAge === null ? "Henüz şifreli yedek alınmadı" : `Son yedek ${backupAge} gün önce`,
      detail: "Ayarlar → Cihaz ve güvenlik",
      target: "management",
      attention: true,
    },
    summary.passenger_count > 0 && {
      key: "ready",
      title: `${summary.ready_count || Math.max(0, summary.passenger_count - summary.missing_count)} kayıt hazır`,
      detail: `${summary.passenger_count} yolcu · %${summary.readiness_percent} hazırlık`,
      target: "gate-visa-list",
      attention: false,
    },
  ].filter(Boolean) as Array<{ key: string; title: string; detail: string; target: string; attention: boolean }>;

  return (
    <div className="ops-page xb-spatial-home">
      <section className="xb-home-stage" aria-label={`${PRODUCT.shortName} ana ekran`}>
        <div className="xb-home-sys">
          <span className="xb-home-sys-ok">SİSTEM NORMAL</span>
          <span>{todayLabel}</span>
        </div>
        <p className="xb-home-eyebrow">{PRODUCT.partnerLine ? `${PRODUCT.partnerLine} · Operasyon` : "Operasyon"}</p>
        <h1 className="xb-home-stage-brand">{PRODUCT.shortName}</h1>
        <p className="xb-home-stage-title">
          {user.name.split(" ")[0] || "Operatör"} · {PRODUCT.tagline.toLocaleLowerCase("tr-TR")}
        </p>
        <p className="xb-home-stage-copy">
          Veriler bu cihazda şifreli kalır. Kapı listesini açın veya yeni liste yükleyin.
        </p>
        <div className="xb-home-actions-strip">
          <button className="ops-primary" type="button" onClick={() => onNavigate("gate-visa-list")}>
            Kapı listesi
          </button>
          <button className="ops-secondary" type="button" onClick={() => onNavigate("import")}>
            Liste yükle
          </button>
        </div>
      </section>

      {workspaceError && <div className="ops-form-error" role="alert">{workspaceError}</div>}

      <section className="ops-home-desk" aria-labelledby="home-queue-title">
        <div className="ops-section-heading">
          <div>
            <h2 id="home-queue-title">İş sırası</h2>
            <p>Öncelikli işler ve uyarılar</p>
          </div>
        </div>
        {queue.length ? (
          <div className="xb-queue">
            {queue.map((item) => (
              <button
                key={item.key}
                type="button"
                className={item.attention ? "xb-queue-item attention" : "xb-queue-item"}
                onClick={() => onNavigate(item.target)}
              >
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.detail}</small>
                </span>
                <span className="ic-map-arrow" aria-hidden="true">›</span>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState
            title="Bugün açık iş yok"
            body="Yeni bir kapı listesi yükleyin veya bir iş dosyası açın."
            action={(
              <button className="ops-primary" type="button" onClick={() => onNavigate("import")}>
                Liste yükle
              </button>
            )}
          />
        )}
        <div className="ops-home-actions" style={{ marginTop: 4 }}>
          <button className="ops-secondary" type="button" onClick={() => onNavigate("bulk-photos")}>
            Toplu fotoğraf
          </button>
          <button className="ops-secondary" type="button" onClick={() => onNavigate("passport-scan")}>
            MRZ → Excel
          </button>
          <button className="ops-secondary" type="button" disabled={closingDay || !summary.passenger_count} onClick={() => void closeDay()}>
            {closingDay ? "Paketleniyor…" : "Günü kapat"}
          </button>
        </div>
      </section>

      <section className="ops-home-desk">
        <div className="ops-section-heading">
          <div>
            <h2>Aktif iş dosyaları</h2>
            <p>Açık, bekleyen veya bloke kayıtlar</p>
          </div>
          <button className="ops-section-link" type="button" onClick={() => onNavigate("work-files")}>
            Tümünü gör
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
          <EmptyState
            title="Aktif iş dosyası yok"
            body="Bir C kodu veya operasyon başlığıyla başlayın; yolcu, evrak ve görevler aynı dosyada durur."
            action={(
              <button className="ops-primary" type="button" onClick={() => onNavigate("work-files")}>
                İlk işi aç
              </button>
            )}
          />
        )}
      </section>

      <section className="ops-home-desk" aria-labelledby="home-more-title">
        <div className="ops-section-heading">
          <div>
            <h2 id="home-more-title">Satış ve raporlar</h2>
            <p>Özet ve dışa aktarım</p>
          </div>
        </div>
        <div className="ops-home-links">
          <button className="ic-row as-btn compact" type="button" onClick={() => onNavigate("sales")}>
            <div className="ic-row-id">
              <div className="ic-row-copy">
                <p className="ic-row-title">Satış verileri</p>
                <p className="ic-row-meta">Excel satış listesini yükle, filtrele ve özetle</p>
              </div>
            </div>
            <span className="ic-map-arrow" aria-hidden="true">›</span>
          </button>
          <button className="ic-row as-btn compact" type="button" onClick={() => onNavigate("reports")}>
            <div className="ic-row-id">
              <div className="ic-row-copy">
                <p className="ic-row-title">Raporlar</p>
                <p className="ic-row-meta">Günlük özet, kontrol merkezi, arşiv ve çıktılar</p>
              </div>
            </div>
            <span className="ic-map-arrow" aria-hidden="true">›</span>
          </button>
        </div>
      </section>
    </div>
  );
}
