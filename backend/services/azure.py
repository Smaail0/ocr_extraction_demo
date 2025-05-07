import os
from dotenv import load_dotenv
from starlette.concurrency import run_in_threadpool

from azure_model.pipeline import parse_bulletin_ocr as _parse
from azure_model.pipeline import parse_ordonnance_ocr as _parse_ord



load_dotenv(override=True)

async def parse_bulletin_ocr(file_bytes: bytes, filename: str) -> dict:
    """ 
    Async wrapper so FastAPI’s event loop isn’t blocked.
    """
    return await run_in_threadpool(_parse, file_bytes, filename)

async def parse_ordonnance_ocr(file_bytes: bytes, filename: str) -> dict:
    """
    Async wrapper for prescription OCR processing.
    Ensures FastAPI's event loop isn't blocked.
    """
    result =  await run_in_threadpool(_parse_ord, file_bytes, filename)
    print("Prescription OCR result structure:", result)
    return result