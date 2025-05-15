import sys, os, cv2, string, pytesseract
import numpy as np
from pdf2image import convert_from_path
from typing import List

os.environ["TESSDATA_PREFIX"] = r"C:\Program Files\Tesseract-OCR\tessdata"

def extract_doctor_name(
    path: str,
    keywords: list = ["docteur", "dr"],
    lang: str = "fra",
    psm: int = 6,
    ) -> str:
    
    gray = load_grayscale_pages(path)[0]
    
    h,w = gray.shape
    hdr = gray[0:int(h*0.2), :]
    
    data = pytesseract.image_to_data(
        hdr,
        lang=lang,
        config=f"--psm {psm}",
        output_type=pytesseract.Output.DICT,
    )
    
    name = None
    for i, word in enumerate(data["text"]):
        if not word.strip(): continue
        lw = word.lower().strip(string.punctuation)
        for kw in keywords:
           if kw.lower().strip(".") in lw:
               line_num = data["line_num"][i]
               parts = [t for j,t in enumerate(data["text"])
                        if data["line_num"][j] == line_num and t.strip()]
               filtered = [p for p in parts if p.lower().strip(".") not in 
                           [kw.lower().strip(".") for kw in keywords]]
               name = " ".join(filtered)
               break
           if name: 
               break
        if not name:
            name = os.path.basename(path).split(".")[0]
        safe = "".join(c if c.isalnum() else "_" for c in name).strip("_")
        return safe
               
        
def load_grayscale_pages(path: str, dpi: int = 300) -> List[np.ndarray]:
    
    ext = path.lower().rsplit('.', 1)[-1]
    pages = []
    if ext == 'pdf':
        pil_pages = convert_from_path(path, dpi=dpi)
        for pil in pil_pages:
            img = cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2GRAY)
            pages.append(img)
    else:
        img = cv2.imread(path, cv2.IMREAD_GRAYSCALE)
        if img is None:
            raise FileNotFoundError(f"Cannot read file: {path}")
        pages.append(img)
    return pages

DEBUG_OUT = "debug_crops"
os.makedirs(DEBUG_OUT, exist_ok=True)

def crop_signature_from_page(gray: np.ndarray, 
    min_area=500, min_aspect=1.5, max_aspect=10.0, 
    max_width_frac=0.8, roi_frac=0.5, solidity_thresh=0.75, 
    padding_frac=0.1, rect_area_frac=0.05
) -> np.ndarray:
    h_page, w_page = gray.shape

    # two‐pass scan: bottom ROI, then full page
    for scan_full in (False, True):
        if not scan_full:
            y0 = int(h_page*(1-roi_frac))
            img = gray[y0: , :]
        else:
            y0 = 0
            img = gray

        # 1) binarize + morph
        den = cv2.fastNlMeansDenoising(img, None, h=10)
        th = cv2.adaptiveThreshold(
            den,255,
            cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY_INV,
            51,5
        )
        k = cv2.getStructuringElement(cv2.MORPH_RECT,(3,3))
        th = cv2.morphologyEx(th, cv2.MORPH_CLOSE, k)
        th = cv2.morphologyEx(th, cv2.MORPH_OPEN,  k)

        # 1b) remove big rectangles (pharmacy stamps)
        # any contour approximated by 4 points and covering >rect_area_frac of ROI
        # 1b) remove any cc that looks like a solid box
        n2, labels2, stats2, _ = cv2.connectedComponentsWithStats(th)
        roi_area = th.shape[0] * th.shape[1]
        for j in range(1, n2):
            x2, y2, w2, h2, a2 = stats2[j]
            ar2 = w2 / float(h2) if h2>0 else 0
            if a2 < min_area:
                continue
            mask2 = (labels2 == j).astype(np.uint8)
            pix2  = cv2.countNonZero(mask2)
            sol2  = pix2 / float(w2*h2) if w2*h2>0 else 0
            # drop if: very solid & roughly square & reasonably large
            if sol2 > solidity_thresh and 0.8 <= ar2 <= 1.2 and a2 > rect_area_frac * roi_area:
                th[labels2 == j] = 0

        # 2) CC + solidity + aspect filtering
        n, labels, stats, _ = cv2.connectedComponentsWithStats(th)
        candidates = []
        for i in range(1, n):
            x,y,w,h,area = stats[i]
            if area < min_area or w > max_width_frac * w_page:
                continue
            ar = w/float(h) if h>0 else 0
            if ar < min_aspect or ar > max_aspect:
                continue

            # solidity test
            mask = (labels==i).astype(np.uint8)*255
            pix = cv2.countNonZero(mask)
            solidity = pix/float(w*h) if w*h>0 else 0
            if solidity > solidity_thresh:
                continue

            candidates.append((x,y,w,h))

        if not candidates:
            continue

        # 3) pick the scribbliest via ORB
        orb = cv2.ORB_create()
        best, best_score = None, -1
        for x,y,w,h in candidates:
            crop = img[y:y+h, x:x+w]
            kp,_ = orb.detectAndCompute(crop, None)
            cnt_kp = len(kp) if kp else 0
            if cnt_kp > best_score:
                best_score, best = cnt_kp, (x,y,w,h)

        if best is None:
            continue

        # 4) pad and return in full‐page coords
        x,y,w,h = best
        pad_w = int(w*padding_frac)
        pad_h = int(h*padding_frac)
        x1 = max(0, x - pad_w)
        y1 = max(0, y0 + y - pad_h)
        x2 = min(w_page, x + w + pad_w)
        y2 = min(h_page, y0 + y + h + pad_h)
        return gray[y1:y2, x1:x2]

    # fallback
    y0 = int(h_page*(1-roi_frac))
    return gray[y0: , :]

def crop_signature_from_page_debug(
    gray: np.ndarray,
    basename: str,
    min_area: int = 500,
    min_aspect: float = 1.5,
    max_aspect: float = 8.0,
    max_width_frac: float = 0.8,
    roi_frac: float = 0.5,
) -> np.ndarray:
    h_page, w_page = gray.shape
    y0 = int(h_page * (1 - roi_frac))
    gray_roi = gray[y0:, :]

    # 1) threshold  morph
    denoised = cv2.fastNlMeansDenoising(gray_roi, None, h=10)
    th = cv2.adaptiveThreshold(denoised,255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV,51,5
    )
    kern = cv2.getStructuringElement(cv2.MORPH_RECT,(3,3))
    th = cv2.morphologyEx(th, cv2.MORPH_CLOSE, kern)
    th = cv2.morphologyEx(th, cv2.MORPH_OPEN,  kern)

    # save the mask
    cv2.imwrite(f"{DEBUG_OUT}/{basename}_mask.png", th)

    # 2) find CCs and log every candidate
    n, labels, stats, _ = cv2.connectedComponentsWithStats(th)
    candidates, boxes = [], []
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        ar = w/float(h) if h>0 else 0
        mask = (labels == i).astype(np.uint8)
        solidity = cv2.countNonZero(mask) / (w*h) if w*h>0 else 0

        ok = (
            area >= min_area and
            min_aspect <= ar <= max_aspect and
            w <= max_width_frac * w_page and
            solidity <= 0.6
        )

        boxes.append((x, y, w, h, ok))

        if ok:
            # only save and keep *accepted* candidates
            crop = gray_roi[y : y+h, x : x+w]
            cv2.imwrite(f"{DEBUG_OUT}/{basename}_cand{i}.png", crop)
            candidates.append(crop)

    # 3) draw boxes on ROI
    disp = cv2.cvtColor(gray_roi, cv2.COLOR_GRAY2BGR)
    for x,y,w,h,ok in boxes:
        color = (0,255,0) if ok else (0,0,255)
        cv2.rectangle(disp, (x,y), (x+w,y+h), color, 2)
    cv2.imwrite(f"{DEBUG_OUT}/{basename}_boxes.png", disp)

    if not candidates:
        candidates = [gray_roi]
    orb = cv2.ORB_create()
    best, best_n = None, -1
    for crop in candidates:
        kp,_ = orb.detectAndCompute(crop, None)
        n_kp = len(kp) if kp else 0
        if n_kp > best_n:
            best_n, best = n_kp, crop
    if best is None:
        raise RuntimeError("No signature-like region")
    return best

def crop_signature_first_page(path: str) -> np.ndarray:
    """
    Load only the first page of the document and crop the signature region.
    """
    pages = load_grayscale_pages(path)
    if not pages:
        raise RuntimeError(f"No pages found in {path}")
    return crop_signature_from_page(pages[0])

if __name__ == "__main__":
    import matplotlib.pyplot as plt

    if len(sys.argv) != 2:
        print("Usage: python signature_cropper.py <file.pdf|png|jpg>")
        sys.exit(1)

    path = sys.argv[1]
    sig_crop = crop_signature_first_page(path)

    # Display the result
    plt.figure(figsize=(6,3))
    plt.imshow(sig_crop, cmap='gray')
    plt.title("Cropped Signature Region (Page 1)")
    plt.axis('off')
    plt.show()
    
    