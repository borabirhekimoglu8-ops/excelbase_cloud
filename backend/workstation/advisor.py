"""Deterministic local advisor over catalogue stats.

This is the KVKK-safe default brain: it never opens a network socket and never
reads file contents. When a local Ollama model is configured, the assistant
provider handles conversation; this module still supplies grounded findings
the UI can show without any model at all.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(slots=True)
class AdviceItem:
    kind: str
    title: str
    detail: str
    weight: int = 0
    evidence: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "kind": self.kind,
            "title": self.title,
            "detail": self.detail,
            "weight": self.weight,
            "evidence": list(self.evidence),
        }


def advise_from_stats(stats: dict, *, question: str = "") -> dict:
    """Produce Turkish operational advice from catalogue aggregates only."""
    by_kind = stats.get("by_kind") or {}
    files_seen = int(stats.get("files_seen") or 0)
    total_bytes = int(stats.get("total_bytes") or 0)
    c_code_files = int(stats.get("c_code_files") or 0)
    dated_files = int(stats.get("dated_files") or 0)
    truncated = bool(stats.get("truncated"))
    root = str(stats.get("root") or "")

    items: list[AdviceItem] = []

    if files_seen == 0:
        items.append(
            AdviceItem(
                kind="empty",
                title="Katalog boş",
                detail="Önce iş klasörünü indeksleyin. Dosya bulunmadan arama ve öneri üretilemez.",
                weight=100,
            )
        )
    else:
        gb = total_bytes / (1024 ** 3)
        items.append(
            AdviceItem(
                kind="inventory",
                title="Arşiv envanteri hazır",
                detail=(
                    f"{files_seen:,} dosya indekslendi ({gb:.2f} GB). "
                    f"Tablo {by_kind.get('tablo', 0)}, belge {by_kind.get('belge', 0)}, "
                    f"görsel {by_kind.get('gorsel', 0)}, diğer {by_kind.get('diger', 0)}."
                ).replace(",", "."),
                weight=90,
                evidence=[root] if root else [],
            )
        )

    tablo = int(by_kind.get("tablo") or 0)
    belge = int(by_kind.get("belge") or 0)
    gorsel = int(by_kind.get("gorsel") or 0)

    if tablo and tablo >= max(belge, 1) * 2:
        items.append(
            AdviceItem(
                kind="structure",
                title="Tablo ağırlıklı arşiv",
                detail=(
                    "Excel/CSV baskın. Tekrarlayan şablonları Drive Audit ile çıkarıp "
                    "Excelbase iş/yolcu alanlarına eşlemek düzeni hızlandırır."
                ),
                weight=70,
            )
        )

    if gorsel and gorsel > tablo + belge:
        items.append(
            AdviceItem(
                kind="privacy",
                title="Görsel yoğun — hassas kova önerisi",
                detail=(
                    "Görseller arşivin çoğunluğu. Pasaport/biyometrik klasörleri "
                    "içerik OCR'siz tutun; katalogda yalnız ad/yol yeterli."
                ),
                weight=85,
            )
        )

    if c_code_files:
        ratio = c_code_files / max(files_seen, 1)
        items.append(
            AdviceItem(
                kind="codes",
                title="C kodu izleri bulundu",
                detail=(
                    f"Dosya adında C kodu geçen {c_code_files} kayıt var "
                    f"(%{ratio * 100:.0f}). Arama kutusuna C kodu yazarak anında bulun."
                ),
                weight=60,
                evidence=[f"c_code_files={c_code_files}"],
            )
        )

    if dated_files:
        items.append(
            AdviceItem(
                kind="dates",
                title="Tarihli adlandırma mevcut",
                detail=(
                    f"{dated_files} dosya adında tarih kalıbı var. "
                    "Haftalık/aylık kapsam sorularında tarihli adlar en hızlı filtredir."
                ),
                weight=50,
            )
        )

    if truncated:
        items.append(
            AdviceItem(
                kind="limit",
                title="İndeks üst sınıra ulaştı",
                detail=(
                    "Katalog satır limiti doldu. Kökü daha dar bir operasyon klasörüne "
                    "indirin veya arşivi bölümlere ayırın."
                ),
                weight=80,
            )
        )

    if files_seen and not c_code_files and not dated_files:
        items.append(
            AdviceItem(
                kind="naming",
                title="Adlandırma standardı önerisi",
                detail=(
                    "Dosya adlarında C kodu veya tarih kalıbı az. "
                    "Örn. `C1234_2026-09-19_firma.xlsx` düzeni aramayı ve eşleştirmeyi güçlendirir."
                ),
                weight=55,
            )
        )

    items.append(
        AdviceItem(
            kind="workflow",
            title="Önerilen çalışma sırası",
            detail=(
                "1) Kataloğu güncelle  2) Anahtar kelime/C kodu ile bul  "
                "3) Drive Audit ile şablon boşluklarını gör  "
                "4) Onayladığın kuralları asistan hafızasına yaz."
            ),
            weight=40,
        )
    )

    q = question.strip().lower()
    answer = _answer_question(q, stats, items) if q else (
        items[0].detail if items else "Önce kataloğu oluşturun."
    )

    items.sort(key=lambda item: item.weight, reverse=True)
    return {
        "mode": "local_deterministic",
        "privacy": "aggregate_catalog_only",
        "answer": answer,
        "items": [item.as_dict() for item in items[:12]],
        "stats": {
            "files_seen": files_seen,
            "total_bytes": total_bytes,
            "by_kind": dict(by_kind),
            "c_code_files": c_code_files,
            "dated_files": dated_files,
            "truncated": truncated,
            "root": root,
        },
    }


def _answer_question(question: str, stats: dict, items: list[AdviceItem]) -> str:
    by_kind = stats.get("by_kind") or {}
    if any(token in question for token in ("kaç", "adet", "say", "envanter", "istatistik")):
        return (
            f"Katalogda {stats.get('files_seen', 0)} dosya var: "
            f"{by_kind.get('tablo', 0)} tablo, {by_kind.get('belge', 0)} belge, "
            f"{by_kind.get('gorsel', 0)} görsel, {by_kind.get('diger', 0)} diğer."
        )
    if any(token in question for token in ("bul", "ara", "nerede", "c kod", "c-kod")):
        return (
            "Arama kutuna dosya adı, C kodu veya klasör parçası yazın. "
            "Sonuçlar yalnız bu makinedeki katalogdan gelir; içerik dışarı çıkmaz."
        )
    if any(token in question for token in ("düzen", "standard", "nasıl", "öner", "fikir")):
        top = next((item for item in items if item.kind in {"structure", "naming", "workflow"}), None)
        if top:
            return f"{top.title}: {top.detail}"
    if any(token in question for token in ("kvkk", "sız", "gizlilik", "dışarı", "bulut")):
        return (
            "İş istasyonu kapalı devre çalışır: katalog meta verisi yerelde tutulur, "
            "hücre/PDF/JPEG içeriği indekslenmez. Yerel model (Ollama) seçiliyse "
            "istekler yalnız 127.0.0.1'e gider."
        )
    if items:
        return f"{items[0].title}. {items[0].detail}"
    return "Katalog hazır değil. Önce indeksleyin."
