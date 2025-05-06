# backend/services/azure.py
import os
import cv2
import tempfile
from pathlib import Path
from dotenv import load_dotenv
from starlette.concurrency import run_in_threadpool

# import the real, sync pipeline functions under different names:
from azure_model.pipeline import (
  parse_bulletin_ocr   as _sync_parse_bulletin,
  parse_prescription_ocr as _sync_parse_prescription,
  classify_form        as _sync_classify_form,
)

load_dotenv(override=True)

async def classify_form_on_bytes(file_bytes: bytes, filename: str) -> str:
    suffix = Path(filename).suffix or ".pdf"
    tmp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(file_bytes)
            tmp_path = Path(tmp.name)

        presc_hdr  = cv2.imread("assets/ordonnance_header1.png")
        bullet_hdr = cv2.imread("assets/bulletin_de_soin_header1.png")
        if presc_hdr is None or bullet_hdr is None:
            raise RuntimeError("Could not load header images")

        # THIS must call the sync classify_form from the pipeline:
        return await run_in_threadpool(
            _sync_classify_form, tmp_path, presc_hdr, bullet_hdr, None
        )
    finally:
        if tmp_path and tmp_path.exists():
            tmp_path.unlink()


async def parse_bulletin_ocr(file_bytes: bytes, filename: str) -> dict:
    # delegate to your sync pipeline
    return await run_in_threadpool(_sync_parse_bulletin, file_bytes, filename)


async def parse_prescription_ocr(file_bytes: bytes, filename: str) -> dict:
    return await run_in_threadpool(_sync_parse_prescription, file_bytes, filename)
