export type OcrLine = {
  text: string;
  box: number[][];
  score: number | null;
};

export type OcrEngineInfo = {
  name: string;
  version: string;
  lang?: string;
};

export type OcrPageResult = {
  pageId: string;
  engine: OcrEngineInfo;
  width: number;
  height: number;
  lines: OcrLine[];
  durationMs: number;
};

export type OcrCapabilityState =
  | "ready"
  | "engine_loading"
  | "engine_missing"
  | "engine_error"
  | "disabled"
  | "blocked_open_network"
  | "blocked_not_loopback"
  | "login_required"
  | "service_unreachable"
  | "not_local_origin"
  | "unsupported_device";

export type OcrCapability = {
  state: OcrCapabilityState;
  title: string;
  message: string;
  localOrigin: boolean;
  canOcr: boolean;
  acceptImages: boolean;
  engine: OcrEngineInfo | null;
};

export type PassportOcrEngine = {
  probe: (signal?: AbortSignal) => Promise<OcrCapability>;
  warmup: (signal?: AbortSignal) => Promise<OcrCapability>;
  recognizePage: (image: Blob, pageId: string, signal?: AbortSignal) => Promise<OcrPageResult>;
};
