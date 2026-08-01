from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from ipaddress import ip_address, ip_network


def allowed_origins() -> list[str]:
    raw = os.environ.get("GATEVISA_CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000")
    return [item.strip() for item in raw.split(",") if item.strip()]


def api_key() -> str:
    return os.environ.get("GATEVISA_API_KEY", "").strip()


ANTHROPIC_API_KEY_VARIABLE = "ANTHROPIC_API_KEY"

# Names operators reach for when the key does not take effect.  These are only
# ever inspected for presence, never read as a credential: accepting a key under
# an unexpected name would make the deployment contract ambiguous, but staying
# silent about it is what turns a one-line dashboard fix into a long hunt.
ANTHROPIC_API_KEY_ALIASES: tuple[str, ...] = (
    "CLAUDE_API_KEY",
    "ANTHROPIC_KEY",
    "ANTHROPIC_API_TOKEN",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTROPIC_API_KEY",
    "EXCELBASE_ANTHROPIC_API_KEY",
)


def _read_api_key(name: str) -> str:
    """Read one credential variable, tolerating how dashboards paste values.

    Render (and most .env editors) keep surrounding quotes verbatim, so a value
    pasted as "sk-ant-..." reaches the process with the quotes attached and is
    rejected upstream with a 401 that looks like a bad key.  Trimming them here
    fixes the paste rather than reporting it.
    """
    raw = os.environ.get(name, "").strip()
    if len(raw) >= 2 and raw[0] == raw[-1] and raw[0] in {'"', "'"}:
        raw = raw[1:-1].strip()
    return raw


def misnamed_anthropic_key_variables() -> tuple[str, ...]:
    """Return alias variable names that carry a value, for diagnostics only.

    Values are never read or returned; only the operator's own variable names
    leave this function.
    """
    return tuple(
        name for name in ANTHROPIC_API_KEY_ALIASES if _read_api_key(name)
    )


def _bounded_env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    raw = os.environ.get(name, "").strip()
    try:
        parsed = int(raw) if raw else default
    except ValueError:
        parsed = default
    return max(minimum, min(maximum, parsed))


def assistant_allowed_networks() -> tuple[ip_network, ...]:
    """Source networks allowed to reach the assistant, empty when unrestricted.

    This is how a browser application is "closed": the API must stay reachable
    from wherever the operator's browser is, so it cannot be hidden from the
    network entirely -- but it can be scoped to the addresses the operation
    actually works from.
    """
    raw = os.environ.get("EXCELBASE_ASSISTANT_ALLOWED_IPS", "")
    networks: list[ip_network] = []
    for item in raw.split(","):
        candidate = item.strip()
        if not candidate:
            continue
        try:
            # strict=False so a plain host address is accepted as a /32 or /128.
            networks.append(ip_network(candidate, strict=False))
        except ValueError:
            # A typo must not silently widen access, so the entry is dropped and
            # the remaining ones still apply.
            continue
    return tuple(networks)


def assistant_trusted_proxy_hops() -> int:
    """How many proxies sit in front of us, for reading X-Forwarded-For.

    Render terminates TLS and appends the real client address, so the default
    of one hop means "take the entry Render appended", which a client cannot
    forge by sending its own header.
    """
    return _bounded_env_int("EXCELBASE_ASSISTANT_TRUSTED_PROXY_HOPS", 1, 0, 8)


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True, slots=True)
class DevAgentSettings:
    """Configuration for the in-app development agent.

    Off by default and refused outright on a deployment anyone can reach: an
    agent that edits code is a development tool on a closed machine and a
    remote-code-execution feature on a public one.
    """

    enabled: bool
    closed_deployment: bool
    repository: str
    api_key: str = field(repr=False)
    model: str = "claude-opus-5"
    max_turns: int = 120
    max_budget_usd: float = 5.0


def dev_agent_settings() -> DevAgentSettings:
    assistant = assistant_settings()
    return DevAgentSettings(
        enabled=_env_bool("EXCELBASE_DEV_AGENT", default=False),
        # Same rule the write tools use: closed by an access code, or scoped to
        # named networks. Reusing it means there is one definition of "closed".
        closed_deployment=(
            not assistant.open_access or bool(assistant_allowed_networks())
        ),
        repository=os.environ.get(
            "EXCELBASE_DEV_AGENT_REPOSITORY",
            str(Path(__file__).resolve().parents[1]),
        ),
        api_key=_read_api_key(ANTHROPIC_API_KEY_VARIABLE),
        model=os.environ.get("EXCELBASE_DEV_AGENT_MODEL", "claude-opus-5").strip()[:200],
        # A real change -- read the code, edit, run the tests, fix what broke --
        # spends turns quickly, and 40 stopped ordinary requests halfway. Money
        # is what actually needs bounding, and max_budget_usd bounds it; the
        # turn limit is only a guard against a loop that spends nothing.
        max_turns=_bounded_env_int("EXCELBASE_DEV_AGENT_MAX_TURNS", 120, 1, 400),
        # A hard ceiling on one run, enforced by the SDK rather than by asking
        # the model to be careful.
        max_budget_usd=float(
            _bounded_env_int("EXCELBASE_DEV_AGENT_MAX_BUDGET_CENTS", 500, 10, 100_000)
        ) / 100.0,
    )


@dataclass(frozen=True, slots=True)
class AssistantSettings:
    enabled: bool
    provider: str
    model: str
    api_key: str = field(repr=False)
    # When true the deployment issues Sonnet sessions without an access code.
    # Anyone who can reach the site can then spend the configured Anthropic
    # budget, so this stays opt-in and defaults to false.
    open_access: bool = False
    # When true Claude may call the mutating tools in the catalogue. Reads stay
    # available either way.
    allow_writes: bool = False
    pii_mode: str = "strict"
    allow_raw_documents: bool = False
    max_context_records: int = 25
    max_input_chars: int = 12_000
    max_history_turns: int = 8
    max_output_tokens: int = 1_200
    max_request_bytes: int = 64 * 1024
    timeout_seconds: int = 35
    requests_per_minute: int = 6
    requests_per_day: int = 100
    global_requests_per_day: int = 200
    max_concurrency: int = 2


def assistant_settings() -> AssistantSettings:
    """Read assistant configuration without caching or logging secrets.

    Safe operational defaults make a correctly scoped ANTHROPIC_API_KEY the
    only required Sonnet variable. Every override remains fail-closed: an
    explicit disable, an unsupported provider/model, or unsafe privacy setting
    still prevents provider initialization.
    """
    provider = os.environ.get("EXCELBASE_ASSISTANT_PROVIDER", "anthropic").strip().lower()
    if provider not in {"disabled", "anthropic"}:
        provider = "disabled"
    pii_mode = os.environ.get("EXCELBASE_ASSISTANT_PII_MODE", "strict").strip().lower()
    if pii_mode != "strict":
        pii_mode = "strict"
    return AssistantSettings(
        enabled=_env_bool("EXCELBASE_ASSISTANT_ENABLED", default=True),
        provider=provider,
        model=os.environ.get("EXCELBASE_ASSISTANT_MODEL", "claude-sonnet-5").strip()[:200],
        api_key=_read_api_key(ANTHROPIC_API_KEY_VARIABLE),
        open_access=_env_bool("EXCELBASE_ASSISTANT_OPEN_ACCESS", default=False),
        allow_writes=_env_bool("EXCELBASE_ASSISTANT_ALLOW_WRITES", default=False),
        pii_mode=pii_mode,
        allow_raw_documents=_env_bool("EXCELBASE_ASSISTANT_ALLOW_RAW_DOCUMENTS"),
        max_context_records=_bounded_env_int("EXCELBASE_ASSISTANT_MAX_CONTEXT_RECORDS", 25, 1, 100),
        max_input_chars=_bounded_env_int("EXCELBASE_ASSISTANT_MAX_INPUT_CHARS", 12_000, 1_000, 100_000),
        max_history_turns=_bounded_env_int("EXCELBASE_ASSISTANT_MAX_HISTORY_TURNS", 8, 0, 30),
        max_output_tokens=_bounded_env_int("EXCELBASE_ASSISTANT_MAX_OUTPUT_TOKENS", 1_200, 64, 8_192),
        max_request_bytes=_bounded_env_int(
            "EXCELBASE_ASSISTANT_MAX_REQUEST_BYTES",
            64 * 1024,
            8 * 1024,
            256 * 1024,
        ),
        timeout_seconds=_bounded_env_int("EXCELBASE_ASSISTANT_TIMEOUT_SECONDS", 35, 5, 120),
        requests_per_minute=_bounded_env_int("EXCELBASE_ASSISTANT_REQUESTS_PER_MINUTE", 6, 1, 120),
        requests_per_day=_bounded_env_int("EXCELBASE_ASSISTANT_REQUESTS_PER_DAY", 100, 1, 10_000),
        global_requests_per_day=_bounded_env_int(
            "EXCELBASE_ASSISTANT_GLOBAL_REQUESTS_PER_DAY",
            200,
            1,
            100_000,
        ),
        max_concurrency=_bounded_env_int("EXCELBASE_ASSISTANT_MAX_CONCURRENCY", 2, 1, 20),
    )


# Kullaniciya gorunen dosya adedi siniri yoktur. Kaynak tuketimini dosya adedi
# yerine dosya basina boyut ve istemci tarafindaki sirali kuyruk kontrol eder.
# Pozitif bir deger ancak acil durum operasyonel freni olarak kullanilabilir.
MAX_UPLOAD_FILES = int(os.environ.get("GATEVISA_MAX_UPLOAD_FILES", "0"))
MAX_UPLOAD_BYTES = int(os.environ.get("GATEVISA_MAX_UPLOAD_BYTES", str(25 * 1024 * 1024)))
ALLOWED_IMPORT_EXTENSIONS = {".xlsx", ".xls", ".xlsm", ".ods", ".csv"}

# ZIP, iPhone'da onlarca ayrı dosya tutamacı yerine tek güvenilir aktarım
# sağlar. Adet sınırı yoktur; yalnızca sıkıştırılmış/sıkıştırılmamış toplam
# boyutlar kaynak tüketimini ve ZIP bombalarını sınırlar.
MAX_IMPORT_ARCHIVE_BYTES = int(
    os.environ.get("GATEVISA_MAX_IMPORT_ARCHIVE_BYTES", str(100 * 1024 * 1024))
)
MAX_IMPORT_ARCHIVE_UNCOMPRESSED_BYTES = int(
    os.environ.get("GATEVISA_MAX_IMPORT_ARCHIVE_UNCOMPRESSED_BYTES", str(300 * 1024 * 1024))
)

MAX_PHOTO_FILES = int(os.environ.get("GATEVISA_MAX_PHOTO_FILES", "300"))
MAX_PHOTO_BYTES = int(os.environ.get("GATEVISA_MAX_PHOTO_BYTES", str(25 * 1024 * 1024)))
MAX_RESTORE_BYTES = int(os.environ.get("GATEVISA_MAX_RESTORE_BYTES", str(30 * 1024 * 1024)))


def require_auth() -> bool:
    raw = os.environ.get("GATEVISA_REQUIRE_AUTH")
    if raw is not None:
        return raw.strip().lower() in {"1", "true", "yes", "on"}
    return os.environ.get("APP_ENV", "development").lower() == "production"


SESSION_COOKIE = os.environ.get("GATEVISA_SESSION_COOKIE", "gatevisa_session")
SESSION_DAYS = int(os.environ.get("GATEVISA_SESSION_DAYS", "14"))
MAX_AUDIT_EVENTS = int(os.environ.get("GATEVISA_MAX_AUDIT_EVENTS", "500"))
# Geri alma yalnızca SON aktarımı desteklediği için fazladan anlık görüntü saklamak
# her kayıtta tüm yolcu listesinin o kadar kopyasının veritabanına yazılması demek.
# 12 kopya, liste büyüyünce ücretsiz sunucuda kaydetmeyi yavaşlatıp şişiriyordu.
MAX_IMPORT_SNAPSHOTS = int(os.environ.get("GATEVISA_MAX_IMPORT_SNAPSHOTS", "2"))
