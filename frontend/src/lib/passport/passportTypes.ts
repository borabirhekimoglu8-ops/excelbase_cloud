import { icaoCountryToIso2, isSpecialNationality } from "./icaoCountries";

export const PASSPORT_SCHEMA_VERSION = 2 as const;
export const DOCUMENT_TYPES = ["Passport", "ID CARD"] as const;

export type PassportDocumentType = (typeof DOCUMENT_TYPES)[number];
export type PassportScanStatus = "ok" | "weak" | "failed";
export type PassportReviewStatus = "verified" | "needs_review" | "reviewed" | "failed";
export type PassportFieldName =
  | "firstName"
  | "lastName"
  | "passportNo"
  | "nationality"
  | "birthDate"
  | "sex"
  | "expiryDate"
  | "tcNo";
export type FieldVerification = "mrz_verified" | "visual_draft" | "operator_reviewed";

export type SourceRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type FieldProvenance = {
  source: "mrz" | "viz" | "operator";
  verification: FieldVerification;
  pageNo: number;
  rect?: SourceRect;
};

export type PassportFailureStage =
  | "text_detection"
  | "character_recognition"
  | "mrz_parser"
  | "field_matching";

export type PassportScanRow = {
  schema_version: typeof PASSPORT_SCHEMA_VERSION;
  id: string;
  filename: string;
  previewUrl: string;
  batchId: string;
  pageNo: number;
  firstName: string;
  lastName: string;
  passportNo: string;
  /** Derived display/export value. The source of truth is nationality. */
  countryCode2: string;
  nationality: string;
  nationalitySpecial: boolean;
  issuingState: string;
  birthDate: string;
  sex: string;
  expiryDate: string;
  tcNo: string;
  documentType: PassportDocumentType;
  status: PassportScanStatus;
  reviewStatus: PassportReviewStatus;
  provenance: Partial<Record<PassportFieldName, FieldProvenance>>;
  warnings: string[];
  mrzLine1: string;
  mrzLine2: string;
  mrzCropUrl?: string;
  rawLines?: string[];
  sourceImageKey?: string;
  failureStage?: PassportFailureStage;
};

export function deriveReviewStatus(
  input: Pick<PassportScanRow, "status" | "provenance">,
  operatorReviewed = false,
): PassportReviewStatus {
  if (operatorReviewed) return "reviewed";
  if (input.status === "failed" && Object.keys(input.provenance).length === 0) return "failed";
  const values = Object.values(input.provenance);
  return input.status === "ok" && values.length > 0
    && values.every((item) => item?.verification === "mrz_verified")
    ? "verified"
    : "needs_review";
}

/** Excel country is derived from MRZ nationality, never from issuing state. */
export function countryCode2ForRow(row: Pick<PassportScanRow, "nationality">): string {
  return icaoCountryToIso2(row.nationality);
}

export function rowReady(row: PassportScanRow): boolean {
  return (row.reviewStatus === "verified" || row.reviewStatus === "reviewed")
    && Boolean(
      row.firstName.trim()
      && row.lastName.trim()
      && row.passportNo.trim()
      && countryCode2ForRow(row).length === 2
      && row.birthDate.trim()
      && row.expiryDate.trim()
      && row.documentType,
    )
    && !isSpecialNationality(row.nationality);
}
