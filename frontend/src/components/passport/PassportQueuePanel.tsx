import type { PassportScanProgress } from "@/lib/passport/scanPassportImages";

export function PassportQueuePanel({
  progress,
  busy,
}: {
  progress: PassportScanProgress | null;
  busy: boolean;
}) {
  if (!busy && !progress) return null;
  const percent = progress?.total
    ? Math.round((progress.done / progress.total) * 100)
    : 0;
  return (
    <section className="xb-passport-queue" aria-live="polite" aria-label="Pasaport işleme kuyruğu">
      <div>
        <strong>{busy ? "Pasaportlar sırayla işleniyor" : "Kuyruk tamamlandı"}</strong>
        <span>{progress?.current || "OCR motoru hazırlanıyor…"}</span>
      </div>
      <progress max={100} value={percent}>{percent}%</progress>
      <small>Tek OCR motoru · {progress?.done ?? 0}/{progress?.total ?? 0} sayfa</small>
    </section>
  );
}
