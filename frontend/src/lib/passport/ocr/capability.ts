import type { OcrCapability, OcrCapabilityState, OcrEngineInfo } from "./types";

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);

const COPY: Record<OcrCapabilityState, { title: string; message: string }> = {
  ready: {
    title: "Yerel OCR hazır",
    message: "Görüntüler bu bilgisayarda işlenir, diske yazılmaz.",
  },
  engine_loading: {
    title: "Model yükleniyor",
    message: "İlk açılış 10–60 saniye sürebilir. İnternet yalnız ilk model indiriminde gerekir.",
  },
  engine_missing: {
    title: "OCR motoru kurulu değil",
    message: "Yerel OCR motoru kurulu değil. EXCELBASE_PASSPORT_OCR=1 yapıp ./run.sh veya .\\run.ps1 ile yeniden başlatın.",
  },
  engine_error: {
    title: "OCR hatası",
    message: "Yerel motor başlatılamadı. Metin katmanlı PDF ve MRZ yapıştırma kullanılabilir.",
  },
  disabled: {
    title: "Servis kapalı",
    message: "Pasaport OCR bu kurulumda kapalı. .env içinde EXCELBASE_PASSPORT_OCR=1 yazın.",
  },
  blocked_open_network: {
    title: "Açık ağda kapalı",
    message: "Pasaport OCR yalnız kapalı yerel kurulumda açılır. EXCELBASE_ASSISTANT_OPEN_ACCESS=0 veya IP listesi gerekir.",
  },
  blocked_not_loopback: {
    title: "Loopback dışında kapalı",
    message: "OCR yalnız http://127.0.0.1 üzerinde çalışır. LAN adresi kabul edilmez.",
  },
  login_required: {
    title: "Yerel servise giriş",
    message: "OCR için bu makinedeki asistan oturumunu açın. Kasa PIN’i sunucuya gitmez.",
  },
  service_unreachable: {
    title: "Servis bağlı değil",
    message: "Yerel servis yanıt vermedi. Ofis PC’de ./run.sh ile http://127.0.0.1:8000 açın.",
  },
  not_local_origin: {
    title: "Bu adreste OCR çalışmaz",
    message: "Tarayıcı https sayfadan yerel servise erişimi engeller. Güvenliği kapatmayın. Ofis PC’de http://127.0.0.1:8000 açıp sonuç paketini aktarın.",
  },
  unsupported_device: {
    title: "Bu cihazda OCR yok",
    message: "iPhone’daki localhost ofis bilgisayarı değildir. MRZ’yi Live Text ile yapıştırın veya ofis PC’den şifreli paket aktarın.",
  },
};

export function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return LOOPBACK.has(host);
}

export function isLocalHttpOrigin(hostname: string, protocol: string): boolean {
  return isLoopbackHostname(hostname) && (protocol === "http:" || protocol === "https:");
}

export function detectOcrCapability(input: {
  hostname: string;
  protocol: string;
  isSecureContext: boolean;
  maxTouchPoints?: number;
  probeState?: OcrCapabilityState | "unreachable" | "unauthenticated";
  engine?: OcrEngineInfo | null;
}): OcrCapability {
  const localOrigin = isLocalHttpOrigin(input.hostname, input.protocol);
  const touch = (input.maxTouchPoints ?? 0) > 0;

  let state: OcrCapabilityState;
  if (!localOrigin && touch) {
    state = "unsupported_device";
  } else if (!localOrigin) {
    state = "not_local_origin";
  } else if (input.probeState === "unauthenticated") {
    state = "login_required";
  } else if (input.probeState === "unreachable" || input.probeState == null) {
    state = touch ? "unsupported_device" : "service_unreachable";
  } else {
    state = input.probeState;
  }

  const canOcr = state === "ready";
  const acceptImages = localOrigin && state !== "unsupported_device";
  const copy = COPY[state];
  return {
    state,
    title: copy.title,
    message: copy.message,
    localOrigin,
    canOcr,
    acceptImages,
    engine: input.engine ?? null,
  };
}

export function fileAcceptForCapability(capability: OcrCapability): string {
  const base = ".pdf,application/pdf,.txt,text/plain";
  if (!capability.acceptImages) return base;
  return `${base},.jpg,.jpeg,.png,.heic,image/jpeg,image/png,image/heic`;
}
