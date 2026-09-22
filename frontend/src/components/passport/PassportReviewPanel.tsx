"use client";

import { DOCUMENT_TYPES, type PassportDocumentType } from "@/lib/passport/parseMrzText";
import type { PassportCandidate, PassportFieldName } from "@/lib/passport/candidates";
import { requiredComplete } from "@/lib/passport/candidates";
import { PassportPageViewer } from "./PassportPageViewer";

const STATUS_LABEL: Record<string, string> = {
  processing: "İşleniyor",
  review: "Kontrol bekliyor",
  conflict: "Eksik veya çelişkili",
  "user-approved": "Kullanıcı onaylı",
  rejected: "Reddedildi",
};

export function PassportReviewPanel({
  candidates,
  focusId,
  focusField,
  pageImage,
  pageSize,
  onFocus,
  onPatch,
  onApprove,
  onReject,
  onNextIssue,
}: {
  candidates: PassportCandidate[];
  focusId: string;
  focusField: PassportFieldName | null;
  pageImage: string;
  pageSize: { width: number; height: number } | null;
  onFocus: (id: string, field: PassportFieldName) => void;
  onPatch: (id: string, field: PassportFieldName, value: string) => void;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onNextIssue: () => void;
}) {
  const active = candidates.find((item) => item.id === focusId) ?? candidates[0];
  const focusValue = active && focusField ? active.fields[focusField] : null;

  return (
    <div className="xb-passport-review">
      <div className="xb-passport-split">
        {pageImage ? (
          <PassportPageViewer
            imageUrl={pageImage}
            width={pageSize?.width ?? 0}
            height={pageSize?.height ?? 0}
            focus={focusValue}
          />
        ) : (
          <div className="xb-passport-page xb-passport-page-empty">Kaynak görüntü yok</div>
        )}
        <ul className="xb-passport-rows">
          {candidates.map((row) => {
            const ready = requiredComplete(row.fields);
            const display = row.status === "user-approved" ? "user-approved" : row.status === "conflict" ? "conflict" : row.auto_pass ? "review" : row.status;
            return (
              <li key={row.id} data-status={display} data-auto-pass={row.auto_pass ? "1" : "0"}>
                <div className="xb-passport-thumb" aria-label={STATUS_LABEL[row.status] ?? row.status}>
                  <strong aria-hidden="true">{row.status === "user-approved" ? "✓" : row.status === "conflict" ? "≠" : "!"}</strong>
                  <span>{STATUS_LABEL[row.status] ?? "Kontrol"}</span>
                </div>
                <div className="xb-passport-fields">
                  <label>
                    <span>Yolcu Adı</span>
                    <input
                      value={row.fields.givenNames.normalized}
                      onFocus={() => onFocus(row.id, "givenNames")}
                      onChange={(event) => onPatch(row.id, "givenNames", event.target.value)}
                      autoCapitalize="characters"
                    />
                  </label>
                  <label>
                    <span>Yolcu Soyadı</span>
                    <input
                      value={row.fields.surname.normalized}
                      onFocus={() => onFocus(row.id, "surname")}
                      onChange={(event) => onPatch(row.id, "surname", event.target.value)}
                      autoCapitalize="characters"
                    />
                  </label>
                  <label>
                    <span>Pasaport No</span>
                    <input
                      value={row.fields.passportNo.normalized}
                      onFocus={() => onFocus(row.id, "passportNo")}
                      onChange={(event) => onPatch(row.id, "passportNo", event.target.value)}
                      autoCapitalize="characters"
                      autoCorrect="off"
                    />
                  </label>
                  <label>
                    <span>Ülke Kodu 2</span>
                    <input
                      value={row.fields.countryCode2.normalized}
                      maxLength={2}
                      onFocus={() => onFocus(row.id, "countryCode2")}
                      onChange={(event) => onPatch(row.id, "countryCode2", event.target.value)}
                      autoCapitalize="characters"
                      autoCorrect="off"
                      spellCheck={false}
                    />
                  </label>
                  <label>
                    <span>TC.No</span>
                    <input
                      value={row.fields.tcNo.normalized}
                      inputMode="numeric"
                      maxLength={11}
                      onFocus={() => onFocus(row.id, "tcNo")}
                      onChange={(event) => onPatch(row.id, "tcNo", event.target.value)}
                      autoComplete="off"
                    />
                  </label>
                  <label>
                    <span>Doğum Tarihi</span>
                    <input
                      type="date"
                      value={row.fields.birthDate.normalized}
                      onFocus={() => onFocus(row.id, "birthDate")}
                      onChange={(event) => onPatch(row.id, "birthDate", event.target.value)}
                    />
                  </label>
                  <label>
                    <span>Pasaport Bitiş Tar.</span>
                    <input
                      type="date"
                      value={row.fields.expiryDate.normalized}
                      onFocus={() => onFocus(row.id, "expiryDate")}
                      onChange={(event) => onPatch(row.id, "expiryDate", event.target.value)}
                    />
                  </label>
                  <label>
                    <span>Cinsiyet</span>
                    <input
                      value={row.fields.sex.normalized}
                      onFocus={() => onFocus(row.id, "sex")}
                      onChange={(event) => onPatch(row.id, "sex", event.target.value)}
                    />
                  </label>
                  <label>
                    <span>Doküman Tipi</span>
                    <select
                      value={row.fields.documentType.normalized || "Passport"}
                      onFocus={() => onFocus(row.id, "documentType")}
                      onChange={(event) => onPatch(row.id, "documentType", event.target.value as PassportDocumentType)}
                    >
                      {DOCUMENT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                    </select>
                  </label>
                  <p className="xb-passport-meta">
                    {row.auto_pass ? "Otomatik kontroller geçti · onay sizde" : ""}
                    {row.possible_duplicate_of.length ? " · Olası tekrar" : ""}
                    {row.mrz?.warnings[0] ? ` · ${row.mrz.warnings[0]}` : ""}
                    {row.fields.passportNo.engine_score != null ? ` · motor skoru ${row.fields.passportNo.engine_score.toFixed(2)}` : ""}
                  </p>
                  {row.visual_hints.length && row.status === "conflict" ? (
                    <p className="xb-passport-meta">Üst alan ile MRZ çelişiyor; sessiz seçim yapılmadı.</p>
                  ) : null}
                  {row.mrz && row.status !== "user-approved" ? (
                    <details className="xb-passport-debug">
                      <summary>MRZ ayrıntısı</summary>
                      <div><code>{`${row.mrz.line1}\n${row.mrz.line2}`}</code></div>
                    </details>
                  ) : null}
                  <div className="xb-passport-row-actions">
                    <button
                      type="button"
                      className="primary"
                      disabled={!ready || row.status === "user-approved"}
                      onClick={() => onApprove(row.id)}
                    >
                      Satırı onayla
                    </button>
                    <button type="button" className="danger" onClick={() => onReject(row.id)} aria-label="Satırı sil">Sil</button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
      <button type="button" onClick={onNextIssue}>Sonraki sorunlu alan</button>
    </div>
  );
}
