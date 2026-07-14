from __future__ import annotations

import time

import pytest


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line(
        "markers",
        "import_worker: gerçek arka plan aktarım iş parçacığını kullanan testler "
        "(diğer tüm testlerde ensure_import_worker no-op'tur, bkz. conftest fixture'ı).",
    )


@pytest.fixture(autouse=True)
def _no_background_import_worker(monkeypatch, request):
    """Arka plan aktarım işleyicisini varsayılan olarak testlerde devre dışı bırakır.

    backend.services.ensure_import_worker() FastAPI 'startup' olayında (her
    TestClient girişinde) VE /api/import/queue uç noktasında tetiklenen,
    daemon bir iş parçacığı başlatan gerçek bir arka plan işleyicidir. Süreç
    ömrü boyunca yaşadığı ve paylaşılan modül-global durumu (ör. persistence
    modülündeki günlük yedek zamanlayıcısı) değiştirdiği için, ilgisiz bir
    testin tetiklediği bu iş parçacığı bir SONRAKİ testin çalışması sırasında
    hâlâ ayakta olup o testin mock'ladığı fonksiyonlarla veri değiştirebilir
    — CI'da ara sıra gözlenen 'assert 0 == 1' kırılganlığının kök nedeni buydu.

    Yalnızca kuyruğu bizzat test eden testler ("import_worker" marker'ı ile
    işaretlenenler) gerçek iş parçacığını kullanır; diğer tüm testlerde
    ensure_import_worker() no-op'tur, yani hiçbir arka plan iş parçacığı
    doğmaz ve global durum yalnızca çağıran test iş parçacığından değişir.
    """
    from backend import services

    if "import_worker" in request.keywords:
        yield
        # Bu test gerçek bir iş parçacığı başlatmış olabilir; bir SONRAKİ
        # testin (no-op'a döndükten sonra bile) bu iş parçacığıyla
        # çakışmaması için tamamen sönümlenmesini bekleriz.
        deadline = time.monotonic() + 5.0
        while services._import_worker_alive and time.monotonic() < deadline:
            time.sleep(0.02)
        return

    monkeypatch.setattr(services, "ensure_import_worker", lambda: None)
    yield
