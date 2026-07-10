# Excelbase V8 Implementation Record

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

## Frontend pilot

A separate Next.js `/v8` route and `api-v8.ts` client are included. V7 routes and state management remain unchanged. The pilot supports operation creation, passenger creation, staged import preview and commit.

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
