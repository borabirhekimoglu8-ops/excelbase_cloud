import { extractTd3LinesFromPlainText, rowFromParsedMrz } from "./parseMrzText";
import { parseTd3FromLines } from "./mrz";
import { mergeMrzViz } from "./mergeMrzViz";
import type { PassportOcrEngine, OcrRecognition } from "./ocrEngine";
import { passportOcrEngine } from "./ocrEngine";
import type { PassportScanRow, SourceRect } from "./passportTypes";
import { matchVizFields, type VizWord } from "./vizFields";

type TesseractSymbol = { text?: string; confidence?: number; bbox?: { x0: number; y0: number; x1: number; y1: number } };
type TesseractWord = {
  text?: string;
  confidence?: number;
  bbox?: { x0: number; y0: number; x1: number; y1: number };
  symbols?: TesseractSymbol[];
};
type TesseractBlock = {
  paragraphs?: Array<{ lines?: Array<{ words?: TesseractWord[] }> }>;
};

function rect(bbox: NonNullable<TesseractWord["bbox"]>): SourceRect {
  return { x: bbox.x0, y: bbox.y0, width: bbox.x1 - bbox.x0, height: bbox.y1 - bbox.y0 };
}

export function vizWordsFromRecognition(result: OcrRecognition): VizWord[] {
  return ((result.blocks ?? []) as TesseractBlock[]).flatMap((block) =>
    (block.paragraphs ?? []).flatMap((paragraph) =>
      (paragraph.lines ?? []).flatMap((line) =>
        (line.words ?? []).flatMap((word) => {
          if (word.text && word.bbox) {
            return [{ text: word.text, confidence: word.confidence ?? 0, rect: rect(word.bbox) }];
          }
          return (word.symbols ?? []).flatMap((symbol) => symbol.text && symbol.bbox
            ? [{
                text: symbol.text,
                confidence: symbol.confidence ?? 0,
                rect: {
                  x: symbol.bbox.x0,
                  y: symbol.bbox.y0,
                  width: symbol.bbox.x1 - symbol.bbox.x0,
                  height: symbol.bbox.y1 - symbol.bbox.y0,
                },
              }]
            : []);
        }),
      ),
    ),
  );
}

export type AnalyzePageInput = {
  image: Blob;
  filename: string;
  previewUrl?: string;
  batchId: string;
  pageNo: number;
};

/**
 * Analyze one page serially: MRZ first, then full-page VIZ for blank or
 * unverified fields. The engine is injectable so tests never load WASM.
 */
export async function analyzePassportPage(
  input: AnalyzePageInput,
  engine: PassportOcrEngine = passportOcrEngine,
): Promise<PassportScanRow> {
  const previewUrl = input.previewUrl ?? URL.createObjectURL(input.image);
  const mrzResult = await engine.recognize(input.image, "mrz", {
    tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<",
  });
  const lines = extractTd3LinesFromPlainText(mrzResult.text);
  const parsed = lines ? parseTd3FromLines(lines.line1, lines.line2) : null;
  let row = rowFromParsedMrz(input.filename, parsed, {
    previewUrl,
    batchId: input.batchId,
    pageNo: input.pageNo,
  });

  if (!mrzResult.text.trim()) row.failureStage = "text_detection";
  else if (!lines) row.failureStage = "mrz_parser";
  else if (!parsed?.verified) row.failureStage = "field_matching";

  if (!parsed?.verified) {
    const vizResult = await engine.recognize(input.image, "eng");
    const viz = matchVizFields(vizWordsFromRecognition(vizResult), input.pageNo);
    row = mergeMrzViz(row, viz).row;
    if (!Object.keys(viz).length && row.failureStage === "mrz_parser") {
      row.failureStage = "character_recognition";
    }
  }
  return row;
}
