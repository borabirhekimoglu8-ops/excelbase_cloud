"use client";

import { RecordsTab } from "@/components/tabs/RecordsTab";

/**
 * The Gate Visa hub.
 *
 * The pieces already existed but were scattered: bulk Excel upload sat behind
 * the quick-create sheet, and the date folders -- which are where a passenger's
 * PDFs, photos and dates actually live -- were two levels down under Reports.
 * This puts the two things an operator does with a Gate Visa list, load it and
 * look through it, on one screen reachable from the nav.
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

      {/* The folder list already shows passenger, PDF and photo counts per
          date, so it is reused rather than reimplemented beside it. */}
      <RecordsTab onCreate={onCreate} canCreate={canCreate} />
    </div>
  );
}
