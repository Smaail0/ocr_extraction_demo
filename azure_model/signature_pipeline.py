#!/usr/bin/env python3
import os
import sys
import argparse
import cv2
import re
from pathlib import Path
import numpy as np
from dotenv import load_dotenv
from azure.ai.documentintelligence import DocumentIntelligenceClient
from azure.core.credentials import AzureKeyCredential
from pdf2image import convert_from_path
from skimage.metrics import structural_similarity as ssim
from .prescription_cropper import extract_doctor_name

# ─── Configuration ───────────────────────────────────────────────────────────
load_dotenv()
DPI      = 300

# Thresholds (tune on your genuine–genuine baseline)
AKAZE_THRESHOLD = 0.20
SSIM_THRESHOLD  = 0.50

client = ""

# ─── Helpers ─────────────────────────────────────────────────────────────────

def get_doctor_name(
    path: Path,
    client: DocumentIntelligenceClient,
    model_id: str
) -> str:
    """
    Extracts and sanitizes the doctor's name from the Azure field 'nom_prenom_docteur',
    falling back to local OCR if needed. Returns lower_case_with_underscores.
    """
    name = None

    # 1) Try Azure DI
    try:
        with open(path, "rb") as f:
            poller = client.begin_analyze_document(model_id, f)
        doc = poller.result().documents[0]
        fld = doc.fields.get("nom_prenom_docteur")
        if fld and fld.content:
            name = fld.content
    except Exception:
        pass

    if not name:
        name = extract_doctor_name(str(path))

    name = re.sub(r'^(dr\.?|docteur)\s+', '', name.strip(), flags=re.IGNORECASE)
    name = re.sub(r'[^A-Za-z0-9\s]',    '', name)
    name = "_".join(name.split()).lower()

    return name

def get_signature_crop(path: str) -> np.ndarray:
    from .prescription_cropper import crop_signature_from_page, load_grayscale_pages
    def fallback():
        gray = load_grayscale_pages(str(path))[0]
        return crop_signature_from_page(gray)

    path_str = str(path)

    try:
        with open(path_str,"rb") as f:
            poller = client.begin_analyze_document("", f)
        result = poller.result()
    except Exception:
        return fallback()

    doc = result.documents[0]
    field = doc.fields.get("docteurSignatureRegion")
    if not field or not field.bounding_regions:
        return fallback()

    region = field.bounding_regions[0]
    ext = os.path.splitext(str(path))[1].lower()
    if ext==".pdf":
        pages = convert_from_path(str(path), dpi=DPI)
        page = pages[region.page_number-1]
        img = cv2.cvtColor(np.array(page), cv2.COLOR_RGB2GRAY)
        poly = region.polygon
        pts = [(int(poly[i]*DPI),int(poly[i+1]*DPI)) for i in range(0,len(poly),2)]
    else:
        img = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE) or fallback()
        poly = region.polygon
        pts = [(int(poly[i]),int(poly[i+1])) for i in range(0,len(poly),2)]

    h,w = img.shape
    xs,ys = zip(*pts)
    x1,x2 = max(0,min(xs)), min(w,max(xs))
    y1,y2 = max(0,min(ys)), min(h,max(ys))
    pad_w, pad_h = int((x2-x1)*0.1), int((y2-y1)*0.1)
    x1,x2 = max(0,x1-pad_w), min(w,x2+pad_w)
    y1,y2 = max(0,y1-pad_h), min(h,y2+pad_h)
    return img[y1:y2, x1:x2]


def isolate_signature(crop: np.ndarray) -> np.ndarray:
    _, bw = cv2.threshold(crop,0,255,cv2.THRESH_BINARY_INV|cv2.THRESH_OTSU)
    cnts,_ = cv2.findContours(bw,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
    if not cnts: return crop
    c = max(cnts, key=cv2.contourArea)
    x,y,w,h = cv2.boundingRect(c)
    return crop[y:y+h, x:x+w]


def deskew(img: np.ndarray) -> np.ndarray:
    coords = np.column_stack(np.where(img<250))
    if coords.shape[0]<10: return img
    angle = cv2.minAreaRect(coords)[-1]
    if angle < -45: angle = -(90+angle)
    else: angle = -angle
    h,w = img.shape[:2]
    M = cv2.getRotationMatrix2D((w/2,h/2),angle,1.0)
    return cv2.warpAffine(img,M,(w,h),flags=cv2.INTER_CUBIC,borderMode=cv2.BORDER_REPLICATE)


def preprocess(img: np.ndarray, size=(200,400)) -> np.ndarray:
    sig = isolate_signature(img)
    sig = deskew(sig)
    return cv2.resize(sig, size, interpolation=cv2.INTER_AREA)


def compare_akaze(a: np.ndarray, b: np.ndarray) -> float:
    det = cv2.AKAZE_create()
    kp1, des1 = det.detectAndCompute(a, None)
    kp2, des2 = det.detectAndCompute(b, None)
    if des1 is None or des2 is None: return 0.0
    bf = cv2.BFMatcher()
    matches = bf.knnMatch(des1, des2, k=2)
    good = [m for m,n in matches if m.distance < 0.75*n.distance]
    denom = min(len(kp1), len(kp2), 50)
    return len(good)/denom if denom>0 else 0.0


def compare_ssim(a: np.ndarray, b: np.ndarray) -> float:
    b_resized = cv2.resize(b, (a.shape[1], a.shape[0]))
    score,_ = ssim(a, b_resized, full=True)
    return score


def verify_signature(test_crop: np.ndarray, genuine_path: str):
    # collect genuine samples
    if os.path.isdir(genuine_path) or os.path.isfile(genuine_path):
        files = [os.path.join(genuine_path,f)
                 for f in os.listdir(genuine_path)
                 if f.lower().endswith((".png",".jpg","jpeg"))]
    elif os.path.isfile(genuine_path):
        files = [genuine_path]
    else:
        raise FileNotFoundError(f"No genuine signatures found at '{genuine_path}'")

    p_test = preprocess(test_crop)
    best_akaze, best_ssim = 0.0, 0.0

    for fn in files:
        g = cv2.imread(fn, cv2.IMREAD_GRAYSCALE)
        if g is None: continue
        p_g = preprocess(g)
        best_akaze = max(best_akaze, compare_akaze(p_test, p_g))
        best_ssim  = max(best_ssim, compare_ssim(p_test, p_g))

    is_genuine = (best_akaze >= AKAZE_THRESHOLD) or (best_ssim >= SSIM_THRESHOLD)
    return {"akaze": best_akaze, "ssim": best_ssim, "genuine": is_genuine}


# ─── Main CLI ─────────────────────────────────────────────────────────────────

def main():
    p = argparse.ArgumentParser(
        prog="signature_pipeline.py",
        description="Extract—and/or verify—a signature."
    )
    p.add_argument("input", help="PDF/JPG/PNG (or signature image with --verify-only)")
    p.add_argument("-g","--genuine", help="dir/file of genuine signature(s)")
    p.add_argument("--verify-only", action="store_true",
                   help="skip extraction; treat input as test signature")
    p.add_argument("-o","--out", default="crops", help="crop output folder")
    args = p.parse_args()

    if args.verify_only and not args.genuine:
        p.error("--verify-only requires --genuine")

    # 1) test signature
    if args.verify_only:
        test_sig = cv2.imread(args.input, cv2.IMREAD_GRAYSCALE)
        if test_sig is None:
            print(f"❌ Could not load: {args.input}")
            sys.exit(1)
    else:
        os.makedirs(args.out, exist_ok=True)
        test_sig = get_signature_crop(args.input)
        outp = os.path.join(args.out, "test_signature.png")
        cv2.imwrite(outp, test_sig)
        print(f"Wrote extracted signature to: {outp}")

    # 2) verify if genuine provided
    if args.genuine:
        res = verify_signature(test_sig, args.genuine)
        print(f"AKAZE = {res['akaze']:.3f}, SSIM = {res['ssim']:.3f}")
        print("✅ GENUINE" if res["genuine"] else "❌ FRAUDULENT")
    else:
        print("⚙️  Skipping verification (no --genuine)")

if __name__=="__main__":
    main()
