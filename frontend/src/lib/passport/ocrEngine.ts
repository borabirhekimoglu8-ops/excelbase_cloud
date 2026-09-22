import { PASSPORT_ENGINE_PROFILE } from "./engineProfile";

export const MAX_OCR_WORKERS = 1;
export const OCR_IDLE_TERMINATE_MS = 60_000;

export type OcrLanguage = "mrz" | "eng";
export type OcrRecognition = {
  text: string;
  blocks: unknown[] | null;
};
export type PassportOcrEngine = {
  recognize(
    image: Blob | File | string | HTMLCanvasElement,
    language: OcrLanguage,
    parameters?: Record<string, string>,
  ): Promise<OcrRecognition>;
  terminate(): Promise<void>;
};

type TesseractWorker = {
  recognize(
    image: Blob | File | string | HTMLCanvasElement,
    options?: Record<string, never>,
    output?: { blocks: boolean },
  ): Promise<{ data: { text: string; blocks: unknown[] | null } }>;
  reinitialize(language: string): Promise<void>;
  setParameters(parameters: Record<string, string>): Promise<void>;
  terminate(): Promise<void>;
};

let worker: TesseractWorker | null = null;
let workerPromise: Promise<TesseractWorker> | null = null;
let currentLanguage: OcrLanguage | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleIdleTermination(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    void terminatePassportOcrEngine();
  }, OCR_IDLE_TERMINATE_MS);
}

async function loadWorker(): Promise<TesseractWorker> {
  if (worker) return worker;
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker, OEM } = await import("tesseract.js");
      const loaded = await createWorker(PASSPORT_ENGINE_PROFILE.mrzLanguage, OEM.LSTM_ONLY, {
        corePath: "/tesseract",
        langPath: "/tesseract/lang-data",
        workerPath: "/tesseract/worker.min.js",
        logger: () => undefined,
        errorHandler: () => {
          worker = null;
          workerPromise = null;
          currentLanguage = null;
        },
      }) as unknown as TesseractWorker;
      worker = loaded;
      currentLanguage = "mrz";
      return loaded;
    })().catch((error) => {
      worker = null;
      workerPromise = null;
      currentLanguage = null;
      throw error;
    });
  }
  return workerPromise;
}

async function useLanguage(language: OcrLanguage): Promise<TesseractWorker> {
  const active = await loadWorker();
  if (currentLanguage !== language) {
    await active.reinitialize(language);
    currentLanguage = language;
  }
  return active;
}

export const passportOcrEngine: PassportOcrEngine = {
  async recognize(image, language, parameters = {}) {
    if (idleTimer) clearTimeout(idleTimer);
    const active = await useLanguage(language);
    try {
      await active.setParameters({
        user_defined_dpi: String(PASSPORT_ENGINE_PROFILE.dpi),
        ...parameters,
      });
      const result = await active.recognize(image, {}, { blocks: true });
      return result.data;
    } finally {
      scheduleIdleTermination();
    }
  },
  terminate: () => terminatePassportOcrEngine(),
};

export async function terminatePassportOcrEngine(): Promise<void> {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  const active = worker ?? await workerPromise?.catch(() => null);
  worker = null;
  workerPromise = null;
  currentLanguage = null;
  await active?.terminate().catch(() => undefined);
}
