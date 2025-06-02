import os
import logging
from pathlib import Path
import tempfile, os
import cv2

# Set up logger
logger = logging.getLogger(__name__)
import re
import numpy as np
import pandas as pd
from rapidfuzz import process, fuzz
from pdf2image import convert_from_path, convert_from_bytes
from dotenv import load_dotenv, find_dotenv
from azure.core.credentials import AzureKeyCredential
from azure.ai.documentintelligence import DocumentIntelligenceClient
from azure.ai.documentintelligence.aio import DocumentIntelligenceClient as AsyncDocumentClient
from azure.ai.documentintelligence import DocumentIntelligenceClient as SyncDocumentClient
import asyncio
from azure.core.credentials import AzureKeyCredential
from azure.core.exceptions import AzureError
from datetime import datetime
from typing import Optional, List, Dict
from .signature_pipeline import get_doctor_name, get_signature_crop

load_dotenv(override=True)

ENDPOINT = os.getenv("DOCUMENT_INTELLIGENCE_ENDPOINT")
KEY = os.getenv("DOCUMENT_INTELLIGENCE_API_KEY")
    
if not (ENDPOINT and KEY):
    raise SystemExit("Set DOCUMENT_INTELLIGENCE_ENDPOINT & DOCUMENT_INTELLIGENCE_API_KEY in .env")

_AZURE_CLIENT: Optional[AsyncDocumentClient] = None
async def get_azure_client() -> AsyncDocumentClient:
    global _AZURE_CLIENT
    if _AZURE_CLIENT is None:
        _AZURE_CLIENT = AsyncDocumentClient(ENDPOINT, AzureKeyCredential(KEY))
    return _AZURE_CLIENT

current_dir = os.path.dirname(os.path.abspath(__file__))
amm_path = os.path.join(current_dir, "liste_amm.xls")
med_ref = pd.read_excel(
    amm_path,
    usecols=["Nom", "Dosage", "Forme"],
    dtype={"Nom": str, "Dosage": str, "Forme": str},  # force them to strings
)

choices = med_ref["Nom"].dropna().tolist()
cleaned_choices = [ re.sub(r"\W+", "", c.lower()) for c in choices ]

client = DocumentIntelligenceClient(ENDPOINT, AzureKeyCredential(KEY))
model_id = os.getenv("ORDONNANCE_MODEL_ID")

def analyze_document(scan_path: Path, model_id: str, pages: List[str] | None = None):
    with open(scan_path, "rb") as f:
        poller = client.begin_analyze_document(
            model_id=model_id,
            body=f,
            pages=pages
        )
    try:
        # give up after 60s
        return poller.result(timeout=60)
    except Exception as e:
        logger.error(f"[analyze_document] Azure call failed or timed-out: {e}", exc_info=True)
        raise

def normalize_date(raw: str) -> Optional[str]:
    if not raw:
        return None
    s = raw.replace("Le", "").replace("\n", " ").strip()
    m = re.search(r"(\d{1,2})[\/\.\-\s]+(\d{1,2})[\/\.\-\s]+(\d{2,4})", s)
    if not m:
        return None
    day, month, year = m.groups()
    if len(year) == 2:
        year = "20" + year
    try:
        dt = datetime(int(year), int(month), int(day))
        return dt.date().isoformat()
    except ValueError:
        return None
    
def split_and_correct(raw: str, med_ref: pd.DataFrame, threshold: int = 90):
    # 1) split into plausible segments
    segments = re.split(r"\d+\)\s*|\n+|[,;]\s*|/\s*(?=[A-Za-z])", raw)
    segments = [s.strip(" .,'–-\n") for s in segments if re.search(r"[A-Za-z]", s)]
    
    results = []
    seen = set()
    
    for seg in segments:
        working = seg  # we'll strip out matched meds as we go
        while True:
            # normalize working text for matching
            norm = re.sub(r"\W+", "", working.lower())

            # full‐string match
            match_clean, score, idx = process.extractOne(
                norm, cleaned_choices, scorer=fuzz.token_set_ratio
            )

            official   = choices[idx]
            clean_off  = re.sub(r"\W+", "", official.lower())
            # also check a partial‐ratio
            partial_sp = fuzz.partial_ratio(clean_off, norm)

            # now *both* must clear your threshold:
            if score < threshold or partial_sp < threshold:
                break
            
            # avoid duplicates
            if official in seen:
                break
            
            # grab dosage & forme
            row     = med_ref.iloc[idx]
            raw_dos = row["Dosage"]
            dosage  = "" if pd.isna(raw_dos) else str(raw_dos).strip()
            raw_for = row["Forme"]
            forme   = "" if pd.isna(raw_for) else str(raw_for).strip()
            
            produit = f"{official} {dosage}".strip()
            results.append({
                "raw":          seg,
                "matched_name": official,
                "score":        score,
                "dosage":       dosage,
                "forme":        forme,
                "produit":      produit,
            })
            seen.add(official)
            
            working = re.sub(re.escape(official), "", working, flags=re.IGNORECASE).strip()
        
    return results

def dump_results(result, output_txt: Path, min_conf: float = 0.1):

    lines = []

    # --- Fields ---
    for doc in result.documents:
        lines.append(f"## Document type={doc.doc_type!r}  conf={doc.confidence:.2f}")
        for name, field in doc.fields.items():
            # pick the best value
            if "valueString" in field:
                val = field["valueString"]
            elif "valueSelectionMark" in field:
                val = field["valueSelectionMark"]
            else:
                val = field.get("content", "")

            conf = field.get("confidence", 0.0)
            status = "OK" if conf >= min_conf else "LOW"

            # normalize checkbox to boolean
            if "valueSelectionMark" in field:
                val = (val.lower() == "selected")

            # format with status
            lines.append(f"{name}: {val!r}    (conf={conf:.2f}, status={status})")
        lines.append("")  # blank line between docs

    # --- Tables ---
    for ti, table in enumerate(result.tables, start=1):
        pg = table.bounding_regions[0].page_number
        lines.append(f"## Table #{ti} (page {pg})")
        # rebuild 2D array
        mat = [["" for _ in range(table.column_count)] for _ in range(table.row_count)]
        for cell in table.cells:
            mat[cell.row_index][cell.column_index] = cell.content
        for row in mat:
            lines.append(" | ".join(row))
        lines.append("")

    # write out
    output_txt.write_text("\n".join(lines), encoding="utf-8")
    logging.info("✅ OCR results saved to %s", output_txt)

def load_all_pages(path: Path, poppler_path: str | None = None):

    if path.suffix.lower() == ".pdf":
        pages = convert_from_path(str(path), dpi=300, poppler_path=poppler_path)
        return [cv2.cvtColor(np.array(p), cv2.COLOR_RGB2BGR) for p in pages]
    img = cv2.imread(str(path))
    if img is None:
        raise FileNotFoundError(f"Cannot open {path!r}")
    return [img]

def detect_and_compute(gray: np.ndarray):
    orb = cv2.ORB_create(2000)
    return orb.detectAndCompute(gray, None)

def count_good_matches(desT, desS, ratio=0.75):
    if desT is None or desS is None:
        return 0
    bf = cv2.BFMatcher(cv2.NORM_HAMMING)
    matches = bf.knnMatch(desT, desS, k=2)
    return sum(1 for m,n in matches if m.distance < ratio * n.distance)

def classify_form(
    scan_path: Path,
    presc_hdr_img: np.ndarray,
    bullet_hdr_img: np.ndarray,
    poppler: str | None = None
) -> str:
    
    p_gray = cv2.cvtColor(presc_hdr_img, cv2.COLOR_BGR2GRAY)
    b_gray = cv2.cvtColor(bullet_hdr_img, cv2.COLOR_BGR2GRAY)
    _, des_p = detect_and_compute(p_gray)
    _, des_b = detect_and_compute(b_gray)

    best = ("unknown", -1)
    pages = load_all_pages(scan_path, poppler_path=poppler)
    for page in pages:
        g = cv2.cvtColor(page, cv2.COLOR_BGR2GRAY)
        _, des_s = detect_and_compute(g)
        mp = count_good_matches(des_p, des_s)
        mb = count_good_matches(des_b, des_s)
        if mp > best[1]:
            best = ("prescription", mp)
        if mb > best[1]:
            best = ("bulletin_de_soin", mb)

    logging.info("▷ classified as %r (best score=%d)", best[0], best[1])
    return best[0]

def format_prescription_id(raw: str) -> str:
    digits = re.sub(r"\D+", "", raw or "")
    parts = [
        digits[0:4],
        digits[4:8],
        digits[8:10],
        digits[10:11],
        digits[11:12],
    ]
    parts = [p if p else "0" for p in parts]
    return "-".join(parts)

def extract_grid(tbl) -> List[List[str]]:
    grid = [[""] * tbl.column_count for _ in range(tbl.row_count)]
    for cell in tbl.cells:
        grid[cell.row_index][cell.column_index] = cell.content.strip()
    return grid

def table_to_objects(grid: List[List[str]], cols: List[str]) -> List[Dict[str,str]]:
    out: List[Dict[str,str]] = []
    for row in grid[1:]:
        obj = { cols[i]: row[i] if i < len(row) else "" for i in range(len(cols)) }
        out.append(obj)
    return out

def _parse_bulletin_tables_and_fields(
    flds: Dict[str, Dict],
    tables: List,
) -> Dict[str, object]:
    """
    Synchronous helper to:
    - Verify at least one table
    - Convert each of the 8 tables into arrays of objects
    - Extract all simple fields (txt/chk)
    """
    # 1) Guard: must have at least one table
    if not tables or len(tables) == 0:
        raise ValueError("OCR returned no tables; this doesn’t look like a Bulletin de soin.")

    # 2) Prepare txt() and chk() helpers
    def txt(k: str) -> str:
        fld = flds.get(k)
        return (fld.get("valueString") or fld.get("content") or "").strip() if fld else ""

    def chk(k: str) -> bool:
        fld = flds.get(k)
        return (fld.get("valueSelectionMark", "").lower() == "selected") if fld else False

    # 3) Extract & pad grids
    grids = [extract_grid(tbl) for tbl in tables]
    while len(grids) < 8:
        grids.append([[]])

    # 4) Map each of the 8 tables
    consultations_dentaires = table_to_objects(
        grids[0],
        ["date","dent","codeActe","cotation","honoraires","codePs","signature"]
    )
    protheses_dentaires     = table_to_objects(
        grids[1],
        ["date","dents","codeActe","cotation","honoraires","codePs","signature"]
    )
    consultations_visites   = table_to_objects(
        grids[2],
        ["date","designation","honoraires","codePs","signature"]
    )
    actes_medicaux          = table_to_objects(
        grids[3],
        ["date","designation","honoraires","codePs","signature"]
    )
    actes_paramed           = table_to_objects(
        grids[4],
        ["date","designation","honoraires","codePs","signature"]
    )
    biologie                = table_to_objects(
        grids[5],
        ["date","montant","codePs","signature"]
    )
    hospitalisation         = table_to_objects(
        grids[6],
        ["date","codeHosp","forfait","codeClinique","signature"]
    )
    pharmacie               = table_to_objects(
        grids[7],
        ["date","montant","codePs","signature"]
    )

    # 5) Extract other fields & checkboxes
    dossier_id   = txt("id_dossier") or ""
    formatted_id = format_prescription_id(txt("id_unique") or "")

    prenom  = txt("prenom_assure") or ""
    nom     = txt("nom_assure")     or ""
    adresse = txt("adresse_assure") or ""
    code_po = txt("code_postal")    or ""
    cnrps_c = chk("cnrps_check")
    cnss_c  = chk("cnss_check")
    conv_c  = chk("convention_check")

    mal_prenom = txt("prenom_malade") or ""
    mal_nom    = txt("nom_malade")    or ""
    mal_birth  = txt("date_naissance_malade") or ""
    nom_pr_mal = txt("nom_prenom_malade")    or ""
    date_prevu = txt("date_prevu")           or ""

    apci_c        = chk("apci_check")
    mo_c          = chk("mo_check")
    hosp_req_c    = chk("hospitalisation_check")
    suivi_gross_c = chk("suivi_grossesse_check")
    conjoint_c    = chk("conjoint")
    ascendant_c   = chk("ascendant")
    assure_soc    = cnrps_c or cnss_c

    # 6) Assemble everything into a dict
    return {
        "prenom":               prenom,
        "nom":                  nom,
        "adresse":              adresse,
        "codePostal":           code_po,
        "refDossier":           dossier_id,
        "identifiantUnique":    formatted_id,
        "cnrps":                cnrps_c,
        "cnss":                 cnss_c,
        "convbi":               conv_c,
        "prenomMalade":         mal_prenom,
        "nomMalade":            mal_nom,
        "dateNaissance":        mal_birth,
        "numTel":               txt("telephone") or "",
        "assureSocial":         assure_soc,
        "conjoint":             conjoint_c,
        "ascendant":            ascendant_c,
        "enfant":               chk("enfant"),
        "apci":                 apci_c,
        "mo":                   mo_c,
        "hosp":                 hosp_req_c,
        "grossesse":            suivi_gross_c,

        "consultationsDentaires":    consultations_dentaires,
        "prothesesDentaires":        protheses_dentaires,
        "consultationsVisites":      consultations_visites,
        "actesMedicaux":             actes_medicaux,
        "actesParamed":              actes_paramed,
        "biologie":                  biologie,
        "hospitalisation":           hospitalisation,
        "pharmacie":                 pharmacie,
    }

async def parse_bulletin_ocr(file_bytes: bytes, filename: str) -> Dict:
    logger.info(f"[parse_bulletin_ocr] start {filename}")
    t0 = datetime.utcnow()

    try:
        client = await get_azure_client()

        if not model_id:
            raise ValueError("BULLETIN_MODEL_ID is not set in the environment")

        # 1) Send bytes directly to Azure
        poller = await client.begin_analyze_document(
            model_id=os.getenv("BULLETIN_MODEL_ID"),
            body=file_bytes
        )
        result = await asyncio.wait_for(poller.result(), timeout=60)
        elapsed_azure = (datetime.utcnow() - t0).total_seconds()
        logger.info(f"[parse_bulletin_ocr] Azure returned in {elapsed_azure:.1f}s")

        # 2) Extract fields + tables
        doc    = result.documents[0]
        flds   = doc.fields
        tables = result.tables

        # 3) Offload all table‐and‐field parsing into a thread
        parsed_data = await asyncio.to_thread(_parse_bulletin_tables_and_fields, flds, tables)

        # 4) Merge with the header
        output = {"header": {"documentType": "bulletin_de_soin"}}
        output.update(parsed_data)

        elapsed_total = (datetime.utcnow() - t0).total_seconds()
        logger.info(f"[parse_bulletin_ocr] completed in {elapsed_total:.1f}s")
        return output

    except Exception as e:
        logger.exception(f"[parse_bulletin_ocr] unexpected error for {filename}: {e}")
        raise

def extract_all_tables(result) -> List[List[List[str]]]:
    """
    Given an Azure DocumentAnalysis result with `result.tables`,
    returns a list of 2D string grids: each grid[row][col] is the cell content.
    """
    all_grids = []
    for tbl in result.tables:
        # initialize an empty grid sized to the table
        grid = [[""] * tbl.column_count for _ in range(tbl.row_count)]
        # fill in each recognized cell
        for cell in tbl.cells:
            grid[cell.row_index][cell.column_index] = cell.content.strip()
        all_grids.append(grid)
    return all_grids

#def analyze_document(scan_path: Path, model_id: str, pages: list[str] | None):
    with open(scan_path, "rb") as f:
        poller = client.begin_analyze_document(model_id, body=f, pages=pages)
    return poller.result()

def has_signature_coordinates(result) -> bool:
    doc = result.documents[0]
    sig_field = doc.fields.get("docteurSignatureRegion")
    if not sig_field:
        return False
    bounding_regions = getattr(sig_field, "bounding_regions", None)
    return bool(bounding_regions and len(bounding_regions) > 0)

def _fmt_fr(n: float, decimals: int = 3) -> str:
    # US‐style group + fixed decimals, e.g. "7,370.000"
    s = f"{n:,.{decimals}f}"
    # split integer vs. fraction
    int_part, frac_part = s.split('.')
    # replace US thousands comma with NBSP
    int_part = int_part.replace(',', '\u00A0')
    # swap decimal point to comma
    return f"{int_part},{frac_part}"

def _parse_tables_and_legacy(tables) -> tuple[List[Dict], str]:
    """
    Returns (items, total) by looking at the 8-col and 5-col tables.
    """
    def extract_grid(tbl):
        mat = [[""] * tbl.column_count for _ in range(tbl.row_count)]
        for cell in tbl.cells:
            mat[cell.row_index][cell.column_index] = cell.content.strip()
        return mat

    matrices = [(tbl.column_count, extract_grid(tbl)) for tbl in tables]

    items = []
    total = ""
    # 8-col table
    items_mat = next((m for c, m in matrices if c >= 8), None)
    if items_mat and len(items_mat) > 1:
        for row in items_mat[1:-1]:
            cells = (row + [""] * 8)[:8]
            items.append({
                "codePCT":      cells[0].strip(),
                "produit":      cells[1].strip(),
                "forme":        cells[2].strip(),
                "qte":          cells[3].strip(),
                "puv":          cells[4].strip(),
                "montantPercu": cells[5].strip(),
                "nio":          cells[6].strip(),
                "prLot":        cells[7].strip(),
            })
        footer = items_mat[-1]
        if footer and footer[0].lower().startswith("total"):
            total = footer[0].strip()

    # Fallback 5-col table if no items yet
    if not items:
        legacy_mat = next((m for c, m in matrices if c == 5), None)
        if legacy_mat and len(legacy_mat) > 1:
            for row in legacy_mat[1:]:
                a, b, c, d, *_ = (row + [""] * 5)[:5]
                puv = re.sub(r"[^\d\.,]", "", c.strip())
                qte = re.sub(r"\D", "", d.strip())
                try:
                    puv_n = float(puv.replace(",", "."))
                except:
                    puv_n = 0.0
                try:
                    qte_n = int(qte)
                except:
                    qte_n = 0
                line_total = puv_n * qte_n
                items.append({
                    "codePCT":      a.strip(),
                    "produit":      b.strip(),
                    "forme":        "",
                    "qte":          qte,
                    "puv":          puv,
                    "montantPercu": f"{line_total:,.0f}" if line_total else "",
                    "nio":          "",
                    "prLot":        "",
                })
            if not total:
                valid_amounts = []
                for it in items:
                    raw_val = it.get("montantPercu", "").strip().replace("\u00A0", "").replace(",", "")
                    if raw_val:
                        try:
                            valid_amounts.append(float(raw_val))
                        except:
                            pass
                total = f"{sum(valid_amounts):,.0f}" if valid_amounts else ""

    # If all rows are blank, return empty
    if items and all(not it["produit"] for it in items):
        items = []

    return items, total

def _free_text_fallback(flds: Dict, med_ref: pd.DataFrame, cleaned_choices: List[str]) -> List[Dict]:
    """
    If no table items found, try fuzzy‐matching on the free‐text 'medicaments' field.
    """
    meds_text = ""
    fld = flds.get("medicaments")
    if fld:
        meds_text = (fld.get("valueString") or fld.get("content") or "").strip()

    items = []
    if meds_text:
        # Split tokens by comma/semicolon/whitespace
        tokens = [t.strip().lower() for t in re.split(r"[;,]+", meds_text) if t.strip()]
        for token in tokens:
            prefix = token[:2]
            candidates = [c for c in cleaned_choices if c.lower().startswith(prefix)]
            if not candidates:
                continue
            corrected = process.extract(token, candidates, scorer=fuzz.token_set_ratio, limit=5)
            for match, score, idx in corrected:
                if score >= 85:
                    row = med_ref.iloc[idx]
                    items.append({
                        "codePCT": "",
                        "produit": choices[idx],
                        "forme":   row["Forme"],
                        "qte":     "",
                        "puv":     "",
                        "montantPercu": "",
                        "nio":     "",
                        "prLot":   "",
                    })
    return items

def _parse_metadata(flds: Dict) -> Dict[str, Optional[str]]:
    """
    Extract fields like beneficiaryId, patientIdentity, prescriberCode, dates, regimen.
    """
    beneficiaryId = patientIdentity = prescriberCode = None
    prescriptionDate = regimen = dispensationDate = None

    # Suppose the table of metadata has 2 columns: key‐cell, value‐cell
    meta_mat = flds.get("metadata_table")  # or however you identify that table
    if meta_mat:
        for kcell, vcell in meta_mat:
            key = kcell.strip().lower()
            val = vcell.strip()
            if "bénéficiaire" in key:
                beneficiaryId = val
            elif "identité" in key and "malade" in key:
                patientIdentity = val
            elif "prescripteur" in key:
                prescriberCode = val
            elif "date de la prescription" in key:
                prescriptionDate = val or prescriptionDate
            elif "date de dispensation" in key:
                dispensationDate = val or dispensationDate
            elif "régime" in key:
                regimen = val or regimen

    return {
        "beneficiaryId":     beneficiaryId,
        "patientIdentity":   patientIdentity,
        "prescriberCode":    prescriberCode,
        "prescriptionDate":  prescriptionDate,
        "regimen":           regimen,
        "dispensationDate":  dispensationDate
    }

def _final_fallbacks(flds: Dict[str, Dict]) -> Dict[str, Optional[str]]:
    """
    Fill in beneficiaryId, patientIdentity, etc. directly from the flds dict.
    """
    def txt(key: str) -> str:
        fld = flds.get(key)
        return (fld.get("valueString") or fld.get("content") or "").strip() if fld else ""

    beneficiaryId     = txt("id_unique")
    patientIdentity   = txt("nom_prenom")
    prescriberCode    = txt("code_apci")
    prescriptionDate  = normalize_date(txt("date"))
    dispensationDate  = normalize_date(txt("date_numero"))
    regimen           = txt("regime")

    return {
        "formatted_id":      format_prescription_id(beneficiaryId),
        "patientIdentity":   patientIdentity,
        "prescriberCode":    prescriberCode,
        "prescriptionDate":  prescriptionDate,
        "dispensationDate":  dispensationDate,
        "regimen":           regimen
    }

async def parse_prescription_ocr(file_bytes: bytes, filename: str) -> Dict:
    logger.info(f"[parse_prescription_ocr] start {filename}")
    t0 = datetime.utcnow()
    tmp_path: Optional[Path] = None

    try:
        # ── 1) Write bytes to temp file ─────────────────────────────────
        suffix = Path(filename).suffix or ".pdf"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(file_bytes)
            tmp_path = Path(tmp.name)
        logger.info(f"[parse_prescription_ocr] temp file at {tmp_path}")

        # ── 2) Call Azure’s analyze API ───────────────────────────────────
        client = await get_azure_client()
        poller = await client.begin_analyze_document(
            model_id=model_id,
            body=file_bytes
        )
        result = await asyncio.wait_for(poller.result(), timeout=60)
        elapsed_azure = (datetime.utcnow() - t0).total_seconds()
        logger.info(f"[parse_prescription_ocr] Azure returned in {elapsed_azure:.1f}s")

        # ── 3) Pull out fields + tables ──────────────────────────────────
        doc    = result.documents[0]
        flds   = doc.fields
        tables = result.tables

        # ── 4) Parse “items” in background ──────────────────────────────
        items_and_total_task = asyncio.to_thread(_parse_tables_and_legacy, tables)

        # ── 5) If Azure found a signature region, run your old helpers ──
        sig_crop_file = None
        doc_name      = ""
        if has_signature_coordinates(result):
            logger.debug("Cropping signature via thread")
            # 5a) get_doctor_name(tmp_path, _SYNC_CLIENT, model_id) runs in a sync thread
            doc_name = await asyncio.to_thread(get_doctor_name, tmp_path, _AZURE_CLIENT, model_id)

            # 5b) get_signature_crop(tmp_path) runs in a sync thread, returns a cv2 image (np.ndarray)
            crop_img = await asyncio.to_thread(get_signature_crop, tmp_path)

            # 5c) write out the PNG
            sig_dir  = Path("signatures")
            sig_dir.mkdir(exist_ok=True)
            sig_crop = sig_dir / f"{doc_name}_signature.png"
            cv2.imwrite(str(sig_crop), crop_img)
            sig_crop_file = str(sig_crop)

        # ── 6) Await the items & total parsing ───────────────────────────
        items, total = await items_and_total_task
        if not items:
            items = await asyncio.to_thread(_free_text_fallback, flds, med_ref, cleaned_choices)

        # ── 7) Fill in all other metadata & assemble output ─────────────
        final_meta = _final_fallbacks(flds)
        def txt(key: str) -> str:
            fld = flds.get(key)
            return (fld.get("valueString") or fld.get("content") or "").strip() if fld else ""

        output = {
            "header":             {"documentType": "prescription"},
            "pharmacyName":       txt("pharmacie").split("Tél")[0].strip(),
            "pharmacyAddress":    None,
            "pharmacyContact":    None,
            "pharmacyFiscalId":   None,
            "beneficiaryId":      final_meta["formatted_id"],
            "patientIdentity":    final_meta["patientIdentity"],
            "prescriberCode":     final_meta["prescriberCode"],
            "prescriptionDate":   final_meta["prescriptionDate"],
            "regimen":            final_meta["regimen"],
            "dispensationDate":   final_meta["dispensationDate"],
            "executor":           txt("executeur") or txt("info_medecin"),
            "ref_cnam":           txt("ref_cnam") or txt("code_cnam"),
            "nom_prenom_docteur": doc_name,
            "items":              items,
            "total":              total or txt("total_ttc"),
            "signatureCropFile":  sig_crop_file,
        }

        elapsed_total = (datetime.utcnow() - t0).total_seconds()
        logger.info(f"[parse_prescription_ocr] completed in {elapsed_total:.1f}s")
        return output

    finally:
        if tmp_path and tmp_path.exists():
            tmp_path.unlink()

