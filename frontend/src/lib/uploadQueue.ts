"use client";

export class UnreadableUploadFileError extends Error {}

function unreadableMessage(name: string): string {
  return `${name || "Dosya"}: dosya içeriği telefondan okunamadı. Dosyayı yeniden seçin.`;
}

// iOS Safari, dosya seçici kapandıktan sonra File nesnesinin baytlarını
// kaybedebildiği için içerik seçim anında belleğe kopyalanır.
export async function materializeUploadFile(source: File): Promise<File> {
  let bytes: ArrayBuffer;
  try {
    bytes = await source.arrayBuffer();
  } catch {
    throw new UnreadableUploadFileError(unreadableMessage(source.name));
  }
  if (bytes.byteLength === 0) {
    throw new UnreadableUploadFileError(unreadableMessage(source.name));
  }
  return new File([bytes], source.name, {
    type: source.type || "application/octet-stream",
    lastModified: source.lastModified || Date.now(),
  });
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
