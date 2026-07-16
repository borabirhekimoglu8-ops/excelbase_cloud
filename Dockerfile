FROM node:22-bookworm-slim AS frontend-build

# Render passes service env vars as Docker build args when declared with ARG.
ARG NEXT_PUBLIC_V8_API_URL
ENV NEXT_PUBLIC_V8_API_URL=${NEXT_PUBLIC_V8_API_URL}

WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend ./
RUN npm run build

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app
COPY requirements.txt ./requirements.txt
RUN mkdir -p backend
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
RUN useradd --create-home --shell /usr/sbin/nologin appuser \
    && install -d -o appuser -g appuser /var/lib/excelbase /var/lib/excelbase/photos

COPY --chown=appuser:appuser . .
COPY --from=frontend-build --chown=appuser:appuser /app/frontend/out ./frontend/out

EXPOSE 8000
USER appuser
STOPSIGNAL SIGTERM
# Keep Render's dynamic PORT support while making uvicorn the signal-receiving
# process.  The exec is also important for graceful queue lease release on OCI.
CMD ["sh", "-c", "exec uvicorn backend.main:app --host 0.0.0.0 --port \"${PORT:-8000}\""]
