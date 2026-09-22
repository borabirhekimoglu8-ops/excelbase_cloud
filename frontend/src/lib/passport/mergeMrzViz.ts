import type { PassportScanRow, PassportFieldName } from "./passportTypes";
import type { VizExtraction } from "./vizFields";

export type MrzVizMerge = {
  row: PassportScanRow;
  mismatchFields: PassportFieldName[];
};

const FIELDS: PassportFieldName[] = [
  "firstName",
  "lastName",
  "passportNo",
  "birthDate",
  "expiryDate",
];

function comparable(value: string): string {
  return value.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** MRZ values always win. VIZ can only fill a blank and remains a draft. */
export function mergeMrzViz(row: PassportScanRow, viz: VizExtraction): MrzVizMerge {
  const merged: PassportScanRow = {
    ...row,
    provenance: { ...row.provenance },
    warnings: [...row.warnings],
  };
  const mismatchFields: PassportFieldName[] = [];

  for (const field of FIELDS) {
    const draft = viz[field];
    if (!draft) continue;
    const current = merged[field];
    if (current) {
      if (comparable(current) !== comparable(draft.value)) mismatchFields.push(field);
      continue;
    }
    merged[field] = draft.value;
    merged.provenance[field] = draft.provenance;
  }

  if (mismatchFields.length) {
    merged.warnings.push(`MRZ ve görsel alan uyuşmazlığı: ${mismatchFields.join(", ")}`);
  }
  if (viz.nationalityHint) {
    merged.warnings.push(`Görsel uyruk ipucu: ${viz.nationalityHint.value} — otomatik ülke koduna çevrilmedi`);
  }
  if (Object.values(merged.provenance).some((item) => item?.verification === "visual_draft")) {
    merged.status = "weak";
    merged.reviewStatus = "needs_review";
  }
  return { row: merged, mismatchFields };
}
