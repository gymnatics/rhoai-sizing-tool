"""
RHOAI Sizing Wizard — Excel generation microservice.

Receives the wizard's combined state + calculated sizing result from the
Next.js app (app/api/generate-excel/route.ts) and returns a populated
.xlsx sizing workbook.

Run locally:
    cd excel-service
    pip install -r requirements.txt
    uvicorn main:app --reload --port 8000
"""

from __future__ import annotations

import logging

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from generator import generate_workbook

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("excel-service")

app = FastAPI(title="RHOAI Sizing Excel Service", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/generate")
async def generate(request: Request) -> Response:
    try:
        payload = await request.json()
    except Exception as exc:  # noqa: BLE001 - surface any parse error to the caller
        raise HTTPException(status_code=400, detail=f"Invalid JSON body: {exc}") from exc

    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Request body must be a JSON object.")

    try:
        xlsx_bytes = generate_workbook(payload)
    except Exception as exc:  # noqa: BLE001 - internal generation failure
        logger.exception("Failed to generate workbook")
        raise HTTPException(status_code=500, detail=f"Workbook generation failed: {exc}") from exc

    return Response(
        content=xlsx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="rhoai-sizing.xlsx"'},
    )
