"""Kapalı yerel iş istasyonu: katalog, arama ve yerel danışman.

Hiçbir dosya içeriği, yolcu satırı veya ham evrak dışarıya gönderilmez.
İndeks ve danışman bu makinede çalışır; bulut LLM yolu bu paketin parçası değildir.
"""

from .service import (
    WorkstationError,
    WorkstationUnavailableError,
    advise,
    build_catalog,
    catalog_stats,
    search_catalog,
    workstation_state,
)

__all__ = [
    "WorkstationError",
    "WorkstationUnavailableError",
    "advise",
    "build_catalog",
    "catalog_stats",
    "search_catalog",
    "workstation_state",
]
