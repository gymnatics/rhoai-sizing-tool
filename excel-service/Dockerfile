# RHOAI Sizing Wizard — Excel generation microservice
#
# Build from the repo root (rhoai-sizing-app/) so both excel-service/ and
# data/ are in the build context:
#   docker build -f excel-service/Dockerfile -t rhoai-sizing-excel-service .
FROM python:3.13-slim

WORKDIR /app

COPY excel-service/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY excel-service/ .
# generator.py resolves reference data at ../data relative to its own path
# (i.e. /data when WORKDIR is /app) — copy the repo's data/ there to match.
COPY data/ /data/

RUN useradd --uid 1001 --no-create-home appuser \
    && chown -R 1001:0 /app /data \
    && chmod -R g=u /app /data
USER 1001

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health').read()"

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
