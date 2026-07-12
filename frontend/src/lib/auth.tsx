"use client";

import { FormEvent, ReactNode, createContext, useContext, useEffect, useMemo, useState } from "react";
import { AuthStatus, AuthUser, fetchAuthStatus, login, logout, setupAuth } from "@/lib/api";

type AuthValue = {
  user: AuthUser;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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
      setStatus(await setupAuth(String(form.get("name") ?? ""), String(form.get("pin") ?? "")));
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

  async function signOut() {
    await logout();
    setStatus({ setup_required: false, authenticated: false, user: null });
  }

  const value = useMemo(() => (status?.user ? { user: status.user, signOut } : null), [status]);

  if (!status) {
    return <div className="auth-loading">Gate Visa Operations hazırlanıyor…</div>;
  }

  if (!status.authenticated || !status.user || !value) {
    const setup = status.setup_required;
    return (
      <main className="auth-page">
        <section className="auth-panel">
          <div className="brand-lockup auth-brand">
            <span className="brand-symbol">GV</span>
            <div>
              <strong>Gate Visa Operations</strong>
              <small>Passenger Operations Platform</small>
            </div>
          </div>
          <div className="auth-copy">
            <p className="overline">{setup ? "İLK KURULUM" : "GÜVENLİ ERİŞİM"}</p>
            <h1>{setup ? "Yönetici hesabını oluşturun" : "Operasyon merkezine giriş"}</h1>
            <p>
              {setup
                ? "Bu işlem yalnızca bir kez yapılır. En az 6 karakterli özel bir erişim kodu belirleyin."
                : "Size tanımlanan erişim kodunu girin."}
            </p>
          </div>
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
          </form>
          <p className="security-note">Oturum bilgileri güvenli, HTTP-only çerezle korunur.</p>
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
