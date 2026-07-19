# syntax=docker/dockerfile:1

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --system --uid 1001 --create-home ingest

# Requirements first so dependency layers stay cached when only main.py changes.
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY --chown=ingest:ingest main.py .

USER ingest
ENV PORT=4100
EXPOSE 4100
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "4100"]
