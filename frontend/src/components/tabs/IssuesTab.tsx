"use client";

import { ChangeEvent, useEffect, useState } from "react";
import { Passenger, fetchPassengers, mergeDuplicates, setPassengerPhoto } from "@/lib/api";
import { useStore } from "@/lib/store";
import { PassengerDetail } from "@/components/PassengerDetail";
import { EmptyState } from "@/components/tabs/shared";

const CATEGORIES = ["Fotosuz", "Pasaportsuz", "Voucher eksik", "Ücretsiz", "Tekrarlı"];

export function IssuesTab() {
  const { summary, version, notify, bump } = useStore();
  const [category, setCategory] = useState("Fotosuz");
  const [rows, setRows] = useState<Passenger[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailId, setDetailId] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const status = category === "Voucher eksik" ? "Voucher eksik" : category;
    fetchPassengers({ status })
      .then((data) => active && setRows(data))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [category, version]);

  if (summary.passenger_count === 0) {
    return (
      <EmptyState
        emoji="🛡️"
        title="Kontrol edilecek bir şey yok"
        subtitle="Yolcu eklendiğinde eksikler burada listelenir."
      />
    );
  }

  async function handlePhoto(id: number, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      await setPassengerPhoto(id, file);
      notify("Fotoğraf atandı");
      bump();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Yüklenemedi", "error");
    } finally {
      event.target.value = "";
    }
  }

  async function handleMergeAll() {
    const res = await mergeDuplicates();
    notify(`${res.removed} tekrarlı kayıt birleştirildi`);
    bump();
  }

  return (
    <div className="tab-body">
      <p className="section-label">Hazırlık kontrol merkezi</p>
      <div className="issue-heatmap">
        <span className="hm ok" style={{ flex: summary.passenger_count - summary.missing_photo || 0.001 }} />
        <span className="hm warn" style={{ flex: summary.missing_photo || 0.001 }} />
      </div>

      <div className="cc-grid">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            className={`cc-card as-btn ${cat === category ? "active" : ""}`}
            onClick={() => setCategory(cat)}
          >
            <p className="cc-kicker">{cat}</p>
            <p className="cc-value">{summary.issue_counts[cat] ?? 0}</p>
            <p className="cc-sub">Düzelt →</p>
          </button>
        ))}
      </div>

      {category === "Tekrarlı" ? (
        <div className="tab-body">
          {(summary.issue_counts["Tekrarlı"] ?? 0) === 0 ? (
            <div className="success-card">Tekrarlı pasaport yok.</div>
          ) : (
            <>
              <p className="muted">Aynı pasaporta sahip kayıtları en dolu satırı tutarak birleştir.</p>
              <button className="primary-btn wide" onClick={handleMergeAll}>
                Tüm tekrarları birleştir
              </button>
            </>
          )}
        </div>
      ) : (
        <>
          {loading && <p className="muted">Yükleniyor...</p>}
          {!loading && rows.length === 0 && <div className="success-card">{category} için eksik yok.</div>}
          {rows.slice(0, 40).map((p) => (
            <div key={p.id} className="quick-fix">
              <div>
                <p className="qf-title">{p.full_name || "Yolcu"}</p>
                <p className="qf-sub">{p.passport_no || "—"}</p>
              </div>
              <div className="qf-actions">
                <button className="soft-btn" onClick={() => setDetailId(p.id)}>
                  Detay
                </button>
                {category === "Fotosuz" && (
                  <label className="soft-btn">
                    Foto ata
                    <input type="file" accept="image/*" onChange={(e) => handlePhoto(p.id, e)} />
                  </label>
                )}
              </div>
            </div>
          ))}
        </>
      )}

      {detailId !== null && <PassengerDetail id={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}
