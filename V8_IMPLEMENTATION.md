# Excelbase V8 Implementation Record

## Hardening increment (2026-07-10)

| Area | Change |
|---|---|
| Authentication | JWT bearer support (`V8_JWT_SECRET`); dev headers stay opt-in and are refused in production |
| Encryption | Key-ID envelope ciphertexts (`v8:<key_id>:<token>`) with rotation via `V8_FIELD_ENCRYPTION_KEYS` |
| Passport exposure | List/detail responses return masked passports; full value via audited, rate-limited reveal endpoint |
| Photos | Upload/download/delete endpoints, `stored_objects` metadata, local + S3 adapters |
| Concurrency | `StaleDataError` → 409, `SELECT FOR UPDATE` on import commit, partial unique index on active passports |
| Audit | `audit_checkpoints` table; verification replays only events after the last checkpoint |
| API ergonomics | Pagination envelopes, per-identity rate limiting, structured JSON request logs |
| Migration | V7 backup migration now emits and enforces a verification report (`--verify-only` supported) |
| Deploy | `render.yaml` V8 service + managed Postgres; secrets stay in Render dashboard |
| CI | SQLite + PostgreSQL matrix, up/down/up migration smoke, Playwright e2e smoke job |

## Purpose

This package establishes a production-oriented V8 foundation without modifying the working V7 application.

## Architectural corrections

| V7 risk | V8 correction |
|---|---|
| Entire operation stored as one JSON payload | Normalized relational entities |
| DataFrame row numbers used as IDs | Persistent UUID identifiers |
| One global API key | Tenant membership and role context; dev identity is fail-closed in production |
| Passport values stored as ordinary strings | Encrypted ciphertext plus HMAC fingerprint |
| Photos stored as Base64 database text | Object-storage contract and metadata |
| Whole-state read/modify/write | Row-level CRUD and transactions |
| No stale-write protection | SQLAlchemy version columns and HTTP 409 conflicts |
| Destructive hard delete | Soft deletion |
| Timestamp-only audit ordering | Per-organization locked sequence and hash chain |
| Direct Excel mutation | Staging, redacted preview and atomic commit |

## Frontend pilot status

The former Next.js `/v8` pilot route and `api-v8.ts` client have been retired from the main application. The isolated V8 API, relational model, migrations and security controls remain available for direct API validation; the offline PWA does not depend on them.

## Included acceptance checks

- database health
- passport ciphertext verification
- audit chain linkage
- tenant isolation
- optimistic locking
- normalized duplicate detection
- invalid operation transition rejection
- staged-import redaction and atomic commit

## Deployment decision

Do not route public passenger traffic to V8 until OIDC/session integration and object-storage signed URLs are complete. V8 intentionally rejects production identity requests until that provider is connected.
