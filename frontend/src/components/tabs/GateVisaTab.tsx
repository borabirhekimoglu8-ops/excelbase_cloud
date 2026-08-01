"use client";

import { useEffect, useMemo, useState } from "react";

import { type RecordFolder, fetchRecordFolders } from "@/lib/api";
import { RecordsTab } from "@/components/tabs/RecordsTab";
import {
  type GateVisaFilter,
  busiestOutstandingDays,
  emptyGateVisaFilter,
  filterGateVisaFolders,
  gateVisaTotals,
} from "@/lib/gateVisaStats";
import { useStore } from "@/lib/store";

type View = "folders" | "stats";

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
  canCreate,
}: {
  onImport: () => void;
  onCreate: () => void;
  canCreate: boolean;
}) {
  const { dateScope, version } = useStore();
  const [view, setView] = useState<View>("folders");
  const [folders, setFolders] = useState<RecordFolder[]>([]);
  const [filter, setFilter] = useState<GateVisaFilter>(emptyGateVisaFilter);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchRecordFolders({ ...dateScope, field: "created" })
      .then((response) => active && setFolders(response.groups))
      .catch(() => active && setFolders([]))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [dateScope, version]);

  const visible = useMemo(() => filterGateVisaFolders(folders, filter), [folders, filter]);
  const totals = useMemo(() => gateVisaTotals(visible), [visible]);
  const outstanding = useMemo(() => busiestOutstandingDays(visible), [visible]);
  const narrowed = visible.length !== folders.length;

  function toggle(key: keyof GateVisaFilter) {
    setFilter((current) => ({ ...current, [key]: !current[key] }));
  }

  return (
    <div className="ic-gatevisa-page">
      {/* Only the upload lives here. Adding a single passenger is already
          offered by the folder view below, and two stacked buttons for it read
          as two different actions. */}
      <section className="ic-gatevisa-actions">
        <button type="button" className="ic-gatevisa-primary" onClick={onImport}>
          <span aria-hidden="true">⇪</span>
          <span>
            <strong>EXCEL İLE LİSTE YÜKLE</strong>
            <small>Gate Visa PAX listesi · ZIP veya Excel</small>
          </span>
        </button>
      </section>

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
          aria-selected={view === "stats"}
          className={view === "stats" ? "active" : ""}
          onClick={() => setView("stats")}
        >
          İSTATİSTİK
        </button>
      </div>

      {view === "stats" && (
        <div className="ic-stats">
          <div className="ic-filter-bar">
            <input
              type="search"
              value={filter.query}
              placeholder="Tarih ara (örn. 2026-07)…"
              aria-label="Klasör tarihinde ara"
              onChange={(event) => setFilter((current) => ({ ...current, query: event.target.value }))}
            />
            <div className="ic-filter-chips">
              <button
                type="button"
                className={filter.onlyIncomplete ? "active" : ""}
                aria-pressed={filter.onlyIncomplete}
                onClick={() => toggle("onlyIncomplete")}
              >
                EKSİĞİ OLAN GÜNLER
              </button>
              <button
                type="button"
                className={filter.onlyMissingPhoto ? "active" : ""}
                aria-pressed={filter.onlyMissingPhoto}
                onClick={() => toggle("onlyMissingPhoto")}
              >
                FOTOĞRAF EKSİK
              </button>
              <button
                type="button"
                className={filter.onlyMissingDocuments ? "active" : ""}
                aria-pressed={filter.onlyMissingDocuments}
                onClick={() => toggle("onlyMissingDocuments")}
              >
                EVRAKSIZ
              </button>
            </div>
            {narrowed && (
              <button
                type="button"
                className="ic-filter-reset"
                onClick={() => setFilter(emptyGateVisaFilter())}
              >
                FİLTREYİ TEMİZLE
              </button>
            )}
          </div>

          <p className="ic-stats-scope">
            {loading
              ? "Klasörler hazırlanıyor…"
              : narrowed
                ? `${visible.length} / ${folders.length} klasör üzerinden hesaplandı.`
                : `${folders.length} klasörün tamamı üzerinden hesaplandı.`}
          </p>

          <div className="ic-stats-card">
            <h4>Operasyon</h4>
            <div className="ic-stats-grid">
              <div><span>YOLCU</span><strong>{totals.passengers}</strong></div>
              <div><span>KLASÖR</span><strong>{totals.folders}</strong></div>
              <div><span>HAZIR</span><strong>{totals.ready}</strong></div>
              <div><span>KALAN</span><strong>{totals.outstanding}</strong></div>
              <div><span>HAZIRLIK</span><strong>%{totals.readinessPercent.toLocaleString("tr-TR")}</strong></div>
              <div><span>FOTOĞRAF</span><strong>%{totals.photoPercent.toLocaleString("tr-TR")}</strong></div>
              <div><span>PDF</span><strong>{totals.documents}</strong></div>
              <div><span>KONTROL</span><strong>{totals.review}</strong></div>
              <div><span>TASLAK</span><strong>{totals.draft}</strong></div>
            </div>
          </div>

          <div className="ic-stats-card">
            <h4>En çok iş kalan günler</h4>
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
          </div>
        </div>
      )}

      {/* The folder list already shows passenger, PDF and photo counts per
          date, so it is reused rather than reimplemented beside it. */}
      {view === "folders" && <RecordsTab onCreate={onCreate} canCreate={canCreate} />}
    </div>
  );
}
