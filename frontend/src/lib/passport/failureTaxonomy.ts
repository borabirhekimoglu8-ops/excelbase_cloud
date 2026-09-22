import type { PassportFailureStage } from "./passportTypes";

export const PASSPORT_FAILURE_STAGES: readonly PassportFailureStage[] = [
  "text_detection",
  "character_recognition",
  "mrz_parser",
  "field_matching",
];

export const TRANSIENT_OCR_CODES = [
  "engine_load_failed",
  "engine_crashed",
  "engine_timeout",
  "image_undecodable",
] as const;

export type TransientOcrCode = (typeof TRANSIENT_OCR_CODES)[number];
export type PassportFailureCode =
  | TransientOcrCode
  | "mrz_not_found"
  | "mrz_invalid"
  | "fields_not_unique";

export type PassportFailure = {
  stage: PassportFailureStage;
  code: PassportFailureCode;
  message: string;
  transient: boolean;
};

export function isTransientOcrCode(code: string): code is TransientOcrCode {
  return (TRANSIENT_OCR_CODES as readonly string[]).includes(code);
}

export function passportFailure(
  stage: PassportFailureStage,
  code: PassportFailureCode,
  message: string,
): PassportFailure {
  return { stage, code, message, transient: isTransientOcrCode(code) };
}

export function operatorFailureMessage(failure: PassportFailure): string {
  if (failure.transient) return "Görüntü işleme geçici olarak durdu. Sayfa sırada yeniden denenecek.";
  if (failure.stage === "text_detection") return "Pasaport metin alanı bulunamadı.";
  if (failure.stage === "character_recognition") return "Metin yeterli güvenle okunamadı.";
  if (failure.stage === "mrz_parser") return "MRZ satırları doğrulanamadı; görsel alanlar taslak olarak gösteriliyor.";
  return failure.message || "Alanlar tek çözümle eşleştirilemedi; operatör kontrolü gerekli.";
}
