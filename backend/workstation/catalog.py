"""SQLite file catalogue for a mounted work folder.

Stores only path metadata and filename tokens — never spreadsheet cells,
PDF bodies, or image bytes. That keeps a 36 GB tree searchable without
turning the index into a second copy of the archive.
"""

from __future__ import annotations

import re
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path

# Cap keeps a runaway tree from filling the disk with index rows.
MAX_CATALOG_ROWS = 50_000

_TOKEN_RE = re.compile(r"[A-Za-z0-9ÇĞİÖŞÜçğıöşü_-]{2,}")
_C_CODE_RE = re.compile(r"(?<![A-Za-z0-9])[Cc][-_ ]?\d{2,8}(?![0-9])")
_DATE_RE = re.compile(r"20\d{2}[-_.]?(?:0[1-9]|1[0-2])[-_.]?(?:0[1-9]|[12]\d|3[01])")

SPREADSHEET = {".xlsx", ".xlsm", ".xls", ".csv", ".ods"}
DOCUMENT = {".pdf", ".doc", ".docx", ".rtf", ".txt", ".md"}
IMAGE = {".jpg", ".jpeg", ".png", ".heic", ".webp", ".gif", ".bmp", ".tif", ".tiff", ".avif"}
SKIP_DIRS = {
    ".git",
    "node_modules",
    "__pycache__",
    ".venv",
    "venv",
    "$RECYCLE.BIN",
    "System Volume Information",
    ".tmp.drivedownload",
    ".Trash",
    ".excelbase-workstation",
}


@dataclass(frozen=True, slots=True)
class CatalogEntry:
    path: str
    name: str
    kind: str
    suffix: str
    size: int
    mtime: float
    parent: str
    has_c_code: bool
    has_date: bool

    def as_dict(self) -> dict:
        return {
            "path": self.path,
            "name": self.name,
            "kind": self.kind,
            "suffix": self.suffix,
            "size": self.size,
            "mtime": self.mtime,
            "parent": self.parent,
            "has_c_code": self.has_c_code,
            "has_date": self.has_date,
        }


def kind_for(suffix: str) -> str:
    lowered = suffix.lower()
    if lowered in SPREADSHEET:
        return "tablo"
    if lowered in DOCUMENT:
        return "belge"
    if lowered in IMAGE:
        return "gorsel"
    return "diger"


def default_db_path(root: Path) -> Path:
    return root / ".excelbase-workstation" / "catalog.sqlite3"


def connect(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS files (
            path TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            kind TEXT NOT NULL,
            suffix TEXT NOT NULL,
            size INTEGER NOT NULL,
            mtime REAL NOT NULL,
            parent TEXT NOT NULL,
            has_c_code INTEGER NOT NULL,
            has_date INTEGER NOT NULL,
            tokens TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_files_name ON files(name);
        CREATE INDEX IF NOT EXISTS idx_files_kind ON files(kind);
        CREATE INDEX IF NOT EXISTS idx_files_tokens ON files(tokens);
        """
    )
    return conn


def _tokens_for(name: str) -> str:
    return " ".join(sorted({match.group(0).lower() for match in _TOKEN_RE.finditer(name)}))


def rebuild_catalog(root: Path, db_path: Path | None = None) -> dict:
    """Walk ``root`` and replace the catalogue. Returns aggregate stats only."""
    resolved = root.expanduser().resolve()
    target = db_path or default_db_path(resolved)
    conn = connect(target)
    try:
        conn.execute("DELETE FROM files")
        seen = 0
        truncated = False
        by_kind: dict[str, int] = {"tablo": 0, "belge": 0, "gorsel": 0, "diger": 0}
        total_bytes = 0
        c_code_files = 0
        dated_files = 0

        for dirpath, dirnames, filenames in os_walk_safe(resolved):
            dirnames[:] = [name for name in dirnames if name not in SKIP_DIRS]
            for filename in filenames:
                if seen >= MAX_CATALOG_ROWS:
                    truncated = True
                    break
                path = Path(dirpath) / filename
                try:
                    stat = path.stat()
                except OSError:
                    continue
                if not path.is_file():
                    continue
                suffix = path.suffix.lower()
                kind = kind_for(suffix)
                name = path.name
                has_c = bool(_C_CODE_RE.search(name))
                has_date = bool(_DATE_RE.search(name))
                relative = str(path.relative_to(resolved))
                parent = str(Path(relative).parent).replace("\\", "/")
                if parent == ".":
                    parent = ""
                conn.execute(
                    """
                    INSERT OR REPLACE INTO files
                    (path, name, kind, suffix, size, mtime, parent, has_c_code, has_date, tokens)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        relative.replace("\\", "/"),
                        name,
                        kind,
                        suffix,
                        int(stat.st_size),
                        float(stat.st_mtime),
                        parent,
                        1 if has_c else 0,
                        1 if has_date else 0,
                        _tokens_for(name),
                    ),
                )
                seen += 1
                by_kind[kind] = by_kind.get(kind, 0) + 1
                total_bytes += int(stat.st_size)
                c_code_files += 1 if has_c else 0
                dated_files += 1 if has_date else 0
            if truncated:
                break

        built_at = str(time.time())
        for key, value in {
            "root": str(resolved),
            "built_at": built_at,
            "files_seen": str(seen),
            "truncated": "1" if truncated else "0",
            "total_bytes": str(total_bytes),
            "c_code_files": str(c_code_files),
            "dated_files": str(dated_files),
            "by_kind_tablo": str(by_kind.get("tablo", 0)),
            "by_kind_belge": str(by_kind.get("belge", 0)),
            "by_kind_gorsel": str(by_kind.get("gorsel", 0)),
            "by_kind_diger": str(by_kind.get("diger", 0)),
        }.items():
            conn.execute(
                "INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)",
                (key, value),
            )
        conn.commit()
        return stats_from_connection(conn)
    finally:
        conn.close()


def os_walk_safe(root: Path):
    """os.walk wrapper kept local so tests can patch one place if needed."""
    import os

    return os.walk(root)


def stats_from_connection(conn: sqlite3.Connection) -> dict:
    meta = {row["key"]: row["value"] for row in conn.execute("SELECT key, value FROM meta")}
    return {
        "root": meta.get("root", ""),
        "built_at": float(meta["built_at"]) if meta.get("built_at") else 0.0,
        "files_seen": int(meta.get("files_seen", "0")),
        "truncated": meta.get("truncated") == "1",
        "total_bytes": int(meta.get("total_bytes", "0")),
        "c_code_files": int(meta.get("c_code_files", "0")),
        "dated_files": int(meta.get("dated_files", "0")),
        "by_kind": {
            "tablo": int(meta.get("by_kind_tablo", "0")),
            "belge": int(meta.get("by_kind_belge", "0")),
            "gorsel": int(meta.get("by_kind_gorsel", "0")),
            "diger": int(meta.get("by_kind_diger", "0")),
        },
    }


def load_stats(db_path: Path) -> dict | None:
    if not db_path.exists():
        return None
    conn = connect(db_path)
    try:
        return stats_from_connection(conn)
    finally:
        conn.close()


def search(
    db_path: Path,
    query: str,
    *,
    kind: str | None = None,
    limit: int = 40,
) -> list[CatalogEntry]:
    if not db_path.exists():
        return []
    needle = query.strip().lower()
    if not needle:
        return []
    limit = max(1, min(100, int(limit)))
    conn = connect(db_path)
    try:
        clauses = ["(lower(name) LIKE ? OR lower(path) LIKE ? OR tokens LIKE ?)"]
        params: list[object] = [f"%{needle}%", f"%{needle}%", f"%{needle}%"]
        if kind:
            clauses.append("kind = ?")
            params.append(kind)
        params.append(limit)
        sql = (
            "SELECT path, name, kind, suffix, size, mtime, parent, has_c_code, has_date "
            f"FROM files WHERE {' AND '.join(clauses)} "
            "ORDER BY mtime DESC LIMIT ?"
        )
        rows = conn.execute(sql, params).fetchall()
        return [
            CatalogEntry(
                path=row["path"],
                name=row["name"],
                kind=row["kind"],
                suffix=row["suffix"],
                size=int(row["size"]),
                mtime=float(row["mtime"]),
                parent=row["parent"],
                has_c_code=bool(row["has_c_code"]),
                has_date=bool(row["has_date"]),
            )
            for row in rows
        ]
    finally:
        conn.close()
