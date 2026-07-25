export const COMPLETE_DOCUMENT_CATEGORY = "complete_bundle" as const;

export const DOCUMENT_CATEGORIES = [
  COMPLETE_DOCUMENT_CATEGORY,
  "passport",
  "application_form",
  "hotel",
  "ferry",
  "insurance",
  "bank",
  "other",
] as const;

export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export const REQUIRED_DOCUMENT_CATEGORIES: readonly DocumentCategory[] = [
  "passport",
  "application_form",
];

export const DOCUMENT_CATEGORY_LABELS: Record<DocumentCategory, string> = {
  complete_bundle: "Tek birleşik evrak PDF'i",
  passport: "Pasaport",
  application_form: "Başvuru formu",
  hotel: "Otel rezervasyonu",
  ferry: "Feribot bileti",
  insurance: "Seyahat sigortası",
  bank: "Banka / finansal evrak",
  other: "Diğer evrak",
};

export function hasRequiredDocumentCoverage(
  documents: ReadonlyArray<{ category?: DocumentCategory }>,
): boolean {
  const categories = new Set(documents.map((document) => document.category ?? "other"));
  return categories.has(COMPLETE_DOCUMENT_CATEGORY)
    || REQUIRED_DOCUMENT_CATEGORIES.every((category) => categories.has(category));
}
