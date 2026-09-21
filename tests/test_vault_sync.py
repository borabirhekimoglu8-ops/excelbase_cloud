from backend import vault_sync


def test_vault_sync_round_trip(tmp_path, monkeypatch):
    monkeypatch.setenv("VAULT_SYNC_DIR", str(tmp_path))
    token = "ABCD-EFGH-IJKL-MNOP"
    payload = b'{"format":"excelbase-encrypted-vault","version":2}'
    assert vault_sync.put_blob(token, payload)["bytes"] == len(payload)
    assert vault_sync.get_blob(token) == payload
    assert vault_sync.get_blob("ZZZZZZZZZZZZZZZZ") is None


def test_vault_sync_rejects_short_token(tmp_path, monkeypatch):
    monkeypatch.setenv("VAULT_SYNC_DIR", str(tmp_path))
    try:
        vault_sync.put_blob("short", b"abc")
    except ValueError as error:
        assert "geçersiz" in str(error)
    else:
        raise AssertionError("expected ValueError")


def test_vault_sync_rate_limit_trips_after_budget(monkeypatch):
    vault_sync.reset_rate_limits()
    for _ in range(vault_sync._RATE_MAX_HITS):
        vault_sync.check_rate_limit("203.0.113.9")
    try:
        vault_sync.check_rate_limit("203.0.113.9")
    except vault_sync.VaultSyncRateLimitError:
        pass
    else:
        raise AssertionError("expected rate limit")
    # Another client is unaffected.
    vault_sync.check_rate_limit("203.0.113.10")
