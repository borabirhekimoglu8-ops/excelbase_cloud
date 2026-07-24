"use client";

import type { WorkFile, WorkFilePriority, WorkFileStatus } from "@/lib/workspace";

const STATUS_LABELS: Record<WorkFileStatus, string> = {
  open: "AÇIK",
  waiting: "BEKLİYOR",
  blocked: "ENGELLİ",
  done: "TAMAMLANDI",
  archived: "ARŞİV",
};

const PRIORITY_LABELS: Record<WorkFilePriority, string> = {
  low: "DÜŞÜK",
  normal: "NORMAL",
  high: "YÜKSEK",
  urgent: "ACİL",
};

function dateLabel(value: string): string {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return value || "Tarih yok";
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

function localIsoDate(date = new Date()): string {
  return [
    String(date.getFullYear()).padStart(4, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

type WorkFileCardProps = {
  workFile: WorkFile;
  onOpen: (id: string) => void;
  documentCount?: number;
  taskCount?: number;
  nextAction?: string;
};

export function WorkFileCard({
  workFile,
  onOpen,
  documentCount = 0,
  taskCount = 0,
  nextAction,
}: WorkFileCardProps) {
  const passengerCount = workFile.passenger_record_uids.length;
  const closed = workFile.status === "done" || workFile.status === "archived";
  const overdue = Boolean(workFile.due_date && !closed && workFile.due_date < localIsoDate());
  const title = workFile.title || "İsimsiz iş dosyası";
  const fileNumber = workFile.file_no || "KODSUZ";
  const context = [workFile.company, workFile.route].filter(Boolean);
  if (!context.length) context.push(...[workFile.category || "Genel iş", workFile.owner].filter(Boolean));

  return (
    <article
      className={`operations-work-card status-${workFile.status}${overdue ? " is-overdue" : ""}`}
      data-testid={`work-file-card-${workFile.id}`}
    >
      <button
        className="operations-work-card-main"
        type="button"
        aria-label={`${fileNumber} · ${title} iş dosyasını aç`}
        onClick={() => onOpen(workFile.id)}
      >
        <span className="operations-work-card-topline">
          <span className="operations-work-code">{fileNumber}</span>
          <span className={`operations-work-status status-${workFile.status}`}>
            {STATUS_LABELS[workFile.status]}
          </span>
        </span>

        <span className="operations-work-card-copy">
          <strong>{title}</strong>
          <small>{context.join(" · ")}</small>
        </span>

        <span className="operations-work-card-metrics" aria-label="İş dosyası özeti">
          <span><b>{passengerCount}</b> yolcu</span>
          <span><b>{documentCount}</b> evrak</span>
          <span><b>{taskCount}</b> görev</span>
        </span>

        <span className="operations-work-card-footer">
          <span className={`operations-work-priority priority-${workFile.priority}`}>
            {PRIORITY_LABELS[workFile.priority]}
          </span>
          <span className={overdue ? "operations-work-due overdue" : "operations-work-due"}>
            {workFile.due_date
              ? `${overdue ? "Gecikti" : "Son tarih"} · ${dateLabel(workFile.due_date)}`
              : "Son tarih belirlenmedi"}
          </span>
        </span>

        {nextAction ? (
          <span className="operations-work-next">
            <small>SONRAKİ ADIM</small>
            <strong>{nextAction}</strong>
          </span>
        ) : null}
      </button>
    </article>
  );
}
