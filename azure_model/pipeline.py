import os
import sys
import argparse
import logging
from pathlib import Path
import tempfile

import json
import cv2
import numpy as np
from pdf2image import convert_from_path
from dotenv import load_dotenv
from azure.core.credentials import AzureKeyCredential
from azure.ai.documentintelligence import DocumentIntelligenceClient

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
load_dotenv()

ENDPOINT = os.getenv("DOCUMENT_INTELLIGENCE_ENDPOINT")
KEY      = os.getenv("DOCUMENT_INTELLIGENCE_API_KEY")
if not (ENDPOINT and KEY):
    raise SystemExit("❌  Set DOCUMENT_INTELLIGENCE_ENDPOINT & DOCUMENT_INTELLIGENCE_API_KEY in .env")

client = DocumentIntelligenceClient(ENDPOINT, AzureKeyCredential(KEY))

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
    """
    Renders all pages and returns 'prescription' or 'bulletin_de_soin'
    based on which header patch matches best.
    """
    # precompute descriptors for the two header templates
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

def parse_bulletin_ocr(file_bytes: bytes, filename: str) -> dict:
    # 1) Drop bytes to a temp file
    suffix = Path(filename).suffix or ".pdf"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(file_bytes)
        tmp_path = Path(tmp.name)

    # 2) Load header templates once the temp file is on disk
    presc_hdr  = cv2.imread("assets/ordonnance_header1.png")
    bullet_hdr = cv2.imread("assets/bulletin_de_soin_header1.png")
    if presc_hdr is None or bullet_hdr is None:
        raise RuntimeError("❌ Could not load header images – check your paths")

    # 3) Classify form and pick the model
    form_key = classify_form(
        scan_path=tmp_path,
        presc_hdr_img=presc_hdr,
        bullet_hdr_img=bullet_hdr,
        poppler=None       # or your Poppler path on Windows
    )
    model_id = (
        os.getenv("ORDONNANCE_MODEL_ID")
        if form_key == "prescription"
        else os.getenv("BULLETIN_MODEL_ID")
    )

    # 4) Perform OCR
    result = analyze_document(tmp_path, model_id=model_id, pages=None)

    # 5) Pull out fields
    doc = result.documents[0]
    f   = doc.fields

    def txt(key: str) -> str | None:
        fld = f.get(key)
        if not fld:
            return None
        # Custom model returns its text under "valueString"
        return fld.get("valueString") or fld.get("content")

    def chk(key: str) -> bool:
        fld = f.get(key)
        if not fld:
            return False
        # Custom model returns “valueSelectionMark” = “selected”/“unselected”
        sm = fld.get("valueSelectionMark")
        return (sm or "").lower() == "selected"

    parsed = {
      "header": {
        "documentType": doc.doc_type,
        "dossierId":    txt("id_dossier")
      },
      "insured": {
        "uniqueId":          txt("id_unique"),
        "cnrpsChecked":      chk("cnrps_check"),
        "cnssChecked":       chk("cnss_check"),
        "conventionChecked": chk("convention_check"),
        "firstName":         txt("prenom_assure"),
        "lastName":          txt("nom_assure"),
        "address":           txt("adresse_assure"),
        "postalCode":        txt("code_postal")
      },
      "patient": {
        "firstName": txt("prenom_malade"),
        "lastName":  txt("nom_malade"),
        "birthDate": txt("date_naissance_malade"),
        "isChild":   chk("enfant")
      }
    }

    # 6) Cleanup
    tmp_path.unlink()
    return parsed

def parse_ordonnance_ocr(file_bytes: bytes, filename: str) -> dict:
    """
    Parses a prescription (ordonnance) document using the OCR pipeline.
    Similar to parse_bulletin_ocr but tailored for prescription fields.
    """
    # 1) Drop bytes to a temp file
    suffix = Path(filename).suffix or ".pdf"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(file_bytes)
        tmp_path = Path(tmp.name)

    try:
        # 2) Load header templates once the temp file is on disk
        presc_hdr = cv2.imread("assets/ordonnance_header1.png")
        bullet_hdr = cv2.imread("assets/bulletin_de_soin_header1.png")
        if presc_hdr is None or bullet_hdr is None:
            raise RuntimeError("❌ Could not load header images – check your paths")

        # 3) Classify form and pick the model
        form_key = classify_form(
            scan_path=tmp_path,
            presc_hdr_img=presc_hdr,
            bullet_hdr_img=bullet_hdr,
            poppler=None       # or your Poppler path on Windows
        )
        
        # Always use the ordonnance model for this function
        model_id = os.getenv("ORDONNANCE_MODEL_ID")
        if not model_id:
            raise ValueError("ORDONNANCE_MODEL_ID not set in environment variables")

        # 4) Perform OCR
        result = analyze_document(tmp_path, model_id=model_id, pages=None)
        
        import logging
        import json

        logging.info(f"Processing file: {filename}")
        logging.info(f"Form classification result: {form_key}")
        logging.info(f"Using model ID: {model_id}")
        
        # 5) Pull out fields
        doc = result.documents[0]
        f = doc.fields

        logging.info(f"OCR Fields: {f}")

        def txt(key: str) -> str | None:
            fld = f.get(key)
            if not fld:
                return None
            # Custom model returns its text under "valueString"
            return fld.get("valueString") or fld.get("content")

        def num(key: str) -> float | None:
            value = txt(key)
            if not value:
                return None
            try:
                # Replace comma with period for decimal numbers and convert to float
                return float(value.replace(',', '.'))
            except ValueError:
                return None

        def int_val(key: str) -> int | None:
            value = txt(key)
            if not value:
                return None
            try:
                return int(value)
            except ValueError:
                return None

        # Helper functions for extracting values from nested objects
        def txt_from_obj(obj, key):
            if key in obj and "valueString" in obj[key]:
                return obj[key]["valueString"]
            return None

        def num_from_obj(obj, key):
            value = txt_from_obj(obj, key)
            if value:
                try:
                    return float(value.replace(',', '.'))
                except ValueError:
                    return None
            return None

        def int_val_from_obj(obj, key):
            value = txt_from_obj(obj, key)
            if value:
                try:
                    return int(value)
                except ValueError:
                    return None
            return None

        # 6) Map data to fields based on the actual schema from the OCR model
        parsed = {
            "nom_pharmacie": None,
            "adresse_pharmacie": None,
            "telephone_fax": None,
            "matricule_fiscale": None,
            
            "id_beneficiaire": None,
            "nom_malade": None,
            "code_prescripteur": None,
            "date_prescription": None,
            "regime": None,
            "date_dispensation": None,
            "code_executeur": None,
            "reference_cnam": None,
            
            "code_pct": None,
            "produit": None,
            "forme": None,
            "quantite": None,
            "prix_unitaire": None,
            "montant_percu": None,
            "nio": None,
            "pr_lot": None,
            
            "montant_total": None,
            "montant_en_lettres": None,
        }
        
        # Extract ID Beneficiaire directly
        parsed["id_beneficiaire"] = txt("id_unique")
        
        # Extract patient name from 'nom_prenom'
        parsed["nom_malade"] = txt("nom_prenom")
        
        # Extract date fields
        parsed["date_prescription"] = txt("date")
        
        # Extract pharmacy info from the 'pharmacie' field
        pharmacie_txt = txt("pharmacie")
        if pharmacie_txt:
            # Simple split for pharmacy name - first line
            lines = pharmacie_txt.split('\n')
            if lines:
                parsed["nom_pharmacie"] = lines[0].strip()
            
            # Look for telephone/fax
            tel_fax_parts = []
            for line in lines:
                if "Tél:" in line:
                    tel_fax_parts.append(line.strip())
                if "Fax:" in line:
                    tel_fax_parts.append(line.strip())
            
            if tel_fax_parts:
                parsed["telephone_fax"] = " - ".join(tel_fax_parts)
            
            # Look for matricule fiscale
            for line in lines:
                if "Matricule Fisc" in line:
                    matricule_part = line.split("Matricule Fisc")[1].strip()
                    parsed["matricule_fiscale"] = matricule_part.strip(" .:")
                    break
            
            # Address - use footer info
            footer_txt = txt("footer")
            if footer_txt:
                parsed["adresse_pharmacie"] = footer_txt
        
        # Process medecin_table for additional information
        medecin_table = f.get("medecin_table", {}).get("valueArray", [])
        if medecin_table:
            for row in medecin_table:
                row_obj = row.get("valueObject", {})
                col1 = txt_from_obj(row_obj, "COLUMN1")
                col2 = txt_from_obj(row_obj, "COLUMN2")
                
                # Match fields based on column contents
                if col1 and col2:
                    if "ID Bénéficiaire" in col1:
                        parsed["id_beneficiaire"] = col2
                    elif "Identité du malade" in col1:
                        parsed["nom_malade"] = col2
                    elif "Code du prescripteur" in col1:
                        parsed["code_prescripteur"] = col2
                    elif "Date de la prescription" in col1:
                        parsed["date_prescription"] = col2
                    elif "Date de dispensation" in col1:
                        parsed["date_dispensation"] = col2
                    elif "Régime" in col1:
                        parsed["regime"] = col1.split(":")[1].strip() if ":" in col1 else col1
                    elif "CNSS/CNRPS" in col1 or "CNSS/CNRPS" in col2:
                        parsed["code_executeur"] = col2
        
        # Extract prescription items
        prescription_items = f.get("prescription_items", {}).get("valueArray", [])
        if prescription_items and len(prescription_items) > 1:  # Skip header row
            # Get the first actual medication item (skip header)
            for item in prescription_items[1:]:  # Start from second item
                item_obj = item.get("valueObject", {})
                # Check if this is a medication item (not header or total)
                code_pct = txt_from_obj(item_obj, "Code PCT")
                if code_pct and "Total" not in code_pct:
                    parsed["code_pct"] = code_pct
                    parsed["produit"] = txt_from_obj(item_obj, "Produit")
                    parsed["forme"] = txt_from_obj(item_obj, "Forme")
                    parsed["quantite"] = txt_from_obj(item_obj, "Qte")
                    parsed["prix_unitaire"] = txt_from_obj(item_obj, "PUV")
                    parsed["montant_percu"] = txt_from_obj(item_obj, "Mt. Percu")
                    parsed["nio"] = txt_from_obj(item_obj, "N.I.O")
                    parsed["pr_lot"] = txt_from_obj(item_obj, "PR/Lot")
                    break  # Just get the first medication for now
                
            # Extract total amount
            for item in prescription_items:
                item_obj = item.get("valueObject", {})
                code_pct = txt_from_obj(item_obj, "Code PCT")
                if code_pct and "Total" in code_pct:
                    total_parts = code_pct.split(":")
                    if len(total_parts) > 1:
                        try:
                            total_val = total_parts[1].strip()
                            parsed["montant_total"] = float(total_val.replace(',', '.'))
                        except (ValueError, IndexError):
                            pass
        
        # If medicaments field is present and product is empty, use that
        if not parsed["produit"]:
            parsed["produit"] = txt("medicaments")
            
        # Extract CNAM code if available
        parsed["reference_cnam"] = txt("code_cnam") or txt("code_apci")
        
        return parsed
        
    finally:
        # 7) Cleanup
        tmp_path.unlink(missing_ok=True)


# ─── MAIN ───────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser("Header‑based dispatch OCR pipeline")
    ap.add_argument("--scan",          required=True, type=Path,
                    help="PDF/JPG/PNG of your form")
    ap.add_argument("--presc_header",  default="assets/ordonnance_header1.png", type=Path,
                    help="PNG of prescription header patch")
    ap.add_argument("--bullet_header", default="assets/bulletin_de_soin_header1.png", type=Path,
                    help="PNG of bulletin_de_soin header patch")
    ap.add_argument("--poppler",       default=None,
                    help="(Windows) path to poppler bin for PDF support")
    ap.add_argument("--pages",         nargs="+", default=None,
                    help="pages to send to the custom model")
    ap.add_argument("--ocr_output",    default=Path("ocr_output.txt"), type=Path)
    ap.add_argument("--model_bulletin",   default="bulletin_de_soin_v1",
                    help="Your bulletin custom model ID")
    ap.add_argument("--model_ordonnance", default="ordonnance_model_v2",
                    help="Your prescription custom model ID")

    args = ap.parse_args()

    # load header templates
    presc_hdr  = cv2.imread(str(args.presc_header))
    bullet_hdr= cv2.imread(str(args.bullet_header))
    if presc_hdr is None or bullet_hdr is None:
        sys.exit("❌ Failed to load one of the header images")

    # 1) classify
    form_key = classify_form(args.scan, presc_hdr, bullet_hdr, poppler=args.poppler)

    # 2) pick model
    if form_key == "bulletin_de_soin":
        model_id = args.model_bulletin
    elif form_key == "prescription":
        model_id = args.model_ordonnance
    else:
        logging.warning("Unknown form type → defaulting to bulletin")
        model_id = args.model_bulletin
        
    # 3) decide which pages to send
    if args.pages is not None:
        pages_to_send = args.pages
    else:
        # render all pages so we know how many there are:
        all_pages = load_all_pages(args.scan, poppler_path=args.poppler)
        # build ["1","2",…] up to N:
        pages_to_send = [str(i) for i in range(1, len(all_pages) + 1)]
    logging.info("▷ sending pages %s to model %s", pages_to_send, model_id)

    # 4) analyze
    result = analyze_document(args.scan, model_id, pages=args.pages)

    # 5) dump
    dump_results(result, args.ocr_output)

if __name__ == "__main__":
    main()
