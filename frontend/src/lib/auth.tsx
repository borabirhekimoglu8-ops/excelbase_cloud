"use client";

import { FormEvent, ReactNode, createContext, useContext, useEffect, useMemo, useState } from "react";
import { AuthStatus, AuthUser, fetchAuthStatus, login, loginWithRecovery, logout, setupAuth } from "@/lib/api";
import { BrandMark } from "@/components/ui/BrandMark";

type AuthValue = {
  user: AuthUser;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

function AuthBrand() {
  return (
    <div className="brand-lockup auth-brand">
      <BrandMark size={64} tone="on-brand" />
      <div>
        <strong>Excelbase</strong>
        <small>İDO liman masası</small>
      </div>
    </div>
  );
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pendingRecovery, setPendingRecovery] = useState<string | null>(null);
  const [recovering, setRecovering] = useState(false);

  useEffect(() => {
    fetchAuthStatus()
      .then(setStatus)
      .catch(() => setStatus({ setup_required: false, authenticated: false, user: null }));
  }, []);

  async function handleSetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const next = await setupAuth(String(form.get("name") ?? ""), String(form.get("pin") ?? ""));
      setStatus(next);
      if (next.recoveryKey) setPendingRecovery(next.recoveryKey);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kurulum tamamlanamadı.");
    } finally {
      setBusy(false);
    }
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      setStatus(await login(String(form.get("pin") ?? "")));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Giriş yapılamadı.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRecovery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      setStatus(await loginWithRecovery(String(form.get("recovery") ?? "")));
      setRecovering(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kurtarma kodu kabul edilmedi.");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await logout();
    setStatus({ setup_required: false, authenticated: false, user: null });
  }

  const value = useMemo(() => (status?.user ? { user: status.user, signOut } : null), [status]);

  if (!status) {
    return <div className="auth-loading">Excelbase yerel kasası hazırlanıyor…</div>;
  }

  if (pendingRecovery) {
    return (
      <main className="auth-page">
        <section className="auth-panel">
          <AuthBrand />
          <div className="auth-copy">
            <h1>Bu kodu bir yere yazın</h1>
            <p>
              Erişim kodunu unutursanız kasayı yalnız bu kod açar. Sunucuda kopyası yoktur.
              Ekranı kapatmadan önce bir kâğıda veya şifre yöneticisine kaydedin.
            </p>
          </div>
          <p className="xb-recovery-key" aria-label="Kurtarma kodu">{pendingRecovery}</p>
          <button
            className="primary-btn wide"
            type="button"
            onClick={() => setPendingRecovery(null)}
          >
            Kodu yazdım, devam et
          </button>
        </section>
      </main>
    );
  }

  if (!status.authenticated || !status.user || !value) {
    const setup = status.setup_required;
    return (
      <main className="auth-page">
        <section className="auth-panel">
          <AuthBrand />
          <div className="auth-copy">
            <h1>
              {setup
                ? "Bu cihazdaki kasayı oluşturun"
                : recovering
                  ? "Kurtarma koduyla açın"
                  : "Yerel kasanın kilidini açın"}
            </h1>
            <p>
              {setup
                ? "Veriler bu iPhone’da şifreli saklanır. En az 6 haneli bir erişim kodu belirleyin; bir kurtarma kodu da üretilir."
                : recovering
                  ? "Kurulumda gösterilen kodu girin. Tireler isteğe bağlıdır."
                  : "Cihazdaki şifreli operasyon verilerini açmak için erişim kodunuzu girin."}
            </p>
          </div>
          {recovering ? (
            <form className="auth-form" onSubmit={handleRecovery}>
              <label className="field">
                <span>Kurtarma kodu</span>
                <input name="recovery" autoComplete="off" spellCheck={false} required />
              </label>
              {error && <div className="form-error">{error}</div>}
              <button className="primary-btn wide" disabled={busy} type="submit">
                {busy ? "İşleniyor…" : "Kurtarma koduyla aç"}
              </button>
              <button className="text-btn" type="button" onClick={() => { setRecovering(false); setError(""); }}>
                Erişim koduna dön
              </button>
            </form>
          ) : (
            <form className="auth-form" onSubmit={setup ? handleSetup : handleLogin}>
              {setup && (
                <label className="field">
                  <span>Ad soyad</span>
                  <input name="name" autoComplete="name" required />
                </label>
              )}
              <label className="field">
                <span>Erişim kodu</span>
                <input
                  name="pin"
                  type="password"
                  inputMode="numeric"
                  autoComplete={setup ? "new-password" : "current-password"}
                  minLength={6}
                  required
                />
              </label>
              {error && <div className="form-error">{error}</div>}
              <button className="primary-btn wide" disabled={busy} type="submit">
                {busy ? "İşleniyor…" : setup ? "Kurulumu tamamla" : "Giriş yap"}
              </button>
              {!setup && (
                <button className="text-btn" type="button" onClick={() => { setRecovering(true); setError(""); }}>
                  Kodu unuttum
                </button>
              )}
            </form>
          )}
          <p className="security-note">
            Kod sunucuya gönderilmez. Düzenli şifreli yedek alın; ikinci bir cihaza taşımak için eşleme kodunu kullanın.
          </p>
        </section>
      </main>
    );
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthGate");
  return value;
}
