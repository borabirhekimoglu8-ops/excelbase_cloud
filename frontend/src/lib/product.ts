/**
 * Ürün kimliği — tek kaynak.
 *
 * Uygulama görünen adını değiştirmek için yalnız bu dosyayı güncelleyin.
 * Ekranlara, manifest’e ve auth kopyasına buradan aktarılır.
 * İleride marka değişince (ör. Operon) buradaki alanlar yeterlidir;
 * her dosyada string avı gerekmez.
 */

export const PRODUCT = {
  /** Kısa marka (üst çubuk, kilit ekranı). */
  shortName: "Excelbase",
  /** Tam uygulama adı (PWA, başlık, kurulum). */
  fullName: "Excelbase Operations",
  /** Ortak çalışma bağlamı satırı (İDO vb.). Boş bırakılabilir. */
  partnerLine: "İDO",
  /** Kısa alt başlık (üst çubuk / kilit). */
  tagline: "Uzamsal köprü",
  /** Uzun açıklama (manifest / meta). */
  description:
    "İş dosyaları, yolcular, evraklar, raporlar ve kapı vizesi süreçleri için çevrimdışı operasyon merkezi.",
  /** Belge / sekme başlığı soneki. */
  documentTitle: "Operasyon ve evrak merkezi",
  /** PWA tema — uzamsal köprü kabuğu ile uyumlu. */
  themeColor: "#0b1219",
  backgroundColor: "#0b1219",
} as const;

export type ProductIdentity = typeof PRODUCT;

/** Üst çubuk / ANA marka satırı: "Excelbase · İDO" veya yalnız kısa ad. */
export function productBrandLine(): string {
  const partner = PRODUCT.partnerLine.trim();
  return partner ? `${PRODUCT.shortName} · ${partner}` : PRODUCT.shortName;
}

export function productAssistantLabel(): string {
  return `${PRODUCT.shortName} Asistanı`;
}

export function productAssistantOpenLabel(): string {
  return `${PRODUCT.shortName} Asistanını aç`;
}

export function productWindowTitle(): string {
  return `${PRODUCT.fullName} · ${PRODUCT.documentTitle}`;
}
