import type { DateScope } from "@/lib/api";
import {
  createDeliveryZipBlob,
  createDocumentsZipBlob,
  createGateVisaTemplateXlsxBlob,
  createManifestHtmlBlob,
  createPassengerCsvBlob,
  createPassengerXlsxBlob,
  createPhotosZipBlob,
  saveBlob,
} from "./exporter";
import {
  localExportEncryptedBackup,
  localExportDocuments,
  localExportPhotos,
  localExportRows,
  localPassengerDocumentFile,
} from "./localApi";

export type LocalDownloadKind = "template" | "excel" | "csv" | "manifest" | "photos" | "documents" | "package" | "backup";

export type LocalDownloadOptions = {
  scope?: DateScope;
  ids?: number[];
  title?: string;
};

function stamp(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
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
