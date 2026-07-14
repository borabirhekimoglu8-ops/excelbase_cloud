"use client";

export class UnreadableUploadFileError extends Error {}

function unreadableMessage(name: string): string {
  return `${name || "Dosya"}: dosya içeriği telefondan okunamadı. Dosyayı yeniden seçin.`;
}

const ICLOUD_READ_RETRY_DELAYS_MS = [0, 350, 1_200];

// iCloud/Files sağlayıcısı çoklu seçimden sonra bazı dosyaları birkaç yüz
// milisaniye gecikmeyle hazır edebilir. İlk 0 bayt/okuma hatasında dosyayı
// kayıp saymak yerine kısa aralıklarla tekrar deneriz.
export async function materializeUploadFile(source: File): Promise<File> {
  for (const delay of ICLOUD_READ_RETRY_DELAYS_MS) {
    if (delay) await new Promise((resolve) => globalThis.setTimeout(resolve, delay));
    try {
      const bytes = await source.arrayBuffer();
      if (bytes.byteLength > 0) {
        return new File([bytes], source.name, {
          type: source.type || "application/octet-stream",
          lastModified: source.lastModified || Date.now(),
        });
      }
    } catch {
      // Sonraki denemede iCloud dosya tutamacı yeniden okunur.
    }
  }
  throw new UnreadableUploadFileError(unreadableMessage(source.name));
}

// Eski sürümler seçilen dosyaları IndexedDB'de bekletip açılışta kendiliğinden
// yeniden aktarıyordu; bozuk kayıtlar tekrar tekrar canlanıyordu. Kuyruk
// kaldırıldı; eski kayıtların bir daha yüklenmemesi için veritabanı silinir.
export function purgeLegacyUploadQueue(): void {
  try {
    indexedDB.deleteDatabase("gatevisa-upload-queue");
  } catch {
    // Depolamaya erişilemiyorsa sorun yok: kuyruk zaten kullanılmıyor.
  }
}
