"use client";

import { FormEvent, useState } from "react";

import { unlockAssistantSession, fetchAssistantSession } from "@/lib/assistant/client";
import type { OcrCapability } from "@/lib/passport/ocr/types";

export function OcrCapabilityCard({
  capability,
  onRefresh,
}: {
  capability: OcrCapability;
  onRefresh: () => void;
}) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function login(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const session = await fetchAssistantSession();
      await unlockAssistantSession(session.setup_required, pin, "", "");
      onRefresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Giriş yapılamadı.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="ops-module-card xb-ocr-capability" data-state={capability.state}>
      <div>
        <p className="ops-eyebrow">Yerel OCR</p>
        <h2>{capability.title}</h2>
        <p>{capability.message}</p>
        {capability.engine?.version ? (
          <p className="xb-ocr-engine">Motor: {capability.engine.name} {capability.engine.version}</p>
        ) : null}
      </div>
      {capability.state === "login_required" ? (
        <form className="xb-ocr-login" onSubmit={login}>
          <label>
            <span>Yerel servis kodu</span>
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={pin}
              onChange={(event) => setPin(event.target.value)}
            />
          </label>
          <button type="submit" className="primary" disabled={busy || pin.length < 4}>Yerel servise giriş</button>
          {error ? <p className="xb-ocr-error">{error}</p> : null}
        </form>
      ) : (
        <button type="button" onClick={onRefresh}>Durumu yenile</button>
      )}
    </section>
  );
}
