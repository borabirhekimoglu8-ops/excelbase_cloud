"use client";

function errorDetail(error: unknown): string {
  if (error instanceof DOMException) return `${error.name}: ${error.message}`;
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

export class UnreadableUploadFileError extends Error {
  readonly fileName: string;
  readonly originalError?: unknown;

  constructor(fileName: string, detail?: string, originalError?: unknown) {
    super(
      `${fileName || "Dosya"}: dosya içeriği telefondan okunamadı${detail ? ` (${detail})` : ""}. Dosyayı yeniden seçin.`,
    );
    this.name = "UnreadableUploadFileError";
    this.fileName = fileName;
    this.originalError = originalError;
  }
}

// Yolcu listeleri ve ZIP arşivleri için File nesnesini başka bir ArrayBuffer'a
// kopyalamayız. Özellikle iPhone/iCloud'da özgün File tutamacının, onu üreten
// input hâlâ doluyken doğrudan FormData'ya eklenmesi gerekir.
export function assertOriginalUploadFile(source: File): void {
  const filename = (source as File | undefined)?.name || "Dosya";
  if (!(source instanceof Blob)) {
    throw new UnreadableUploadFileError(filename, "geçerli bir dosya tutamacı değil");
  }
  if (source.size <= 0) {
    throw new UnreadableUploadFileError(filename, "dosya 0 bayt");
  }
}

const ICLOUD_READ_RETRY_DELAYS_MS = [0, 350, 1_200];
const ICLOUD_READ_TIMEOUT_MS = 8_000;

// Bazı iOS dosya sağlayıcılarında (iCloud Drive/Fotoğraflar, özellikle onlarca
// dosya birden seçildiğinde) arrayBuffer() ne çözülür ne reddedilir; sonsuza
// dek asılı kalır. Zaman aşımı olmadan bu, tüm toplu seçimi kalıcı olarak
// kilitlerdi. Yarışan bir zaman aşımıyla bu denemeyi başarısız sayıp bir
// sonraki denemeye geçeriz.
function readArrayBufferWithTimeout(source: File, timeoutMs: number): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = globalThis.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("dosya okuma zaman aşımına uğradı"));
    }, timeoutMs);
    source
      .arrayBuffer()
      .then((bytes) => {
        if (settled) return;
        settled = true;
        globalThis.clearTimeout(timer);
        resolve(bytes);
      })
      .catch((error) => {
        if (settled) return;
        settled = true;
        globalThis.clearTimeout(timer);
        reject(error);
      });
  });
}

// iCloud/Files sağlayıcısı çoklu seçimden sonra bazı dosyaları birkaç yüz
// milisaniye gecikmeyle hazır edebilir. İlk 0 bayt/okuma hatasında dosyayı
// kayıp saymak yerine kısa aralıklarla tekrar deneriz.
export async function materializeUploadFile(source: File): Promise<File> {
  let lastError: unknown;
  for (const delay of ICLOUD_READ_RETRY_DELAYS_MS) {
    if (delay) await new Promise((resolve) => globalThis.setTimeout(resolve, delay));
    try {
      const bytes = await readArrayBufferWithTimeout(source, ICLOUD_READ_TIMEOUT_MS);
      if (bytes.byteLength > 0) {
        return new File([bytes], source.name, {
          type: source.type || "application/octet-stream",
          lastModified: source.lastModified || Date.now(),
        });
      }
    } catch (error) {
      lastError = error;
      // Sonraki denemede iCloud dosya tutamacı yeniden okunur.
    }
  }
  throw new UnreadableUploadFileError(
    source.name,
    lastError ? errorDetail(lastError) : "dosya boş",
    lastError,
  );
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
