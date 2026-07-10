.PHONY: install test lint migrate run keys

install:
	python -m pip install -e '.[dev,postgres]'

test:
	python -m pytest

lint:
	ruff check app tests scripts

migrate:
	alembic upgrade head

run:
	uvicorn app.main:app --reload --port 8080

keys:
	python scripts/generate_keys.py
