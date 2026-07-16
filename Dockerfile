FROM node:22-bookworm-slim AS frontend-build

WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend ./
RUN npm run build

FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt ./requirements.txt
RUN mkdir -p backend
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
RUN useradd --create-home --shell /usr/sbin/nologin appuser

COPY --chown=appuser:appuser . .
COPY --from=frontend-build --chown=appuser:appuser /app/frontend/out ./frontend/out

EXPOSE 8000
USER appuser
CMD ["sh", "-c", "uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
