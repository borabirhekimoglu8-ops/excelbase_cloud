import { rowsFromMrzText, type PassportScanRow } from "./parseMrzText";

export const MAX_PDF_PAGES = 30;

type PdfTextItem = {
  str?: string;
  hasEOL?: boolean;
  transform?: number[];
};

function pageText(items: readonly unknown[]): string {
  const lines: string[] = [];
  let current = "";
  let previousY: number | null = null;

  for (const rawItem of items) {
    const item = rawItem as PdfTextItem;
    if (typeof item.str !== "string") continue;
    const y = Array.isArray(item.transform) && Number.isFinite(item.transform[5])
      ? item.transform[5]
      : null;
    if (current && y !== null && previousY !== null && Math.abs(y - previousY) > 2) {
      lines.push(current);
      current = "";
    }
    current += item.str;
    if (item.hasEOL) {
      lines.push(current);
      current = "";
    }
    previousY = y;
  }
  if (current) lines.push(current);
  return lines.join("\n");
}

export async function extractTextPerPage(file: Blob, maxPages = MAX_PDF_PAGES): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (typeof window !== "undefined") {
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
  }

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    isEvalSupported: false,
  });
  let pdf: Awaited<typeof loadingTask.promise> | null = null;

  try {
    pdf = await loadingTask.promise;
    if (pdf.numPages > maxPages) {
      throw new Error(
        `Bir PDF en fazla ${maxPages} sayfa olabilir (${pdf.numPages} sayfa bulundu).`,
      );
    }

    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      try {
        const content = await page.getTextContent();
        pages.push(pageText(content.items));
      } finally {
        page.cleanup();
      }
    }
    return pages;
  } finally {
    if (pdf) await pdf.destroy();
    else await loadingTask.destroy();
  }
}

/** Read a PDF text layer locally. Scanned/image-only PDFs intentionally return no text. */
export async function extractTextFromPdf(file: Blob): Promise<string> {
  return (await extractTextPerPage(file)).join("\n");
}

export async function rowsFromPdfText(
  file: Blob,
  sourceLabel: string,
): Promise<PassportScanRow[]> {
  return rowsFromMrzText(await extractTextFromPdf(file), sourceLabel);
}
