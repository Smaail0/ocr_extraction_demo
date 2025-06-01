# backend/services/azure.py

import asyncio
import logging
import tempfile
from pathlib import Path
import cv2
from dotenv import load_dotenv
from azure_model.pipeline import (
    classify_form,
    parse_bulletin_ocr as _pipeline_bulletin,       # could be async or sync
    parse_prescription_ocr as _pipeline_prescription # could be async or sync
)

load_dotenv(override=True)
logger = logging.getLogger("uvicorn")

# load your header templates once
PRESC_HDR = cv2.imread("assets/ordonnance_header1.png")
BULL_HDR  = cv2.imread("assets/bulletin_de_soin_header1.png")


async def classify_form_on_bytes(file_bytes: bytes, filename: str) -> str:
    # dump to disk so the sync classify_form can read it
    suffix = Path(filename).suffix or ".pdf"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(file_bytes)
        tmp_path = Path(tmp.name)
    try:
        # run the sync classify_form(...) on a thread
        return await asyncio.to_thread(
            classify_form,
            tmp_path, PRESC_HDR, BULL_HDR, None
        )
    finally:
        tmp_path.unlink(missing_ok=True)


async def parse_bulletin_ocr(file_bytes: bytes, filename: str) -> dict:
    """
    If your pipeline’s parse_bulletin_ocr is async, await it.
    If it’s sync, run it on a thread.
    """
    logger.info("→ parse_bulletin_ocr")
    result = _pipeline_bulletin(file_bytes, filename)
    if asyncio.iscoroutine(result):
        return await result
    # sync path:
    return await asyncio.to_thread(_pipeline_bulletin, file_bytes, filename)


async def parse_prescription_ocr(file_bytes: bytes, filename: str) -> dict:
    """
    Same trick for prescriptions.
    """
    logger.info("→ parse_prescription_ocr")
    result = _pipeline_prescription(file_bytes, filename)
    if asyncio.iscoroutine(result):
        return await result
    return await asyncio.to_thread(_pipeline_prescription, file_bytes, filename)
