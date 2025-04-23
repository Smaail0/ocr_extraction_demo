import os
from dotenv import load_dotenv
from starlette.concurrency import run_in_threadpool

from azure_model.pipeline import parse_bulletin_ocr as _parse

load_dotenv(override=True)

async def parse_bulletin_ocr(file_bytes: bytes, filename: str) -> dict:
    """
    Async wrapper so FastAPI’s event loop isn’t blocked.
    """
    return await run_in_threadpool(_parse, file_bytes, filename)