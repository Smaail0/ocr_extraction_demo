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
from pdf2image import convert_from_path
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

_SYNC_CLIENT = SyncDocumentClient(ENDPOINT, AzureKeyCredential(KEY))

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
    # 1) strip out “Le”, line-breaks, extra text
    s = raw.replace("Le", "").replace("\n", " ").strip()
    # 2) look for day, month, year in any of these separators
    m = re.search(r"(\d{1,2})[\/\.\-\s]+(\d{1,2})[\/\.\-\s]+(\d{2,4})", s)
    if not m:
        return None
    day, month, year = m.groups()
    # 3) normalize two-digit years (assume 20xx)
    if len(year) == 2:
        year = "20" + year
    # 4) zero-pad day/month and build ISO string
    try:
        dt = datetime(int(year), int(month), int(day))
        return dt.date().isoformat()   # “2022-01-03”
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
    # 1) strip everything but digits
    digits = re.sub(r"\D+", "", raw or "")
    # 2) slice into exactly five parts:
    parts = [
        digits[0:4],
        digits[4:8],
        digits[8:10],
        digits[10:11],
        digits[11:12],
    ]
    # 3) replace any empty slice with "0"
    parts = [p if p else "0" for p in parts]
    return "-".join(parts)

def parse_bulletin_ocr(file_bytes: bytes, filename: str) -> dict:
    tmp_path: Optional[Path] = None
    try:
        # 1) dump bytes to disk
        suffix = Path(filename).suffix or ".pdf"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(file_bytes)
            tmp_path = Path(tmp.name)

        # 2) call Azure
        model_id = os.getenv("BULLETIN_MODEL_ID")
        result   = analyze_document(tmp_path, model_id=model_id, pages=None)
        doc      = result.documents[0]
        f        = doc.fields
        tables   = result.tables

        # 3) guard: must have at least one table (or ≥8 if you require full grids)
        if len(tables) == 0:
            raise ValueError("OCR returned no tables; this doesn’t look like a Bulletin de soin.")

        # 4) helpers
        def txt(k: str) -> Optional[str]:
            fld = f.get(k)
            return fld and (fld.get("valueString") or fld.get("content"))

        def chk(k: str) -> bool:
            fld = f.get(k)
            return (fld.get("valueSelectionMark","").lower() == "selected") if fld else False

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

        # 5) extract & pad grids
        grids = [extract_grid(tbl) for tbl in tables]
        while len(grids) < 8:
            grids.append([[]])   # or `[[""] * len(cols)]` if you prefer

        # 6) map each of the 8 tables
        consultations_dentaires = table_to_objects(grids[0], ["date","dent","codeActe","cotation","honoraires","codePs","signature"])
        protheses_dentaires     = table_to_objects(grids[1], ["date","dents","codeActe","cotation","honoraires","codePs","signature"])
        consultations_visites   = table_to_objects(grids[2], ["date","designation","honoraires","codePs","signature"])
        actes_medicaux          = table_to_objects(grids[3], ["date","designation","honoraires","codePs","signature"])
        actes_paramed           = table_to_objects(grids[4], ["date","designation","honoraires","codePs","signature"])
        biologie                = table_to_objects(grids[5], ["date","montant","codePs","signature"])
        hospitalisation         = table_to_objects(grids[6], ["date","codeHosp","forfait","codeClinique","signature"])
        pharmacie               = table_to_objects(grids[7], ["date","montant","codePs","signature"])

        # ── 7) other fields & checks ───────────────────────────────────
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

        # ── 8) assemble final dict ─────────────────────────────────────
        return {
            "header": {"documentType": "bulletin_de_soin"},
            "prenom": prenom,
            "nom": nom,
            "adresse": adresse,
            "codePostal": code_po,
            "refDossier": dossier_id,
            "identifiantUnique": formatted_id,
            "cnrps": cnrps_c,
            "cnss": cnss_c,
            "convbi": conv_c,
            "prenomMalade": mal_prenom,
            "nomMalade": mal_nom,
            "dateNaissance": mal_birth,
            "numTel": txt("telephone") or "",
            "assureSocial": assure_soc,
            "conjoint": chk("conjoint"),
            "ascendant": chk("ascendant"),
            "enfant": chk("enfant"),
            "apci": chk("apci_check"),
            "mo": chk("mo_check"),
            "hosp": chk("hospitalisation_check"),
            "grossesse": chk("suivi_grossesse_check"),
            # **and**:
            "consultationsDentaires": consultations_dentaires,
            "prothesesDentaires":     protheses_dentaires,
            "consultationsVisites":   consultations_visites,
            "actesMedicaux":          actes_medicaux,
            "actesParamed":           actes_paramed,
            "biologie":               biologie,
            "hospitalisation":        hospitalisation,
            "pharmacie":              pharmacie,
            }

    finally:
        if tmp_path and tmp_path.exists():
            tmp_path.unlink()

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

async def parse_prescription_ocr(file_bytes: bytes, filename: str) -> Dict:
    logger.info(f"[parse_prescription_ocr] start {filename}")
    t0 = datetime.utcnow()
    tmp_path: Optional[Path] = None

    try:
        # ── 1) dump bytes to temp file ───────────────────────────────
        logger.debug("Writing bytes to temporary file")
        suffix = Path(filename).suffix or ".pdf"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(file_bytes)
            tmp_path = Path(tmp.name)
        logger.info(f"[parse_prescription_ocr] temp file at {tmp_path}")

        # ── 2) call Azure async client ───────────────────────────────
        logger.debug("Creating AsyncDocumentClient")
        async with AsyncDocumentClient(ENDPOINT, AzureKeyCredential(KEY)) as client:
            try:
                logger.info(f"[parse_prescription_ocr] sending to Azure (model_id={model_id})")
                poller = await client.begin_analyze_document(
                    model_id=model_id,
                    body=file_bytes
                )
                logger.debug("Awaiting Azure result")
                result = await asyncio.wait_for(poller.result(), timeout=60)
                elapsed = (datetime.utcnow() - t0).total_seconds()
                logger.info(f"[parse_prescription_ocr] Azure returned in {elapsed:.1f}s")
            except AzureError as e:
                logger.error("Azure Document Intelligence error: %s", e, exc_info=True)
                raise ValueError(f"Azure error during analysis: {e}")
            except asyncio.TimeoutError:
                logger.error("Azure Document Intelligence timed out after 60s")
                raise ValueError("Azure analysis timed out (60s)")

        # ── 3) extract fields + tables ────────────────────────────────
        doc    = result.documents[0]
        flds   = doc.fields
        tables = result.tables

        def txt(key: str) -> str:
            fld = flds.get(key)
            return (fld.get("valueString") or fld.get("content") or "").strip() if fld else ""

        def chk(key: str) -> bool:
            fld = flds.get(key)
            return str(fld.get("valueSelectionMark","")).lower()=="selected" if fld else False

        def extract_grid(tbl) -> List[List[str]]:
            mat = [[""] * tbl.column_count for _ in range(tbl.row_count)]
            for cell in tbl.cells:
                mat[cell.row_index][cell.column_index] = cell.content.strip()
            return mat

        # ── 4) locate your three table shapes ────────────────────────
        matrices = [(tbl.column_count, extract_grid(tbl)) for tbl in tables]
        items_mat  = next((m for c,m in matrices if c >= 8), None)
        legacy_mat = next((m for c,m in matrices if c == 5), None)
        meta_mat   = next((m for c,m in matrices if c == 2), None)

        # ── 5) primary items parse ───────────────────────────────────
        items: List[Dict] = []
        total: str = ""
        if items_mat and len(items_mat) > 1:
            logger.debug("Parsing standard 8-col items table")
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

        # ── 6) legacy fallback ────────────────────────────────────────
        if not items and legacy_mat and len(legacy_mat) > 1:
            logger.debug("Parsing legacy 5-col items table")
            for row in legacy_mat[1:]:
                a,b,c,d,*_ = (row + [""]*5)[:5]
                puv = re.sub(r"[^\d\.,]","", c.strip())
                qte = re.sub(r"\D","",      d.strip())
                try: puv_n = float(puv.replace(",","."))
                except: puv_n = 0.0
                try: qte_n = int(qte)
                except: qte_n = 0
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
                    raw_val = it.get("montantPercu", "").strip()
                    raw_val = raw_val.replace("\u00A0", "").replace(",", "")
                    if raw_val:
                        try:
                            valid_amounts.append(float(raw_val))
                        except ValueError:
                            pass
                total = f"{sum(valid_amounts):,.0f}" if valid_amounts else ""

        # ── clear blank rows ─────────────────────────────────────────
        if all(not it["produit"] for it in items):
            logger.debug("All parsed items blank, clearing items")
            items = []

        # ── 7) metadata parse ────────────────────────────────────────
        beneficiaryId = patientIdentity = prescriberCode = None
        prescriptionDate = regimen = dispensationDate = None
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

        # ── 8) safe fallbacks ─────────────────────────────────────────
        formatted_id     = format_prescription_id( beneficiaryId or txt("id_unique") )
        patientIdentity  = patientIdentity or txt("nom_prenom")
        prescriberCode   = prescriberCode  or txt("code_apci")
        prescriptionDate = normalize_date(prescriptionDate) or txt("date")
        dispensationDate = normalize_date(dispensationDate) or txt("date_numero")
        regimen          = regimen or txt("regime")

        # ── 9) free-text fallback ─────────────────────────────────────
        if not items and txt("medicaments").strip():
            meds = txt("medicaments")
            logger.debug("Applying free-text fallback for meds")
            corrected = process.extract(meds, cleaned_choices, scorer=fuzz.token_set_ratio, limit=10)
            for match, score, idx in corrected:
                if score >= 80:
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

        # ── 10) final total fallback ──────────────────────────────────
        total = total or txt("total_ttc")

        # ── 11) pharmacie block ──────────────────────────────────────
        pharm_raw = txt("pharmacie")
        parts     = re.split(r"Tél[:]? *", pharm_raw, 1)
        main      = parts[0].strip()
        contact   = parts[1] if len(parts) > 1 else ""
        m         = re.search(r"\b(RTE|Route|Rue|Av|Avenue)\b", main, re.IGNORECASE)
        if m:
            pharm_name    = main[:m.start()].strip()
            pharm_address = main[m.start():].strip()
        elif " - " in main:
            pharm_name, pharm_address = [p.strip() for p in main.split(" - ",1)]
        else:
            pharm_name, pharm_address = main, None

        tel_m = re.search(r"^([\d\s]+)", contact)
        fax_m = re.search(r"Fax[:]? *([\d\s]+)", contact, re.IGNORECASE)
        pharm_contact = " / ".join(filter(None, [
            tel_m and tel_m.group(1).strip(),
            fax_m and fax_m.group(1).strip()
        ])) or None
        fisc_m        = re.search(r"Matricule\s+Fisc[^\w]*(\w+)", contact, re.IGNORECASE)
        pharm_fiscal  = fisc_m.group(1).strip() if fisc_m else None

        # ── 12) cropping signature ────────────────────────────────────
        executor      = txt("executeur") or txt("info_medecin")
        cnam_ref      = txt("ref_cnam")   or txt("code_cnam")
        doc_name      = ""
        sig_crop_file = None
        if has_signature_coordinates(result):
            logger.debug("Cropping signature via thread")
            doc_name   = await asyncio.to_thread(get_doctor_name, tmp_path, _SYNC_CLIENT, model_id)
            crop       = await asyncio.to_thread(get_signature_crop, tmp_path)
            sig_dir    = Path("signatures")
            sig_dir.mkdir(exist_ok=True)
            sig_crop   = sig_dir / f"{doc_name}_signature.png"
            cv2.imwrite(str(sig_crop), crop)
            sig_crop_file = str(sig_crop)

        # ── 13) assemble output ──────────────────────────────────────
        output = {
            "header":            {"documentType":"prescription"},
            "pharmacyName":      pharm_name,
            "pharmacyAddress":   pharm_address,
            "pharmacyContact":   pharm_contact,
            "pharmacyFiscalId":  pharm_fiscal,
            "beneficiaryId":     formatted_id,
            "patientIdentity":   patientIdentity,
            "prescriberCode":    prescriberCode,
            "prescriptionDate":  prescriptionDate,
            "regimen":           regimen,
            "dispensationDate":  dispensationDate,
            "executor":          executor,
            "ref_cnam":          cnam_ref,
            "nom_prenom_docteur":doc_name,
            "items":             items,
            "total":             total,
            "signatureCropFile": sig_crop_file,
        }

        elapsed = (datetime.utcnow() - t0).total_seconds()
        logger.info(f"[parse_prescription_ocr] completed in {elapsed:.1f}s")
        return output

    except Exception:
        logger.exception("[parse_prescription_ocr] unexpected error")
        raise
    finally:
        if tmp_path and tmp_path.exists():
            tmp_path.unlink()
            logger.debug(f"Removed temp file {tmp_path}")