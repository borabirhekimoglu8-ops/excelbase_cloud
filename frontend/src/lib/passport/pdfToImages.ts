const PDF_RENDER_DPI = 250;
const PDF_LONG_EDGE_LIMIT = 2600;
export const MAX_PDF_PAGES = 30;

export type RasterizedPdfImage = {
  filename: string;
  pageNo: number;
  blob: Blob;
  width: number;
  height: number;
  scale: number;
};

type PageSize = {
  width: number;
  height: number;
};

/** Scale a PDF point-space page to OCR resolution without unbounded mobile RAM use. */
export function pdfRasterScale(
  page: PageSize,
  dpi = PDF_RENDER_DPI,
  longEdgeLimit = PDF_LONG_EDGE_LIMIT,
): number {
  const longEdge = Math.max(page.width, page.height);
  if (!Number.isFinite(longEdge) || longEdge <= 0) {
    throw new Error("PDF sayfa boyutu geçersiz.");
  }
  return Math.min(dpi / 72, longEdgeLimit / longEdge);
}

function pdfBaseName(baseName: string): string {
  const leaf = baseName.replaceAll("\\", "/").split("/").pop()?.trim() ?? "";
  return leaf.replace(/\.pdf$/i, "").trim() || "scan";
}

function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("PDF sayfası JPEG görüntüsüne dönüştürülemedi."));
      },
      "image/jpeg",
      0.9,
    );
  });
}

async function blobsAreIdentical(left: Blob, right: Blob): Promise<boolean> {
  if (left.size !== right.size) return false;
  const [leftBytes, rightBytes] = await Promise.all([
    left.arrayBuffer().then((value) => new Uint8Array(value)),
    right.arrayBuffer().then((value) => new Uint8Array(value)),
  ]);
  for (let index = 0; index < leftBytes.length; index += 1) {
    if (leftBytes[index] !== rightBytes[index]) return false;
  }
  return true;
}

/**
 * Rasterize a passport PDF entirely in the browser and return local JPEGs for
 * the existing MRZ pipeline. The matching worker is copied from pdfjs-dist to
 * public/pdfjs so Next static exports never rely on a CDN.
 */
export async function rasterizePdfToImages(
  file: Blob,
  baseName: string,
): Promise<RasterizedPdfImage[]> {
  if (typeof document === "undefined") {
    throw new Error("PDF yalnızca tarayıcıda işlenebilir.");
  }

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (typeof window !== "undefined") {
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjs.getDocument({
    data: bytes,
    isEvalSupported: false,
  });
  let pdf: Awaited<typeof loadingTask.promise> | null = null;

  try {
    pdf = await loadingTask.promise;
    if (pdf.numPages > MAX_PDF_PAGES) {
      throw new Error(
        `Bir PDF en fazla ${MAX_PDF_PAGES} sayfa olabilir (${pdf.numPages} sayfa bulundu).`,
      );
    }

    const stem = pdfBaseName(baseName);
    const output: RasterizedPdfImage[] = [];
    let previousBlob: Blob | null = null;

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const pointViewport = page.getViewport({ scale: 1 });
      const scale = pdfRasterScale(pointViewport);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));

      try {
        await page.render({
          canvas,
          viewport,
          background: "rgb(255,255,255)",
        }).promise;
        const blob = await canvasToJpeg(canvas);

        // Scanner exports occasionally repeat a page byte-for-byte. Avoid
        // running expensive OCR twice while preserving distinct pages.
        if (previousBlob && await blobsAreIdentical(previousBlob, blob)) continue;
        output.push({
          filename: `${stem}-p${pageNumber}.jpg`,
          pageNo: pageNumber,
          blob,
          width: canvas.width,
          height: canvas.height,
          scale,
        });
        previousBlob = blob;
      } finally {
        page.cleanup();
        canvas.width = 0;
        canvas.height = 0;
      }
    }

    return output;
  } finally {
    if (pdf) await pdf.destroy();
    else await loadingTask.destroy();
  }
}
