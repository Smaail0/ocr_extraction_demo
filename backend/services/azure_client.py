import os
import ssl
import certifi
from typing import Optional
from dotenv import load_dotenv
from azure.core.credentials import AzureKeyCredential
from azure.core.pipeline.transport import AioHttpTransport
from azure.ai.documentintelligence.aio import DocumentIntelligenceClient as AsyncDocumentClient

# Load .env vars
load_dotenv()

ENDPOINT = os.getenv("DOCUMENT_INTELLIGENCE_ENDPOINT")
KEY = os.getenv("DOCUMENT_INTELLIGENCE_API_KEY")

if not ENDPOINT or not KEY:
    raise EnvironmentError("Missing AZURE_OCR_ENDPOINT or AZURE_OCR_KEY in environment")

_AZURE_CLIENT: Optional[AsyncDocumentClient] = None

async def get_azure_client() -> AsyncDocumentClient:
    global _AZURE_CLIENT
    if _AZURE_CLIENT is None:
        ssl_context = ssl.create_default_context(cafile=certifi.where())
        ssl_context.check_hostname = True
        ssl_context.verify_mode = ssl.CERT_REQUIRED

        transport = AioHttpTransport(
            connection_ssl=ssl_context,
            connection_keep_alive=False
        )

        _AZURE_CLIENT = AsyncDocumentClient(
            endpoint=ENDPOINT,
            credential=AzureKeyCredential(KEY),
            transport=transport
        )
    return _AZURE_CLIENT
