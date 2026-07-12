"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  AuditEntry,
  BackupInfo,
  UserView,
  createUser,
  deactivateUser,
  fetchAudit,
  fetchBackups,
  fetchUsers,
  restoreDailyBackup,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useStore } from "@/lib/store";

const ROLE_LABELS: Record<string, string> = {
  admin: "Yönetici",
  operator: "Operasyon",
  viewer: "Görüntüleme",
};

export function ManagementTab() {
  const { user } = useAuth();
  const { notify, bump } = useStore();
  const [users, setUsers] = useState<UserView[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (user.role !== "admin") return;
    const [userRows, auditRows, backupRows] = await Promise.all([fetchUsers(), fetchAudit(), fetchBackups()]);
    setUsers(userRows);
    setAudit(auditRows);
    setBackups(backupRows);
  }, [user.role]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (user.role !== "admin") {
    return <div className="notice-card">Yönetim alanı yalnızca yöneticilere açıktır.</div>;
  }

  async function handleCreateUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    try {
      await createUser(String(form.get("name") ?? ""), String(form.get("pin") ?? ""), String(form.get("role") ?? "operator"));
      formElement.reset();
      notify("Kullanıcı oluşturuldu");
      await refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Kullanıcı oluşturulamadı", "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeactivate(target: UserView) {
    if (!window.confirm(`${target.name} kullanıcısı devre dışı bırakılsın mı?`)) return;
    await deactivateUser(target.id);
    notify("Kullanıcı devre dışı bırakıldı", "warn");
    await refresh();
  }

  async function handleRestore(snapshotDate: string) {
    if (!window.confirm(`${snapshotDate} tarihli sistem yedeğine dönülsün mü?`)) return;
    setBusy(true);
    try {
      const result = await restoreDailyBackup(snapshotDate);
      notify(result.message);
      bump();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Yedek geri yüklenemedi", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="tab-body">
      <div className="section-heading">
        <div>
          <p className="overline">YETKİ VE KAYIT</p>
          <h2>Sistem yönetimi</h2>
        </div>
      </div>

      <section className="panel-card">
        <div className="panel-head">
          <div>
            <h3>Kullanıcılar</h3>
            <p>Operasyon erişimlerini rol bazında yönetin.</p>
          </div>
        </div>
        <form className="management-form" onSubmit={handleCreateUser}>
          <label className="field">
            <span>Ad soyad</span>
            <input name="name" required />
          </label>
          <label className="field">
            <span>Erişim kodu</span>
            <input name="pin" type="password" inputMode="numeric" minLength={6} required />
          </label>
          <label className="field">
            <span>Rol</span>
            <select name="role" defaultValue="operator">
              <option value="operator">Operasyon</option>
              <option value="viewer">Görüntüleme</option>
              <option value="admin">Yönetici</option>
            </select>
          </label>
          <button className="primary-btn" disabled={busy} type="submit">Kullanıcı ekle</button>
        </form>
        <div className="data-list">
          {users.map((item) => (
            <div className="data-row" key={item.id}>
              <div>
                <strong>{item.name}</strong>
                <small>{ROLE_LABELS[item.role] ?? item.role} · {item.active ? "Aktif" : "Kapalı"}</small>
              </div>
              {item.active && item.id !== user.id && (
                <button className="text-btn danger-text" onClick={() => void handleDeactivate(item)} type="button">
                  Devre dışı bırak
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="panel-card">
        <div className="panel-head">
          <div>
            <h3>Günlük yedekler</h3>
            <p>Şifreli veritabanı anlık görüntüleri, son 30 gün.</p>
          </div>
        </div>
        <div className="data-list compact">
          {backups.length === 0 && <p className="muted">Henüz günlük yedek oluşmadı.</p>}
          {backups.map((backup) => (
            <div className="data-row" key={backup.snapshot_date}>
              <strong>{backup.snapshot_date}</strong>
              <button className="text-btn" disabled={busy} onClick={() => void handleRestore(backup.snapshot_date)}>
                Geri yükle
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="panel-card">
        <div className="panel-head">
          <div>
            <h3>İşlem günlüğü</h3>
            <p>Son yetkili değişiklikler.</p>
          </div>
        </div>
        <div className="audit-table">
          {audit.map((entry) => (
            <div className="audit-row" key={entry.id}>
              <span>{new Date(entry.time).toLocaleString("tr-TR")}</span>
              <strong>{entry.actor}</strong>
              <span>{entry.action} · {entry.path}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
