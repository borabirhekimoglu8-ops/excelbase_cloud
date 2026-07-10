# Excelbase V8 Foundation

Excelbase V8 is an isolated, relational replacement foundation for the V7 global-JSON state model. V7 remains untouched and can continue serving production while V8 is validated.

## Implemented

- PostgreSQL-first normalized schema with Alembic migrations
- Permanent UUID identifiers; DataFrame row indexes are never used as IDs
- Multi-tenant organizations, users, memberships and roles
- Tenant-scoped repositories that return `404` for cross-organization object access
- Operations with an explicit state machine and optimistic locking
- Passengers with soft deletion and optimistic locking
- Passport encryption with Fernet plus HMAC fingerprinting for duplicate detection
- Import staging: parse → redact/encrypt → preview → atomic commit
- Import file SHA-256 idempotency protection
- Organization-serialized, hash-chained audit events
- Object-storage abstraction and metadata tables; binary data is not stored as Base64 in PostgreSQL
- Security headers and `private, no-store` API caching
- V7 JSON backup migration utility
- Integration tests and GitHub Actions CI

## Deliberate production gate

V8 currently supports identity headers only when `V8_ALLOW_DEV_IDENTITY=1`. Production mode refuses to run that path. OIDC/session integration must be connected before public production deployment. This prevents a temporary development mechanism from silently becoming production authentication.

## Apply to the existing repository

Extract the bundle, then from the bundle directory run:

```bash
./apply_to_repo.sh /path/to/excelbase_cloud
```

This adds only:

- `v8/`
- `.github/workflows/v8-ci.yml`
- `frontend/src/lib/api-v8.ts`
- `frontend/src/app/v8/` pilot route
- `V8_IMPLEMENTATION.md`

It does not replace V7 files.

## Local setup

```bash
cd v8
python scripts/generate_keys.py
cp .env.example .env
# Put the generated values into .env and export them in your shell.
python -m pip install -e '.[dev]'
alembic upgrade head
python scripts/bootstrap.py \
  --organization "Aegean Ops" \
  --slug aegean-ops \
  --email owner@example.com \
  --display-name "Owner"
uvicorn app.main:app --reload --port 8080
```

API documentation: `http://localhost:8080/api/v8/docs`

After applying the bundle and rebuilding the existing Next.js frontend, the isolated pilot screen is available at `/v8`. Set `NEXT_PUBLIC_V8_API_URL` to the V8 API origin.

For local development, send the two IDs printed by the bootstrap command:

```http
X-Organization-ID: <organization UUID>
X-User-ID: <user UUID>
```

## Docker with PostgreSQL

The compose file expects the build context to be the repository root because the transitional import adapter reuses the proven V7 Excel parser.

```bash
cd v8
export POSTGRES_PASSWORD='replace-me'
eval "$(python scripts/generate_keys.py | sed 's/^/export /')"
docker compose up --build
```

## Core API

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/v8/health` | Health and DB check |
| POST | `/api/v8/operations` | Create operation |
| GET | `/api/v8/operations` | List tenant operations |
| PATCH | `/api/v8/operations/{id}` | Versioned update/state transition |
| POST | `/api/v8/operations/{id}/passengers` | Create passenger |
| GET | `/api/v8/operations/{id}/passengers` | List passengers |
| PATCH | `/api/v8/passengers/{id}` | Versioned passenger update |
| DELETE | `/api/v8/passengers/{id}?version=N` | Soft delete |
| POST | `/api/v8/operations/{id}/imports` | Stage an Excel/CSV import |
| GET | `/api/v8/imports/{batch_id}` | Review staged rows |
| POST | `/api/v8/imports/{batch_id}/commit` | Atomically commit valid rows |
| GET | `/api/v8/audit` | Read tenant audit chain |

## V7 backup migration

First export a V7 JSON backup. Then:

```bash
python scripts/migrate_v7_backup.py \
  --input /path/to/gate-visa-backup.json \
  --organization-id <UUID> \
  --actor-id <UUID> \
  --origin Kuşadası \
  --destination Samos
```

The migration:

- groups records by departure date,
- creates one legacy operation per date,
- encrypts passport numbers,
- skips duplicate passports,
- reports undated and passportless records,
- records a migration audit event.

V7 photo blobs are intentionally not copied by this first migration. They should be exported to object storage with checksum verification in the next migration phase.

## Test

```bash
python -m pytest
ruff check app tests scripts
```

## Next production increments

1. OIDC provider and HttpOnly secure sessions
2. S3/R2 storage adapter with short-lived signed URLs
3. Background jobs for large import, photo processing and package generation
4. V7 photo migration with SHA-256 verification
5. PostgreSQL backup/restore drill and load testing
6. Next.js UI migration to `/api/v8`
