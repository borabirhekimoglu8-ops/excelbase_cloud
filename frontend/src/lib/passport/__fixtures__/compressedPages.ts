import { PASSPORT_ENGINE_PROFILE } from "../engineProfile";
import type { PassportFailureStage } from "../passportTypes";

export type CompressedPageDiagnostic = {
  pageNo: number;
  filename: string;
  sha256: string;
  profileId: string;
  success: boolean;
  stages: PassportFailureStage[];
  finalStage?: PassportFailureStage;
  reason: string;
};

/**
 * Fixed synthetic WhatsApp-compressed page set.
 *
 * Original operator WhatsApp PDFs were not in the repository, so this is the
 * reproducible stand-in: the same five files, hashes and engine profile are
 * recorded. It does not invent OCR success on unseen bytes.
 */
export const COMPRESSED_PAGE_DIAGNOSTICS: readonly CompressedPageDiagnostic[] = Object.freeze([
  {
    pageNo: 1,
    filename: "page-1.mrz.txt",
    sha256: "a8a51a9765fe6563264d89475f38e1433dd33974b2886b11bda73035d4fcc7d2",
    profileId: PASSPORT_ENGINE_PROFILE.id,
    success: true,
    stages: [],
    reason: "MRZ bandı ve iki 44 hücreli satır tek çözümle doğrulandı.",
  },
  {
    pageNo: 2,
    filename: "page-2.mrz.txt",
    sha256: "f6bb7d8acf9aeadcd0da3881d3328bc3b639822f78f5425905797bd9748f99fb",
    profileId: PASSPORT_ENGINE_PROFILE.id,
    success: true,
    stages: [],
    reason: "Döndürülmüş sayfa yönü düzeltildi; kontrol basamakları doğrulandı.",
  },
  {
    pageNo: 3,
    filename: "page-3.name-line.txt",
    sha256: "a74691bbe8918800d91cb98287981ce5fbfb3f04983cefc16bd527e983b8a9a7",
    profileId: PASSPORT_ENGINE_PROFILE.id,
    success: false,
    stages: ["mrz_parser", "field_matching"],
    finalStage: "field_matching",
    reason: "Ad ve soyad tek çözümle doğrulanamadı",
  },
  {
    pageNo: 4,
    filename: "page-4.no-band.txt",
    sha256: "bed8f3d209fc375b29a9b3c98a38a4a96bc5fc6cff52070e5e22d2ef3949acb8",
    profileId: PASSPORT_ENGINE_PROFILE.id,
    success: false,
    stages: ["text_detection"],
    finalStage: "text_detection",
    reason: "Sıkıştırma sonrası MRZ bandı ayırt edilemedi.",
  },
  {
    pageNo: 5,
    filename: "page-5.grid-fail.txt",
    sha256: "00c2d409314dcde75c840fe6e7043ddd8f181607bec79e6c92574af5a8fe950b",
    profileId: PASSPORT_ENGINE_PROFILE.id,
    success: false,
    stages: ["character_recognition"],
    finalStage: "character_recognition",
    reason: "Karakter kutuları 44 hücreli ızgaraya güvenle oturmadı.",
  },
]);
