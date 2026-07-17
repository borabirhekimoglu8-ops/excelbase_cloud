import type { DateScope } from "@/lib/api";
import {
  createDeliveryZipBlob,
  createDocumentsZipBlob,
  createGateVisaTemplateXlsxBlob,
  createIdoDailyPassengerListHtmlBlob,
  createManifestHtmlBlob,
  createPassengerCsvBlob,
  createPassengerXlsxBlob,
  createPhotosZipBlob,
  createRecordFolderZipBlob,
  saveBlob,
} from "./exporter";
import {
  localExportEncryptedBackup,
  localExportDocuments,
  localExportPhotos,
  localExportRows,
  localPassengerDocumentFile,
} from "./localApi";

export type LocalDownloadKind = "template" | "excel" | "csv" | "manifest" | "daily-list" | "photos" | "documents" | "package" | "record-package" | "backup";

export type LocalDownloadOptions = {
  scope?: DateScope;
  ids?: number[];
  title?: string;
  recordDate?: string;
};

function stamp(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function reportDates(rows: ReadonlyArray<{ departure_date?: string }>): string[] {
  return ([...new Set(rows.map((row) => row.departure_date?.trim()).filter(Boolean))] as string[]).sort();
}

function reportDate(rows: ReadonlyArray<{ departure_date?: string }>): string {
  const dates = reportDates(rows);
  return dates.length === 1 ? dates[0] : stamp();
}

function reportLabel(rows: ReadonlyArray<{ departure_date?: string }>): string {
  const dates = reportDates(rows);
  if (!dates.length) return "Tarihsiz";
  return dates.length === 1 ? dates[0] : `${dates[0]} – ${dates.at(-1)}`;
}

function selectedRecordDate(rows: ReadonlyArray<{ record_date?: string }>, preferred = ""): string {
  const explicit = preferred.trim();
  if (explicit === "Tarihsiz") return "Tarihsiz";
  if (/^\d{4}-\d{2}-\d{2}$/.test(explicit)) return explicit;
  const dates = ([...new Set(rows.map((row) => row.record_date?.trim()).filter(Boolean))] as string[]).sort();
  return dates.length === 1 && /^\d{4}-\d{2}-\d{2}$/.test(dates[0]) ? dates[0] : stamp();
}

async function loadIdoLogoDataUrl(): Promise<string> {
  if (typeof fetch !== "function" || typeof FileReader === "undefined") return "";
  try {
    const response = await fetch("/brand/ido-logo.jpg", { cache: "force-cache" });
    if (!response.ok) return "";
    const blob = await response.blob();
    return await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
      reader.onerror = () => resolve("");
      reader.readAsDataURL(blob);
    });
  } catch {
    return "";
  }
}

export async function downloadLocal(kind: LocalDownloadKind, options: LocalDownloadOptions = {}): Promise<void> {
  if (kind === "template") {
    await saveBlob(createGateVisaTemplateXlsxBlob(), "gate-visa-checklist-standart-sablon.xlsx");
    return;
  }
  if (kind === "backup") {
    await saveBlob(await localExportEncryptedBackup(), `gate-visa-checklist-sifreli-yedek-${stamp()}.excelbase-backup`);
    return;
  }

  const rows = await localExportRows(options.scope, options.ids);
  if (!rows.length) throw new Error("Seçili tarih aralığında dışa aktarılacak yolcu yok.");
  if (kind === "excel") {
    await saveBlob(createPassengerXlsxBlob(rows), `gate-visa-checklist-yolcular-${stamp()}.xlsx`);
    return;
  }
  if (kind === "csv") {
    await saveBlob(createPassengerCsvBlob(rows), `gate-visa-checklist-yolcular-${stamp()}.csv`);
    return;
  }
  if (kind === "manifest") {
    await saveBlob(
      createManifestHtmlBlob(rows, { title: options.title ?? "Gate Visa Checklist Teslim Manifestosu" }),
      `gate-visa-checklist-manifest-${stamp()}.html`,
    );
    return;
  }
  if (kind === "daily-list") {
    const date = reportDate(rows);
    await saveBlob(
      createIdoDailyPassengerListHtmlBlob(rows, {
        title: options.title ?? "İDO Günlük Yolcu Listesi",
        operationLabel: reportLabel(rows),
        logoDataUrl: await loadIdoLogoDataUrl(),
      }),
      `ido-gunluk-yolcu-listesi-${date}.html`,
    );
    return;
  }

  const photos = await localExportPhotos(rows);
  if (kind === "photos") {
    if (!photos.length) throw new Error("Seçili yolculara eşleşmiş fotoğraf bulunmuyor.");
    await saveBlob(await createPhotosZipBlob(photos), `gate-visa-checklist-fotograflar-${stamp()}.zip`);
    return;
  }
  const documents = await localExportDocuments(rows);
  if (kind === "documents") {
    if (!documents.length) throw new Error("Seçili yolculara eklenmiş PDF evrak bulunmuyor.");
    await saveBlob(await createDocumentsZipBlob(documents), `gate-visa-checklist-evraklar-${stamp()}.zip`);
    return;
  }
  if (kind === "record-package") {
    const recordDate = selectedRecordDate(rows, options.recordDate);
    await saveBlob(
      await createRecordFolderZipBlob(rows, photos, {
        recordDate,
        documents,
        title: options.title ?? "İDO Kontrol Listesi",
        operationLabel: recordDate,
        logoDataUrl: await loadIdoLogoDataUrl(),
      }),
      `IDO_GATE_VISA_${recordDate}.zip`,
    );
    return;
  }
  await saveBlob(
    await createDeliveryZipBlob(rows, photos, {
      title: options.title ?? "Gate Visa Checklist Teslim Paketi",
      documents,
    }),
    `gate-visa-checklist-teslim-paketi-${stamp()}.zip`,
  );
}

export async function downloadLocalPassengerDocument(passengerId: number, documentId: string): Promise<void> {
  const { metadata, blob } = await localPassengerDocumentFile(passengerId, documentId);
  await saveBlob(blob, metadata.filename);
}
