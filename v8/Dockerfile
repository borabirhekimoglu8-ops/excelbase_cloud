FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app
RUN useradd --create-home --shell /usr/sbin/nologin excelbase
COPY . /app
WORKDIR /app/v8
RUN pip install --upgrade pip==25.1.1 && pip install '.[postgres]'

USER excelbase
EXPOSE 8080
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080}"]
