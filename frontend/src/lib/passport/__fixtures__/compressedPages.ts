import { PASSPORT_ENGINE_PROFILE } from "../engineProfile";
import type { PassportFailureStage } from "../passportTypes";

export type CompressedPageDiagnostic = {
  pageNo: number;
  sha256: string;
  profileId: string;
  success: boolean;
  stages: PassportFailureStage[];
  finalStage?: PassportFailureStage;
  reason: string;
};

/** Fixed synthetic diagnostic manifest. It records observations; it does not claim OCR success. */
export const COMPRESSED_PAGE_DIAGNOSTICS: readonly CompressedPageDiagnostic[] = Object.freeze([
  {
    pageNo: 1,
    sha256: "1088e9fd5c94292f7167c5f5cd6208158f2694158ece657f65824eb65373d62b",
    profileId: PASSPORT_ENGINE_PROFILE.id,
    success: true,
    stages: [],
    reason: "MRZ bandı ve iki 44 hücreli satır tek çözümle doğrulandı.",
  },
  {
    pageNo: 2,
    sha256: "4af6376ff5cb0e6306284c302122227fe70d3e166c38d2b27cc2fa93b935de68",
    profileId: PASSPORT_ENGINE_PROFILE.id,
    success: true,
    stages: [],
    reason: "Döndürülmüş sayfa yönü düzeltildi; kontrol basamakları doğrulandı.",
  },
  {
    pageNo: 3,
    sha256: "e921265f18db10eefa490de1f34463442614aa49c0b55a8125eef70243c5f4ad",
    profileId: PASSPORT_ENGINE_PROFILE.id,
    success: false,
    stages: ["mrz_parser", "field_matching"],
    finalStage: "field_matching",
    reason: "Ad ve soyad tek çözümle doğrulanamadı",
  },
  {
    pageNo: 4,
    sha256: "329948b080e5759b819797ec946947d7280a203738793befcdf560e9a80b0352",
    profileId: PASSPORT_ENGINE_PROFILE.id,
    success: false,
    stages: ["text_detection"],
    finalStage: "text_detection",
    reason: "Sıkıştırma sonrası MRZ bandı ayırt edilemedi.",
  },
  {
    pageNo: 5,
    sha256: "0a561d03eb535e97a85ee449b17f426b529546d434e279e1491d7f0a910b2b42",
    profileId: PASSPORT_ENGINE_PROFILE.id,
    success: false,
    stages: ["character_recognition"],
    finalStage: "character_recognition",
    reason: "Karakter kutuları 44 hücreli ızgaraya güvenle oturmadı.",
  },
]);
