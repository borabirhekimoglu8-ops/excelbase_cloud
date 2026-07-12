from __future__ import annotations

from email import policy
from email.parser import BytesParser


def parse_eml(data: bytes) -> dict:
    message = BytesParser(policy=policy.default).parsebytes(data)
    attachments: list[dict] = []
    for part in message.iter_attachments():
        filename = part.get_filename() or "ek-dosya"
        payload = part.get_payload(decode=True) or b""
        if not payload:
            continue
        attachments.append(
            {
                "filename": filename,
                "mime": part.get_content_type() or "application/octet-stream",
                "data": payload,
            }
        )
    return {
        "subject": str(message.get("subject", "")),
        "sender": str(message.get("from", "")),
        "date": str(message.get("date", "")),
        "attachments": attachments,
    }
