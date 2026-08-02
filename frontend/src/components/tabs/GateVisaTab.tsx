"use client";

import { useEffect, useMemo, useState } from "react";

import { type Passenger, type RecordFolder, fetchPassengers, fetchRecordFolders } from "@/lib/api";
import { RecordsTab } from "@/components/tabs/RecordsTab";
import { ColumnFilterBar, ColumnStatsView } from "@/components/ColumnAnalysis";
import { HoloDonut, HoloTrend } from "@/components/charts/Holo";
import { passengerTable } from "@/lib/passengerTable";
import { type SalesFilter, emptySalesFilter, filterSalesRows } from "@/lib/salesAnalysis";
import {
  busiestOutstandingDays,
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
  const [passengers, setPassengers] = useState<Passenger[]>([]);
  const [filter, setFilter] = useState<SalesFilter>(emptySalesFilter);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      fetchRecordFolders({ ...dateScope, field: "created" }),
      fetchPassengers({ scope: dateScope }),
    ])
      .then(([folderResponse, passengerRows]) => {
        if (!active) return;
        setFolders(folderResponse.groups);
        setPassengers(passengerRows);
      })
      .catch(() => {
        if (!active) return;
        setFolders([]);
        setPassengers([]);
      })
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [dateScope, version]);

  // The passenger list is the Gate Visa Excel, projected back into columns, so
  // the same filters and statistics work here as on the sales page.
  const table = useMemo(() => passengerTable(passengers), [passengers]);
  const rows = useMemo(() => filterSalesRows(table, filter), [table, filter]);
  const narrowed = rows.length !== table.rows.length;

  // Folder totals still come from the folders themselves; they count days,
  // which the passenger rows cannot.
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
          <ColumnFilterBar
            table={table}
            filter={filter}
            onChange={setFilter}
            onReset={() => setFilter(emptySalesFilter())}
            narrowed={narrowed}
            searchLabel="Yolcu listesinde ara…"
          />

          <p className="ic-stats-scope">
            {loading
              ? "Liste hazırlanıyor…"
              : `${folders.length} gün klasörü · ${table.rows.length} yolcu kaydı`}
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

          <div className="ic-stats-card">
            <h4>Günlük eğilim</h4>
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
          </div>

          {/* Every Gate Visa column, filtered the same way the list is. */}
          <ColumnStatsView table={table} rows={rows} narrowed={narrowed} />
        </div>
      )}

      {/* The folder list already shows passenger, PDF and photo counts per
          date, so it is reused rather than reimplemented beside it. */}
      {view === "folders" && <RecordsTab onCreate={onCreate} canCreate={canCreate} />}
    </div>
  );
}
