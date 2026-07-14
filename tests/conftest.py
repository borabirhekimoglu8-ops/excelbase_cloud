from __future__ import annotations

import time

import pytest


@pytest.fixture(autouse=True)
def _wait_for_import_worker_idle():
    """Testler arasında sızan arka plan işleyicisini bekler.

    backend.services'teki aktarım işleyicisi FastAPI 'startup' olayında
    (TestClient bağlamına her girişte) tetiklenen daemon bir iş parçacığıdır.
    Bir testin işleyicisi hâlâ çalışırken bir sonraki test kendi mock'larını
    (db.enabled, db.save_state vb.) uyguladığında, o eski iş parçacığı yeni
    testin mock'larıyla veri değiştirip paylaşılan global durumu (ör. günlük
    yedek zamanlayıcısı) bozabiliyordu — CI'da ara sıra gözlenen kırılganlığın
    kaynağı buydu. Her testten önce/sonra kısa bir zaman aşımıyla işleyicinin
    boşta olmasını bekleriz.
    """
    from backend import services

    def _drain(timeout: float = 2.0) -> None:
        deadline = time.monotonic() + timeout
        while services._import_worker_alive and time.monotonic() < deadline:
            time.sleep(0.02)

    _drain()
    yield
    _drain()
