"use client";

import { useEffect, useMemo, useState } from "react";

import { type RecordFolder, fetchRecordFolders } from "@/lib/api";
import { RecordsTab } from "@/components/tabs/RecordsTab";
import { PassengersTab } from "@/components/tabs/PassengersTab";
import { HoloDonut, HoloTrend } from "@/components/charts/Holo";
import {
  busiestOutstandingDays,
  gateVisaTotals,
} from "@/lib/gateVisaStats";
import { useStore } from "@/lib/store";

type View = "folders" | "list" | "stats";

function dayLabel(dateKey: string): string {
  if (!dateKey || dateKey === "Tarihsiz") return "Tarihsiz";
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, (month || 1) - 1, day || 1);
  if (Number.isNaN(date.getTime())) return dateKey;
  return new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short" }).format(date);
}

/**
 * The Gate Visa hub.
 *
 * The pieces already existed but were scattered: bulk Excel upload sat behind
 * the quick-create sheet, and the date folders -- which are where a passenger's
 * PDFs, photos and dates actually live -- were two levels down under Reports.
 * This puts the two things an operator does with a Gate Visa list, load it and
 * look through it, on one screen reachable from the nav, and adds the question
 * the folder list could never answer: where is the work that is still left.
 */
export function GateVisaTab({
  onImport,
  onCreate,
  onBulkPhotos,
  onPassportScan,
  canCreate,
  initialView = "folders",
  initialStatus = "",
}: {
  onImport: () => void;
  onCreate: () => void;
  onBulkPhotos?: () => void;
  onPassportScan?: () => void;
  canCreate: boolean;
  initialView?: View;
  initialStatus?: string;
}) {
  const { dateScope, version } = useStore();
  const [view, setView] = useState<View>(initialView);

  // A deep link ("eksik evrak" from Home, or the result screen after an
  // import) names a view and a status filter together; switching either one
  // without the other would land the operator on the wrong screen.
  useEffect(() => {
    setView(initialView);
  }, [initialView]);
  const [folders, setFolders] = useState<RecordFolder[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchRecordFolders({ ...dateScope, field: "created" })
      .then((folderResponse) => {
        if (!active) return;
        setFolders(folderResponse.groups);
      })
      .catch(() => {
        if (!active) return;
        setFolders([]);
      })
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [dateScope, version]);

  const totals = useMemo(() => gateVisaTotals(folders), [folders]);
  const outstanding = useMemo(() => busiestOutstandingDays(folders), [folders]);

  // Oldest first, so the line reads left to right as time passing. The folder
  // list arrives newest-first, which would draw the trend backwards.
  const trendPoints = useMemo(
    () => [...folders]
      .filter((entry) => entry.date_key && entry.date_key !== "Tarihsiz")
      .sort((a, b) => a.date_key.localeCompare(b.date_key))
      .map((entry) => ({ label: dayLabel(entry.date_key), value: entry.count })),
    [folders],
  );

  const readinessSlices = useMemo(() => [
    { label: "Hazır", value: totals.ready },
    { label: "Kontrol", value: totals.review },
    { label: "Taslak", value: totals.draft },
  ].filter((slice) => slice.value > 0), [totals]);

  return (
    <div className="ic-gatevisa-page">
      {/* Upload actions belong with the folder workspace, not on top of the
          statistics readout — stacking them there buried the numbers. */}
      {view === "folders" && (
        <section className="ic-gatevisa-actions">
          <button type="button" className="ic-gatevisa-primary" onClick={onImport}>
            <span aria-hidden="true">⇪</span>
            <span>
              <strong>Excel ile liste yükle</strong>
              <small>Kapı vizesi listesi · ZIP veya Excel</small>
            </span>
          </button>
          {onBulkPhotos ? (
            <button type="button" className="ic-gatevisa-primary" onClick={onBulkPhotos}>
              <span aria-hidden="true">▣</span>
              <span>
                <strong>Toplu fotoğraf eşleştir</strong>
                <small>Vesikalık / ZIP · isim veya pasaport ile otomatik</small>
              </span>
            </button>
          ) : null}
          {onPassportScan ? (
            <button type="button" className="ic-gatevisa-primary" onClick={onPassportScan}>
              <span aria-hidden="true">▤</span>
              <span>
                <strong>Pasaport JPG → Excel</strong>
                <small>Toplu pasaport fotoğrafından Gate Visa listesi</small>
              </span>
            </button>
          ) : null}
        </section>
      )}

      <div className="ic-subtabs" role="tablist" aria-label="Görünüm">
        <button
          type="button"
          role="tab"
          aria-selected={view === "folders"}
          className={view === "folders" ? "active" : ""}
          onClick={() => setView("folders")}
        >
          KLASÖRLER
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "list"}
          className={view === "list" ? "active" : ""}
          onClick={() => setView("list")}
        >
          YOLCULAR
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "stats"}
          className={view === "stats" ? "active" : ""}
          onClick={() => setView("stats")}
        >
          İSTATİSTİK
        </button>
      </div>

      {view === "list" && <PassengersTab initialStatus={initialStatus} />}

      {view === "stats" && (
        <div className="ic-stats">
          <p className="ic-stats-scope">
            {loading
              ? "Liste hazırlanıyor…"
              : `${folders.length} gün klasörü · ${totals.passengers} yolcu kaydı`}
          </p>

          {/* Four numbers an operator needs at a glance — not every counter. */}
          <div className="ic-stats-hero" aria-label="Operasyon özeti">
            <div><span>YOLCU</span><strong>{totals.passengers}</strong></div>
            <div><span>HAZIR</span><strong>{totals.ready}</strong></div>
            <div><span>KALAN</span><strong>{totals.outstanding}</strong></div>
            <div><span>FOTOĞRAF</span><strong>%{totals.photoPercent.toLocaleString("tr-TR")}</strong></div>
          </div>

          <div className="ic-stats-meta" aria-label="Ek sayılar">
            <span><b>{totals.folders}</b> klasör</span>
            <span><b>{totals.documents}</b> PDF</span>
            <span><b>{totals.review}</b> kontrol</span>
            <span><b>{totals.draft}</b> taslak</span>
            <span><b>%{totals.readinessPercent.toLocaleString("tr-TR")}</b> hazırlık</span>
          </div>

          <section className="ic-stats-section">
            <header className="ic-stats-section-head">
              <h4>Günlük durum</h4>
              <span>Yolcu ve hazırlık</span>
            </header>
            <div className="ic-holo-split">
              <div>
                <p className="ic-holo-caption">Yolcu / gün</p>
                <HoloTrend points={trendPoints} formatValue={(value) => `${value} yolcu`} />
              </div>
              <div>
                <p className="ic-holo-caption">Hazırlık dağılımı</p>
                <HoloDonut
                  slices={readinessSlices}
                  total={totals.passengers}
                  centreLabel="HAZIRLIK"
                  centreValue={`%${totals.readinessPercent.toLocaleString("tr-TR")}`}
                />
              </div>
            </div>
          </section>

          <section className="ic-stats-section">
            <header className="ic-stats-section-head">
              <h4>İş kalan günler</h4>
              <span>Eksik yolcuya göre</span>
            </header>
            {outstanding.length === 0 ? (
              <p className="ic-sales-more">
                {totals.passengers === 0 ? "Bu aralıkta kayıt yok." : "Bu aralıkta eksik kalan yolcu yok."}
              </p>
            ) : (
              <ul className="ic-stats-breakdown">
                {outstanding.map((day) => (
                  <li key={day.dateKey}>
                    <div>
                      <strong>{dayLabel(day.dateKey)}</strong>
                      <span>{day.outstanding} eksik · {day.passengers} yolcu · {day.documents} PDF</span>
                    </div>
                    {/* Bar shows readiness, so a long bar is a good day. */}
                    <div className="ic-stats-bar" aria-hidden="true">
                      <i style={{ width: `${Math.max(2, day.readinessPercent)}%` }} />
                    </div>
                    <b>%{day.readinessPercent.toLocaleString("tr-TR")}</b>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {/* The folder list already shows passenger, PDF and photo counts per
          date, so it is reused rather than reimplemented beside it. */}
      {view === "folders" && <RecordsTab onCreate={onCreate} canCreate={canCreate} />}
    </div>
  );
}
