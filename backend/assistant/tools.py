"""Capabilities Claude may exercise inside Excelbase.

Every tool here runs **in the browser**, against the encrypted local vault:
the server holds no passenger data, so it can neither read nor write a record.
The server's job is to publish this contract to the model, validate what comes
back, and refuse anything outside it.

Two invariants shape the schemas:

* **Pseudonymous by construction.** Tools address records by an opaque `ref`
  ("p_42"), never by name or passport number, and no tool accepts or returns an
  identifying field. Claude can therefore hold full operating authority without
  the vault's personal data crossing the provider boundary.
* **Destructive work is confirmable.** Tools that cannot be undone are marked
  ``confirm``; the client must obtain the operator's approval before executing
  one, no matter what the model asked for.
"""

from __future__ import annotations

from .provider import ProviderTool

# A record reference the browser can resolve locally. Names and passport
# numbers stay in the vault; the model only ever sees these tokens.
_REF = {
    "type": "string",
    "description": "Kayıt referansı, örn. 'p_42'. Ad veya pasaport numarası değildir.",
    "pattern": r"^[a-z]{1,4}_[A-Za-z0-9_-]{1,64}$",
}

_SCOPE = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "range": {"type": "string", "enum": ["all", "today", "week", "month"]},
    },
}

_ISSUE = {
    "type": "string",
    "enum": [
        "missing_photo",
        "missing_passport",
        "missing_voucher",
        "missing_fee",
        "duplicate",
        "missing_name",
        "invalid_date",
    ],
}


def _tool(
    name: str,
    description: str,
    properties: dict,
    required: list[str] | None = None,
    *,
    writes: bool = False,
    confirm: bool = False,
) -> ProviderTool:
    return ProviderTool(
        name=name,
        description=description,
        input_schema={
            "type": "object",
            "additionalProperties": False,
            "properties": properties,
            "required": required or [],
        },
        writes=writes,
        confirm=confirm,
    )


# --------------------------------------------------------------------- read
_READ_TOOLS: tuple[ProviderTool, ...] = (
    _tool(
        "dashboard_summary",
        "Seçili kapsam için toplu operasyon özetini döndürür: yolcu sayısı, "
        "hazır/eksik sayıları, hazırlık yüzdesi ve toplam ücret.",
        {"scope": _SCOPE},
    ),
    _tool(
        "search_passengers",
        "Yolcu kayıtlarını eksik türüne veya tarihe göre listeler. Yanıt yalnızca "
        "referans ve eksik listesi içerir; ad ve pasaport numarası döndürülmez.",
        {
            "scope": _SCOPE,
            "issue": _ISSUE,
            "limit": {"type": "integer", "minimum": 1, "maximum": 100},
        },
    ),
    _tool(
        "get_passenger_checklist",
        "Tek bir yolcunun evrak kontrol listesini referansla döndürür.",
        {"ref": _REF},
        ["ref"],
    ),
    _tool(
        "passenger_statistics",
        "Eksik türlerine göre dağılımı sayılarla döndürür.",
        {"scope": _SCOPE},
    ),
    _tool(
        "list_document_metadata",
        "Bir yolcunun evrak üstverisini döndürür: tür, boyut, tarih. Dosya "
        "içeriği ve dosya adı döndürülmez.",
        {"ref": _REF},
        ["ref"],
    ),
    _tool(
        "list_tasks",
        "Çalışma alanı görevlerini durumuna göre listeler.",
        {
            "status": {"type": "string", "enum": ["open", "done", "all"]},
            "limit": {"type": "integer", "minimum": 1, "maximum": 100},
        },
    ),
    _tool(
        "list_work_files",
        "İş dosyalarını listeler.",
        {"limit": {"type": "integer", "minimum": 1, "maximum": 100}},
    ),
)

# ------------------------------------------------------------------- memory
# Writes, but to the assistant's own notes rather than to operational records,
# so they are available even on a read-only deployment: remembering how an
# operation works changes nothing about the operation.
_MEMORY_TOOLS: tuple[ProviderTool, ...] = (
    _tool(
        "remember",
        "Sonraki konuşmalarda hatırlanmak üzere kalıcı bir not yazar. "
        "Operasyonun düzeni, tekrarlayan sorunlar ve kullanıcının tercihleri "
        "için kullan. Kişisel veri yazma; zaten sende yok.",
        {"text": {"type": "string", "minLength": 1, "maxLength": 400}},
        ["text"],
        writes=True,
    ),
    _tool(
        "forget",
        "Yanlış veya güncelliğini yitirmiş bir hatırayı siler.",
        {"ref": _REF},
        ["ref"],
        writes=True,
    ),
)

# -------------------------------------------------------------------- write
_WRITE_TOOLS: tuple[ProviderTool, ...] = (
    _tool(
        "update_passenger_flags",
        "Bir yolcunun evrak durum bayraklarını günceller. Yalnızca durum "
        "alanlarını değiştirir; ad, pasaport ve iletişim alanlarına dokunamaz.",
        {
            "ref": _REF,
            "flags": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "has_photo": {"type": "boolean"},
                    "has_passport": {"type": "boolean"},
                    "has_voucher": {"type": "boolean"},
                    "fee_paid": {"type": "boolean"},
                },
            },
        },
        ["ref", "flags"],
        writes=True,
    ),
    _tool(
        "create_task",
        "Operatör için bir görev oluşturur.",
        {
            "title": {"type": "string", "minLength": 1, "maxLength": 200},
            "detail": {"type": "string", "maxLength": 2000},
        },
        ["title"],
        writes=True,
    ),
    _tool(
        "complete_task",
        "Bir görevi tamamlandı olarak işaretler.",
        {"ref": _REF},
        ["ref"],
        writes=True,
    ),
    _tool(
        "create_note",
        "Çalışma alanına not ekler.",
        {
            "title": {"type": "string", "minLength": 1, "maxLength": 200},
            "body": {"type": "string", "maxLength": 8000},
        },
        ["title"],
        writes=True,
    ),
    # Irreversible: the browser must get the operator's approval first.
    _tool(
        "delete_passenger",
        "Bir yolcu kaydını siler. Geri alınamaz; operatör onayı gerekir.",
        {"ref": _REF},
        ["ref"],
        writes=True,
        confirm=True,
    ),
    _tool(
        "merge_duplicates",
        "Yinelenen yolcu kayıtlarını birleştirir. Geri alınamaz; operatör onayı gerekir.",
        {"passport_key": {"type": "string", "maxLength": 64}},
        writes=True,
        confirm=True,
    ),
)

ASSISTANT_TOOLS: tuple[ProviderTool, ...] = _READ_TOOLS + _MEMORY_TOOLS + _WRITE_TOOLS
TOOLS_BY_NAME: dict[str, ProviderTool] = {tool.name: tool for tool in ASSISTANT_TOOLS}
READ_TOOL_NAMES: frozenset[str] = frozenset(tool.name for tool in _READ_TOOLS)
WRITE_TOOL_NAMES: frozenset[str] = frozenset(tool.name for tool in _WRITE_TOOLS)
MEMORY_TOOL_NAMES: frozenset[str] = frozenset(tool.name for tool in _MEMORY_TOOLS)
CONFIRM_TOOL_NAMES: frozenset[str] = frozenset(
    tool.name for tool in ASSISTANT_TOOLS if tool.confirm
)

# A single answer may take several tool rounds; this bounds a runaway loop so a
# malformed plan cannot spend the budget indefinitely.
MAX_TOOL_STEPS = 8


def available_tools(*, allow_writes: bool) -> tuple[ProviderTool, ...]:
    """Publish the contract, narrowed when the deployment is read-only."""
    if allow_writes:
        return ASSISTANT_TOOLS
    # Memory survives a read-only deployment: it mutates the assistant's own
    # notes, never a passenger record.
    return _READ_TOOLS + _MEMORY_TOOLS
