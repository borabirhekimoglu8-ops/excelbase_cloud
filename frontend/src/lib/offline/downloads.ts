import type { DateScope } from "@/lib/api";
import {
  createDeliveryZipBlob,
  createGateVisaTemplateXlsxBlob,
  createManifestHtmlBlob,
  createPassengerCsvBlob,
  createPassengerXlsxBlob,
  createPhotosZipBlob,
  saveBlob,
} from "./exporter";
import {
  localExportEncryptedBackup,
  localExportPhotos,
  localExportRows,
} from "./localApi";

export type LocalDownloadKind = "template" | "excel" | "csv" | "manifest" | "photos" | "package" | "backup";

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
    await saveBlob(createGateVisaTemplateXlsxBlob(), "excelbase-standart-sablon.xlsx");
    return;
  }
  if (kind === "backup") {
    await saveBlob(await localExportEncryptedBackup(), `excelbase-sifreli-yedek-${stamp()}.excelbase-backup`);
    return;
  }

  const rows = await localExportRows(options.scope, options.ids);
  if (!rows.length) throw new Error("Seçili tarih aralığında dışa aktarılacak yolcu yok.");
  if (kind === "excel") {
    await saveBlob(createPassengerXlsxBlob(rows), `excelbase-yolcular-${stamp()}.xlsx`);
    return;
  }
  if (kind === "csv") {
    await saveBlob(createPassengerCsvBlob(rows), `excelbase-yolcular-${stamp()}.csv`);
    return;
  }
  if (kind === "manifest") {
    await saveBlob(
      createManifestHtmlBlob(rows, { title: options.title ?? "Excelbase Teslim Manifestosu" }),
      `excelbase-manifest-${stamp()}.html`,
    );
    return;
  }

  const photos = await localExportPhotos(rows);
  if (kind === "photos") {
    if (!photos.length) throw new Error("Seçili yolculara eşleşmiş fotoğraf bulunmuyor.");
    await saveBlob(await createPhotosZipBlob(photos), `excelbase-fotograflar-${stamp()}.zip`);
    return;
  }
  await saveBlob(
    await createDeliveryZipBlob(rows, photos, { title: options.title ?? "Excelbase Teslim Paketi" }),
    `excelbase-teslim-paketi-${stamp()}.zip`,
  );
}
