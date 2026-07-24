"use client";

import {
  Dispatch,
  FormEvent,
  KeyboardEvent,
  SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AssistantClientError,
  AssistantSessionStatus,
  AssistantStatus,
  fetchAssistantSession,
  fetchAssistantStatus,
  logoutAssistantSession,
  sendAssistantMessage,
  unlockAssistantSession,
} from "@/lib/assistant/client";
import { buildAssistantContext } from "@/lib/assistant/context";
import {
  ASSISTANT_MESSAGE_MAX_CHARS,
  AssistantConversationMessage,
  AssistantConversationState,
  emptyAssistantConversation,
  packAssistantHistory,
} from "@/lib/assistant/conversation";
import { useStore } from "@/lib/store";

const SUGGESTIONS = [
  "Bugünkü operasyon durumunu yönetici özeti olarak çıkar.",
  "Eksik kayıtları öncelik sırasına göre nasıl ele almalıyım?",
  "Hazırlık oranını yükseltmek için kısa bir kontrol listesi hazırla.",
  "Bu verilerle vardiya teslim notu taslağı yaz.",
] as const;

const RANGE_LABELS: Record<string, string> = {
  all: "Tüm kayıtlar",
  today: "Bugün",
  week: "Bu hafta",
  month: "Bu ay",
  custom: "Özel aralık",
};

const CONFIGURATION_MESSAGES: Record<
  NonNullable<AssistantStatus["configuration_state"]>,
  { title: string; body: string }
> = {
  ready: {
    title: "Claude Sonnet hazır",
    body: "Sunucu yapılandırması doğrulandı.",
  },
  disabled: {
    title: "Sonnet sunucuda kapalı",
    body: "Excelbase servisinde EXCELBASE_ASSISTANT_ENABLED değerini 1 olarak tanımlayın.",
  },
  provider_mismatch: {
    title: "Sağlayıcı ayarı uyuşmuyor",
    body: "Excelbase servisinde EXCELBASE_ASSISTANT_PROVIDER değerini anthropic olarak tanımlayın.",
  },
  model_mismatch: {
    title: "Sonnet model ayarı uyuşmuyor",
    body: "Excelbase servisinde EXCELBASE_ASSISTANT_MODEL değerini claude-sonnet-5 olarak tanımlayın.",
  },
  api_key_missing: {
    title: "Anthropic anahtarı bu serviste görünmüyor",
    body: "ANTHROPIC_API_KEY değişkenini excelbase Web Service ortamına ekleyip yeniden deploy edin; excelbase-v8 ayrı servistir.",
  },
  privacy_mismatch: {
    title: "Gizlilik koruması doğrulanamadı",
    body: "PII modunu strict, ham evrak erişimini 0 olarak ayarlayıp yeniden deploy edin.",
  },
};

function newMessage(
  role: AssistantConversationMessage["role"],
  content: string,
  status: AssistantConversationMessage["status"],
): AssistantConversationMessage {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `${role}-${Date.now()}-${Math.random()}`,
    role,
    content,
    status,
  };
}

function friendlyError(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "Yanıt durduruldu.";
  }
  if (error instanceof AssistantClientError) {
    if (error.status === 401) return "Çevrimiçi asistan oturumu sona erdi. Yeniden bağlanın.";
    if (error.status === 429) {
      return error.retryAfter > 0
        ? `Kullanım sınırına ulaşıldı. Yaklaşık ${error.retryAfter} saniye sonra tekrar deneyin.`
        : "Kullanım sınırına ulaşıldı. Kısa süre sonra tekrar deneyin.";
    }
    if (error.status === 504) return "Sonnet zamanında yanıt vermedi. Soruyu kısaltıp tekrar deneyin.";
    return error.message;
  }
  return error instanceof Error ? error.message : "Claude Sonnet yanıt veremedi.";
}

type AssistantWorkspaceProps = {
  conversation: AssistantConversationState;
  setConversation: Dispatch<SetStateAction<AssistantConversationState>>;
};

export function AssistantWorkspace({
  conversation,
  setConversation,
}: AssistantWorkspaceProps) {
  const { summary, dateScope } = useStore();
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const [session, setSession] = useState<AssistantSessionStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [online, setOnline] = useState(true);
  const [connectionError, setConnectionError] = useState("");
  const [pairingBusy, setPairingBusy] = useState(false);
  const [pairingError, setPairingError] = useState("");
  const [disconnecting, setDisconnecting] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const requestRef = useRef<AbortController | null>(null);
  const connectionRef = useRef<AbortController | null>(null);
  const connectionSequenceRef = useRef(0);
  const conversationGenerationRef = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const { messages, draft, privacyAcknowledged } = conversation;

  const safeContext = useMemo(
    () => buildAssistantContext(summary, dateScope),
    [dateScope, summary],
  );

  const refreshConnection = useCallback(async () => {
    if (!navigator.onLine) {
      connectionRef.current?.abort();
      connectionRef.current = null;
      connectionSequenceRef.current += 1;
      setOnline(false);
      setChecking(false);
      setConnectionError("");
      return;
    }

    connectionRef.current?.abort();
    const controller = new AbortController();
    connectionRef.current = controller;
    const sequence = ++connectionSequenceRef.current;
    setOnline(true);
    setChecking(true);
    setConnectionError("");
    setStatus(null);
    setSession(null);
    try {
      const [nextStatus, nextSession] = await Promise.all([
        fetchAssistantStatus(controller.signal),
        fetchAssistantSession(controller.signal),
      ]);
      if (sequence !== connectionSequenceRef.current) return;
      setStatus(nextStatus);
      setSession(nextSession);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (sequence !== connectionSequenceRef.current) return;
      setConnectionError(friendlyError(error));
    } finally {
      if (sequence === connectionSequenceRef.current) {
        setChecking(false);
        if (connectionRef.current === controller) connectionRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    setOnline(navigator.onLine);
    void refreshConnection();
    const onOnline = () => {
      setOnline(true);
      void refreshConnection();
    };
    const onOffline = () => {
      connectionRef.current?.abort();
      connectionRef.current = null;
      connectionSequenceRef.current += 1;
      setOnline(false);
      setChecking(false);
      setConnectionError("");
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      connectionRef.current?.abort();
      connectionRef.current = null;
      connectionSequenceRef.current += 1;
      requestRef.current?.abort();
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [refreshConnection]);

  useEffect(() => {
    workspaceRef.current?.focus();
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages, sending, sendError]);

  async function pairSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const pin = String(form.get("pin") ?? "").trim();
    const displayName = String(form.get("displayName") ?? "").trim();
    const bootstrapToken = String(form.get("bootstrapToken") ?? "").trim();
    setPairingBusy(true);
    setPairingError("");
    try {
      setSession(await unlockAssistantSession(
        session.setup_required,
        pin,
        displayName,
        bootstrapToken,
      ));
      formElement.reset();
    } catch (error) {
      setPairingError(friendlyError(error));
    } finally {
      setPairingBusy(false);
    }
  }

  async function submitMessage(content = draft) {
    const text = content.trim();
    if (
      !text
      || requestRef.current
      || !online
      || !status?.available
      || !session?.authenticated
      || !session.csrf_token
      || !privacyAcknowledged
    ) return;

    const controller = new AbortController();
    requestRef.current = controller;
    const generation = conversationGenerationRef.current;
    const history = packAssistantHistory(messages);
    const userMessage = newMessage("user", text, "pending");
    setConversation((current) => ({
      ...current,
      messages: [...current.messages, userMessage],
      draft: "",
    }));
    setSending(true);
    setSendError("");

    try {
      const response = await sendAssistantMessage({
        message: text,
        history,
        context: safeContext,
        csrfToken: session.csrf_token,
      }, controller.signal);
      if (generation !== conversationGenerationRef.current) return;
      setConversation((current) => ({
        ...current,
        messages: [
          ...current.messages.map((message) => (
            message.id === userMessage.id ? { ...message, status: "complete" as const } : message
          )),
          {
            ...newMessage("assistant", response.message, "complete"),
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
          },
        ],
      }));
    } catch (error) {
      if (generation !== conversationGenerationRef.current) return;
      if (error instanceof AssistantClientError && error.status === 401) {
        setSession((current) => current ? { ...current, authenticated: false, user: null, csrf_token: "" } : current);
      }
      setConversation((current) => ({
        ...current,
        messages: current.messages.map((message) => (
          message.id === userMessage.id ? { ...message, status: "failed" as const } : message
        )),
      }));
      setSendError(friendlyError(error));
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setSending(false);
      }
    }
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submitMessage();
    }
  }

  function startNewConversation() {
    conversationGenerationRef.current += 1;
    requestRef.current?.abort();
    requestRef.current = null;
    setSending(false);
    setSendError("");
    setConversation(emptyAssistantConversation(privacyAcknowledged));
  }

  async function disconnectSession() {
    if (!session?.csrf_token || disconnecting) return;
    setDisconnecting(true);
    setConnectionError("");
    try {
      await logoutAssistantSession(session.csrf_token);
      setSession({
        setup_required: false,
        bootstrap_required: false,
        authenticated: false,
        user: null,
        csrf_token: "",
      });
    } catch (error) {
      setConnectionError(friendlyError(error));
    } finally {
      setDisconnecting(false);
    }
  }

  const ready = Boolean(
    online
    && !checking
    && !connectionError
    && status?.available
    && session?.authenticated
    && session.csrf_token,
  );
  const scopeLabel = RANGE_LABELS[safeContext.scope.range] ?? "Tüm kayıtlar";
  const verifiedSonnet = status?.model_family === "sonnet";
  const modelLabel = verifiedSonnet
    ? status.model_label?.trim() || "Claude Sonnet"
    : "Çevrimiçi asistan";
  const configurationMessage = status?.configuration_state
    ? CONFIGURATION_MESSAGES[status.configuration_state]
    : {
        title: "Sonnet yapılandırması tamamlanmadı",
        body: "Render üzerindeki excelbase Web Service ortam değişkenlerini doğrulayıp yeniden deploy edin.",
      };

  return (
    <main
      ref={workspaceRef}
      className={`assistant-workspace${ready ? " ready" : ""}`}
      tabIndex={-1}
      aria-label="Claude Sonnet asistanı"
    >
      <section className="assistant-connection" role="status" aria-live="polite">
        <span className={`assistant-live-dot${ready && online ? " ready" : ""}`} aria-hidden="true" />
        <div>
          <strong>
            {!online
              ? "Çevrimdışı"
              : checking
                ? "Sonnet bağlantısı kontrol ediliyor"
                : ready
                  ? `${modelLabel} hazır`
                  : status?.available
                    ? "Çevrimiçi oturum gerekli"
                    : "Sonnet yapılandırması bekleniyor"}
          </strong>
          <small>
            {ready && online
              ? "Uygulama içinden güvenli, salt okunur sohbet"
              : "Yerel kasa ve çevrimdışı mod çalışmaya devam eder"}
          </small>
        </div>
        {(messages.length > 0 || ready) && (
          <div className="assistant-connection-actions">
            {messages.length > 0 && (
              <button
                type="button"
                aria-label="Yeni konuşma başlat"
                onClick={() => {
                  if (window.confirm("Bu cihazdaki açık konuşma temizlensin mi?")) {
                    startNewConversation();
                  }
                }}
              >
                YENİ
              </button>
            )}
            {ready && (
              <button
                type="button"
                aria-label="Çevrimiçi Sonnet oturumunu kapat"
                disabled={disconnecting || sending}
                onClick={() => void disconnectSession()}
              >
                {disconnecting ? "…" : "ÇIK"}
              </button>
            )}
          </div>
        )}
      </section>

      <section className="assistant-context-strip" aria-label="Sonnet operasyon bağlamı">
        <div>
          <span>KAPSAM</span>
          <strong>{scopeLabel}</strong>
        </div>
        <div>
          <span>YOLCU</span>
          <strong>{safeContext.metrics.passenger_count}</strong>
        </div>
        <div>
          <span>HAZIRLIK</span>
          <strong>%{safeContext.metrics.readiness_percent}</strong>
        </div>
        <div className={safeContext.metrics.missing_count ? "attention" : ""}>
          <span>EKSİK</span>
          <strong>{safeContext.metrics.missing_count}</strong>
        </div>
      </section>

      {!checking && online && status && !status.available && (
        <section className="assistant-state-card warning">
          <p>SONNET BAĞLANTISI</p>
          <h2>{configurationMessage.title}</h2>
          <p>{configurationMessage.body}</p>
          <button type="button" onClick={() => void refreshConnection()}>YENİDEN KONTROL ET</button>
        </section>
      )}

      {!checking && online && status?.available && session && !session.authenticated && (
        <section className="assistant-state-card">
          <p>İLK BAĞLANTI</p>
          <h2>{session.setup_required ? "Çevrimiçi asistan hesabını oluşturun" : "Sonnet oturumunu açın"}</h2>
          <p>
            Bu çevrimiçi Excelbase Sonnet oturumu yalnız ücretli asistan çağrılarını korur. Cihaz
            kasasının PIN’i otomatik gönderilmez; burada ayrı bir erişim kodu kullanabilirsiniz.
          </p>
          <form className="assistant-pair-form" onSubmit={pairSession}>
            {session.setup_required && (
              <label>
                <span>Görünen ad</span>
                <input name="displayName" autoComplete="name" required />
              </label>
            )}
            {session.setup_required && session.bootstrap_required && (
              <label>
                <span>İlk kurulum anahtarı</span>
                <input
                  name="bootstrapToken"
                  type="password"
                  autoComplete="off"
                  required
                />
              </label>
            )}
            <label>
              <span>Çevrimiçi asistan erişim kodu</span>
              <input
                name="pin"
                type="password"
                minLength={6}
                autoComplete={session.setup_required ? "new-password" : "current-password"}
                required
              />
            </label>
            {pairingError && <div className="assistant-inline-error" role="alert">{pairingError}</div>}
            <button type="submit" disabled={pairingBusy}>
              {pairingBusy ? "BAĞLANIYOR…" : session.setup_required ? "HESABI OLUŞTUR" : "SONNET’E BAĞLAN"}
            </button>
          </form>
        </section>
      )}

      {connectionError && (
        <section className="assistant-state-card warning" role="alert">
          <h2>Bağlantı kurulamadı</h2>
          <p>{connectionError}</p>
          <button type="button" onClick={() => void refreshConnection()}>TEKRAR DENE</button>
        </section>
      )}

      {ready && (
        <>
          <section
            className="assistant-transcript"
            role="log"
            aria-live="polite"
            aria-relevant="additions"
            aria-busy={sending}
            aria-label="Sonnet konuşması"
          >
            {messages.length === 0 && (
              <div className="assistant-welcome">
                <span className="assistant-sonnet-mark" aria-hidden="true">S</span>
                <p>{verifiedSonnet ? modelLabel.toLocaleUpperCase("tr-TR") : "EXCELBASE ÇEVRİMİÇİ ASİSTAN"}</p>
                <h1>Operasyonu birlikte netleştirelim.</h1>
                <p>
                  Sonnet yalnız ekrandaki toplu operasyon özetini otomatik alır.
                  Yolcu adı, pasaport, PDF, fotoğraf ve dosya içeriği gönderilmez.
                </p>
                <div className="assistant-suggestions">
                  {SUGGESTIONS.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      disabled={!online || !privacyAcknowledged || sending}
                      onClick={() => void submitMessage(suggestion)}
                    >
                      {suggestion}
                      <span aria-hidden="true">›</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((message) => (
              <article key={message.id} className={`assistant-message ${message.role}`}>
                <span>{message.role === "assistant" ? "SONNET" : "SİZ"}</span>
                <p>{message.content}</p>
                {message.status === "failed" && <small>Gönderilemedi · yeni mesaj geçmişine eklenmedi</small>}
                {message.role === "assistant" && message.outputTokens !== undefined && (
                  <small>{message.outputTokens} çıktı tokenı</small>
                )}
              </article>
            ))}

            {sending && (
              <article className="assistant-message assistant pending" role="status">
                <span>SONNET</span>
                <p><i aria-hidden="true" /> <i aria-hidden="true" /> <i aria-hidden="true" /> Yanıt hazırlanıyor</p>
              </article>
            )}
            {sendError && <div className="assistant-inline-error transcript-error" role="alert">{sendError}</div>}
            <div ref={endRef} />
          </section>

          <section className="assistant-composer-shell">
            <label className="assistant-privacy-check">
              <input
                type="checkbox"
                checked={privacyAcknowledged}
                onChange={(event) => {
                  const checked = event.target.checked;
                  setConversation((current) => ({ ...current, privacyAcknowledged: checked }));
                }}
              />
              <span>
                Yazdığım metnin Anthropic’e gönderileceğini biliyorum; yolcu kişisel verisi paylaşmayacağım.
              </span>
            </label>
            <form
              className="assistant-composer"
              onSubmit={(event) => {
                event.preventDefault();
                void submitMessage();
              }}
            >
              <textarea
                value={draft}
                onChange={(event) => {
                  const nextDraft = event.target.value.slice(0, ASSISTANT_MESSAGE_MAX_CHARS);
                  setConversation((current) => ({ ...current, draft: nextDraft }));
                }}
                onKeyDown={onComposerKeyDown}
                rows={2}
                placeholder={online ? "Sonnet’e sorun…" : "Sonnet için internet bağlantısı gerekli"}
                disabled={!online || sending || !privacyAcknowledged}
                aria-label="Sonnet mesajı"
              />
              {sending ? (
                <button
                  className="stop"
                  type="button"
                  onClick={() => requestRef.current?.abort()}
                  aria-label="Sonnet yanıtını beklemeyi durdur"
                >
                  ■
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!draft.trim() || !online || !privacyAcknowledged}
                  aria-label="Sonnet mesajını gönder"
                >
                  ↑
                </button>
              )}
            </form>
            <small>Sonnet hata yapabilir. Önemli operasyon kararlarını kaynaktan doğrulayın.</small>
          </section>
        </>
      )}

      {!online && (
        <section className="assistant-state-card warning">
          <h2>Sonnet çevrimiçi çalışır</h2>
          <p>İnternet geldiğinde bağlantı otomatik yenilenecek. Yerel verileriniz cihazda kullanılabilir.</p>
        </section>
      )}
    </main>
  );
}
