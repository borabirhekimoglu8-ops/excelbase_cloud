export const MAX_PASSPORT_BATCH_PAGES = 80;
export const OCR_RENDER_LONG_SIDE = 2400;

export async function passportPdfPageCount(file: Blob): Promise<number> {
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
    if (pdf.numPages > MAX_PASSPORT_BATCH_PAGES) {
      throw new Error(`Bir PDF en fazla ${MAX_PASSPORT_BATCH_PAGES} sayfa olabilir (${pdf.numPages} sayfa bulundu).`);
    }
    return pdf.numPages;
  } finally {
    if (pdf) await pdf.destroy();
    else await loadingTask.destroy();
  }
}

export async function renderPdfPage(
  file: Blob,
  pageIndex: number,
): Promise<{ blob: Blob; width: number; height: number }> {
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
    const page = await pdf.getPage(pageIndex + 1);
    try {
      const base = page.getViewport({ scale: 1 });
      const scale = OCR_RENDER_LONG_SIDE / Math.max(base.width, base.height);
      const viewport = page.getViewport({ scale: Math.min(Math.max(scale, 1), 4) });
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Sayfa görüntüsü oluşturulamadı.");
      await page.render({ canvasContext: context, canvas, viewport }).promise;
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((value) => (value ? resolve(value) : reject(new Error("Sayfa görüntüsü oluşturulamadı."))), "image/jpeg", 0.86);
      });
      return { blob, width: canvas.width, height: canvas.height };
    } finally {
      page.cleanup();
    }
  } finally {
    if (pdf) await pdf.destroy();
    else await loadingTask.destroy();
  }
}
