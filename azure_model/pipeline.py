import os
import logging
from pathlib import Path
import tempfile, os
import cv2
import re
import numpy as np
import pandas as pd
from rapidfuzz import process, fuzz
from pdf2image import convert_from_path
from dotenv import load_dotenv
from azure.core.credentials import AzureKeyCredential
from azure.ai.documentintelligence import DocumentIntelligenceClient
from typing import Optional, List, Dict
from .signature_pipeline import get_doctor_name, get_signature_crop
logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
load_dotenv()

ENDPOINT = "https://iway.cognitiveservices.azure.com"
KEY = "DszvIykXxKf5EbrKjS5c1GxRjaA0Fd2ak7ITBvUMmqIF5umt8dk6JQQJ99BEACi5YpzXJ3w3AAALACOGQM1J"
    
if not (ENDPOINT and KEY):
    raise SystemExit("Set DOCUMENT_INTELLIGENCE_ENDPOINT & DOCUMENT_INTELLIGENCE_API_KEY in .env")

current_dir = os.path.dirname(os.path.abspath(__file__))
amm_path = os.path.join(current_dir, "liste_amm.xls")
med_ref = pd.read_excel(amm_path)

client = DocumentIntelligenceClient(ENDPOINT, AzureKeyCredential(KEY))
model_id = "ordonnance"
print("Listing models available on your Azure resource...")
try:
    # For new SDKs (azure-ai-documentintelligence)
    models = client.list_models()
    for model in models:
        print("Model ID:", model.model_id)
except AttributeError:
    try:
        # For older SDKs (azure-ai-formrecognizer)
        models = client.list_custom_models()
        for model in models:
            print("Model ID:", model.model_id)
    except Exception as e:
        print("Could not list models:", e)

def list_available_models():
    """Print all available models in the Azure Document Intelligence resource"""
    try:
        # For newer SDK versions
        result = client.list_models()
        print("Available models in your Azure resource:")
        for model in result:
            print(f"- {model.model_id} (Created: {model.created_on})")
        return result
    except AttributeError:
        try:
            # For older SDK versions
            result = client.list_custom_models()
            print("Available custom models in your Azure resource:")
            for model in result:
                print(f"- {model.model_id} (Created: {model.created_date_time})")
            return result
        except Exception as e:
            print(f"Error listing models with alternate method: {e}")
            return []
    except Exception as e:
        print(f"Error listing models: {e}")
        return []

available_models = list_available_models()
def analyze_document(scan_path: Path, model_id: str, pages: list[str]):
    """
    Sends the raw PDF or image stream to Azure custom model.
    """
    with open(scan_path, "rb") as f:
        poller = client.begin_analyze_document(
            model_id,
            body=f,
            pages=pages
        )
    return poller.result()

def correct_medication_name(raw, med_ref_threshold=80):
    match, score, idx = process.extractOne(raw, med_ref["Nom"], scorer=fuzz.ratio)
    if score >= med_ref_threshold:
        return med_ref.iloc[idx].to_dict(), score
    return None, score


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
        model_id = "ordonnance"
        print(f"Using model ID: {model_id}")
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
            "header": {
                "documentType": "bulletin_de_soin",
                "dossierId":    dossier_id
            },

            # assured info
            "prenom":            prenom,
            "nom":               nom,
            "adresse":           adresse,
            "codePostal":        code_po,
            "refDossier":        dossier_id,
            "identifiantUnique": formatted_id,
            "cnrps":             cnrps_c,
            "cnss":              cnss_c,
            "convbi":            conv_c,

            # the eight tables
            "consultationsDentaires": consultations_dentaires,
            "prothesesDentaires":     protheses_dentaires,
            "consultationsVisites":   consultations_visites,
            "actesMedicaux":          actes_medicaux,
            "actesParamed":           actes_paramed,
            "biologie":               biologie,
            "hospitalisation":        hospitalisation,
            "pharmacie":              pharmacie,

            # extra checks & fields
            "apci":                    apci_c,
            "mo":                      mo_c,
            "hospitalisationCheck":    hosp_req_c,
            "suiviGrossesseCheck":     suivi_gross_c,
            "datePrevu":               date_prevu,
            "nomPrenomMalade":         nom_pr_mal,

            # patient info
            "assureSocial":            assure_soc,
            "conjoint":                conjoint_c,
            "ascendant":               ascendant_c,
            "enfant":                  chk("enfant"),
            "prenomMalade":            mal_prenom,
            "nomMalade":               mal_nom,
            "dateNaissance":           mal_birth,

            # optional
            "numTel":                  txt("telephone") or "",
            "patientType":             None
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

def parse_prescription_ocr(file_bytes: bytes, filename: str) -> dict:
    tmp_path: Optional[Path] = None
    try:
        # 1) dump bytes to temp file
        suffix = Path(filename).suffix or ".pdf"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(file_bytes)
            tmp_path = Path(tmp.name)

        # 2) call Azure Document Intelligence
        model_id = "ordonnance"
        result   = analyze_document(tmp_path, model_id=model_id, pages=None)
        doc      = result.documents[0]
        f        = doc.fields

        # GUARD: ensure at least one table back
        raw_tables = result.tables
        if len(raw_tables) < 1:
            raise ValueError(f"Expected at least 1 table but found {len(raw_tables)}; not a valid prescription.")

        logging.info("Processing document fields: %s", list(f.keys()))
        logging.info("Tables found by column count: %s", [tbl.column_count for tbl in result.tables])

        def txt(key: str) -> Optional[str]:
            fld = f.get(key)
            if not fld:
                return None
            return fld.get("valueString") or fld.get("content")

        # 3) parse all tables into (col_count, matrix)
        tables: list[tuple[int, list[list[str]]]] = []
        for tbl in result.tables:
            mat = [[""] * tbl.column_count for _ in range(tbl.row_count)]
            for cell in tbl.cells:
                mat[cell.row_index][cell.column_index] = cell.content.strip()
            tables.append((tbl.column_count, mat))

        items_mat = next((m for c, m in tables if c >= 8), None)
        meta_mat  = next((m for c, m in tables if c == 2), None)

        # 4) parse the 8-col items (and footer)
        items: list[dict] = []
        total: Optional[str] = None
        if items_mat and len(items_mat) > 1:
            for row in items_mat[1:-1]:
                cells = (row + [""] * 8)[:8]
                items.append({
                    "codePCT":      cells[0],
                    "produit":      cells[1],
                    "forme":        cells[2],
                    "qte":          cells[3],
                    "puv":          cells[4],
                    "montantPercu": cells[5],
                    "nio":          cells[6],
                    "prLot":        cells[7],
                })
            footer = items_mat[-1]
            if footer and footer[0].lower().startswith("total"):
                total = footer[0]

        # 5) parse the 2-col metadata
        beneficiaryId = patientIdentity = prescriberCode = None
        prescriptionDate = regimen = dispensationDate = None

        if meta_mat:
            for key_cell, val_cell in meta_mat:
                key = key_cell.strip().lower()
                val = val_cell.strip()

                if not val and "date de la prescription" in key:
                    m = re.search(r"(\d{1,2}[\/\.-]\d{1,2}[\/\.-]\d{2,4})", key_cell)
                    prescriptionDate = m.group(1) if m else None
                    continue
                if not val and "date de dispensation" in key:
                    m = re.search(r"(\d{1,2}[\/\.-]\d{1,2}[\/\.-]\d{2,4})", key_cell)
                    dispensationDate = m.group(1) if m else None
                    continue

                if "bénéficiaire" in key:
                    beneficiaryId = val
                elif "identité" in key and "malade" in key:
                    patientIdentity = val
                elif "prescripteur" in key:
                    prescriberCode = val
                elif "date de la prescription" in key:
                    prescriptionDate = val or prescriptionDate
                elif "régime" in key:
                    regimen = val or regimen
                elif "date de dispensation" in key:
                    dispensationDate = val or dispensationDate

        # 6) SAFE FALLBACKS for missing metadata
        beneficiaryId    = beneficiaryId   or txt("id_unique") or ""
        formatted_id     = format_prescription_id(beneficiaryId)
        patientIdentity  = patientIdentity or txt("nom_prenom") or ""
        prescriberCode   = prescriberCode  or txt("code_apci")
        prescriptionDate = prescriptionDate or txt("date")
        dispensationDate = dispensationDate or txt("date_numero")
        regimen          = regimen          or txt("regime")

        # 7) fallback items from `prescription_items` array or from 'medications' free-text field
        if not items and f.get("prescription_items"):
            arr = f["prescription_items"].get("valueArray", [])
            for idx, row in enumerate(arr):
                cells = [(c.get("valueString") or c.get("content") or "").strip()
                        for c in row.get("valueArray", [])]
                if idx == 0:
                    continue
                if cells and cells[0].lower().startswith("total"):
                    total = cells[0]
                    continue
                a, b, c_, d = (cells + [""] * 4)[:4]
                items.append({
                    "codePCT": a,
                    "produit": b,
                    "forme":   c_,
                    "qte":     d,
                })
        elif not items and txt("medications"):
            meds_text = txt("medications")
            med_lines = re.split(r"[-,]", meds_text)
            med_lines = [line.strip() for line in med_lines if line.strip()]
            for line in med_lines:
                # Fuzzy match for med name
                corrected, score = correct_medication_name(line, med_ref)
                name = corrected["name"] if corrected else line

                # Extract the first number as dosage
                dosage_match = re.search(r"\b(\d+(\.\d+)?)(?:\s?(mg|ml|g|mcg))?\b", line, re.IGNORECASE)
                dosage = dosage_match.group(1) if dosage_match else ""

                # Combine for produit
                produit = f"{name} {dosage}".strip()

                items.append({
                    "codePCT": "NA",
                    "produit": produit,
                    "forme": "NA",
                    "qte": "NA",
                    "puv": "NA",
                    "montantPercu": "NA",
                    "nio": "NA",
                    "prLot": "NA",
                })

        # 8) fallback total from the raw field
        total = total or txt("total_ttc") or ""

        # 9) split the `pharmacie` blob
        raw_pharm    = txt("pharmacie") or ""
        parts        = re.split(r"Tél[:]? *", raw_pharm, maxsplit=1)
        main_part    = parts[0].strip()
        contact_part = parts[1] if len(parts) > 1 else ""

        addr_pat = re.compile(r"\b(RTE|Route|Rue|Av|Avenue)\b", re.IGNORECASE)
        m = addr_pat.search(main_part)
        if m:
            pharmacyName    = main_part[:m.start()].strip()
            pharmacyAddress = main_part[m.start():].strip()
        elif " - " in main_part:
            pharmacyName, pharmacyAddress = [p.strip() for p in main_part.split(" - ", 1)]
        else:
            pharmacyName    = main_part
            pharmacyAddress = None

        tel_m = re.search(r"^([\d\s]+)", contact_part)
        fax_m = re.search(r"Fax[:]? *([\d\s]+)", contact_part, re.IGNORECASE)
        pharmacyContact = " / ".join(filter(None, [
            tel_m and tel_m.group(1).strip(),
            fax_m and fax_m.group(1).strip(),
        ])) or None

        fisc_m          = re.search(r"Matricule\s+Fisc[^\w]*(\w+)", contact_part, re.IGNORECASE)
        pharmacyFiscalId = fisc_m.group(1).strip() if fisc_m else None

        # ─── 10) NEW FIELDS (doctor info, CNAM fields, etc.) ────────────
        # Executor/exécuteur: standardize on `executor` or `executeur` everywhere
        executor          = txt("executeur") or txt("info_medecin") or ""
        pharmacistCnamRef = txt("ref_cnam") or txt("code_cnam") or ""
        # Prescriber code fallback logic for code_cnam field
        code_cnam = prescriberCode or txt("code_cnam") or ""
        # Doctor signature fields
        signatureDocteurField = txt("signatureDocteurField") or ""
        nom_prenom_docteur    = txt("nom_prenom_docteur") or ""

        output = {
            "header":            {"documentType": "prescription"},
            "pharmacyName":      pharmacyName,
            "pharmacyAddress":   pharmacyAddress,
            "pharmacyContact":   pharmacyContact,
            "pharmacyFiscalId":  pharmacyFiscalId,

            "beneficiaryId":     formatted_id,
            "patientIdentity":   patientIdentity,

            "prescriberCode":    prescriberCode,
            "prescriptionDate":  prescriptionDate,
            "regimen":           regimen,
            "dispensationDate":  dispensationDate,
            "executor":          executor,           
            "ref_cnam":          pharmacistCnamRef,  
            "code_cnam":         code_cnam,
            "signatureDocteurField": signatureDocteurField,  
            "nom_prenom_docteur":   nom_prenom_docteur,

            "items":             items,
            "total":             total,
        }

        # ─── 12) signature crop & naming ────────────────────────────────
        try:
            # Only attempt cropping if coordinates exist (pseudo-code, adjust as needed)
            if has_signature_coordinates(result):
                doc_name = get_doctor_name(tmp_path)
                sig_crop = get_signature_crop(tmp_path)
                sig_dir = Path("signatures")
                sig_dir.mkdir(exist_ok=True)
                crop_path = sig_dir / f"{doc_name}_signature.png"
                cv2.imwrite(str(crop_path), sig_crop)
                output["signatureCropFile"] = str(crop_path)
            else:
                output["signatureCropFile"] = None
        except Exception as e:
            logging.error(f"Signature cropping failed: {e}")
            output["signatureCropFile"] = None

    finally:
        if tmp_path and tmp_path.exists():
            tmp_path.unlink()
