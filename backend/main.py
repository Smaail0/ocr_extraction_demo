# main.py
from datetime import datetime
import os, re, shutil
from typing import List
from fastapi import Body
import tempfile
from pathlib import Path
import cv2, logging
from fastapi import FastAPI, File, HTTPException, Depends, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import desc
from sqlalchemy.orm import Session, joinedload
from .schemas import PatientWithDocs
from . import models, schemas
from .database import engine, SessionLocal
from fastapi.staticfiles import StaticFiles
from .services.azure import classify_form_on_bytes, parse_bulletin_ocr, parse_prescription_ocr
from azure_model.pipeline import classify_form

models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="Medical Documents API")

BASE = Path(__file__).resolve().parent.parent
# ── Load header templates ──
PRESC_HDR = cv2.imread(str(BASE / "assets" /"ordonnance_header1.png"))
BULL_HDR = cv2.imread(str(BASE / "assets" /"bulletin_de_soin_header1.png"))
if PRESC_HDR is None or BULL_HDR is None:
    raise RuntimeError("Could not load header templates – check your paths!")
SIGNATURE_DIR = os.path.join(os.path.dirname(__file__), "..", "signatures")
app.mount(
    "/signatures",
    StaticFiles(directory=SIGNATURE_DIR),
    name="signatures",
)

# ── CORS ──
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:4200"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Dependency ──
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
        
def is_mostly_empty(parsed: dict, threshold: float = 0.9) -> bool:
    
    keys = [k for k in parsed.keys() if k != "header"]
    if not keys:
        return True
    empty_count = 0
    for k in keys:
        v = parsed[k]
        if v is None or v == "" or v == [] or v == {}:
            empty_count += 1
    return (empty_count / len(keys)) >= threshold

def get_or_create_patient_by_name(db: Session, first: str, last: str) -> models.Patient:
    patient = (
        db.query(models.Patient)
          .filter_by(first_name=first, last_name=last)
          .first()
    )
    if not patient:
        patient = models.Patient(first_name=first, last_name=last)
        db.add(patient)
        db.commit()
        db.refresh(patient)
    return patient

# ── OCR Parse endpoint ──
@app.post("/documents/parse")
async def parse_document(file: UploadFile = File(...)):
    data = await file.read()
    suffix = Path(file.filename).suffix or ".pdf"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(data)
        tmp_path = Path(tmp.name)

    # 1) do your ORB‐based, page‐by‐page classification
    form_key = classify_form(
        scan_path=tmp_path,
        presc_hdr_img=PRESC_HDR,
        bullet_hdr_img=BULL_HDR,
    )
    tmp_path.unlink()

    # 2) send to Azure
    try:
        if form_key == "prescription":
            parsed = await parse_prescription_ocr(data, file.filename)
        else:
            parsed = await parse_bulletin_ocr(data, file.filename)
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))

    # 3) SANITY CHECK: if Azure returned no meaningful rows, override to “unknown”
    if form_key == "prescription":
        # prescription must have at least one item
        if not parsed.get("items"):
            raise HTTPException(
                status_code=400,
                detail="Unrecognized document type; please upload a Bulletin de soin or a Prescription."
            )
    else:
        tables = (
            parsed.get("consultationsDentaires", [])
            + parsed.get("prothesesDentaires", [])
            + parsed.get("consultationsVisites", [])
            + parsed.get("actesMedicaux", [])
            + parsed.get("actesParamed", [])
            + parsed.get("biologie", [])
            + parsed.get("hospitalisation", [])
            + parsed.get("pharmacie", [])
        )
        if not any(tables):
            raise HTTPException(
                status_code=400,
                detail="Unrecognized document type; please upload a Bulletin de soin or a Prescription."
            )

    # 4) if we get here, everything looks good
    return {"header": {"documentType": form_key}, **parsed}

@app.get("/patients/{first_name}/{last_name}", response_model=schemas.PatientWithDocs)
def get_patient_by_name(
    first_name: str,
    last_name:  str,
    db:         Session = Depends(get_db)
):
    patient = (
        db.query(models.Patient)
          .filter_by(first_name=first_name, last_name=last_name)
          .options(
            joinedload(models.Patient.bulletins),
            joinedload(models.Patient.prescriptions),
          )
          .first()
    )
    if not patient:
        raise HTTPException(404, "Patient not found")
    return patient

# ── Create Bulletin ──
@app.post("/bulletin/", response_model=schemas.Bulletin)
def create_bulletin(
    bulletin: schemas.BulletinCreate,
    db: Session = Depends(get_db)
):
    # require a name to group on
    if not bulletin.prenom or not bulletin.nom:
        raise HTTPException(400, "Missing first or last name in bulletin")

    # 1) find or create the patient
    patient = get_or_create_patient_by_name(db, bulletin.prenom, bulletin.nom)

    # 2) grab only the scalar fields that your model actually defines
    data = bulletin.model_dump()  

    db_bulletin = models.Bulletin(
        **data,
        patient_id=patient.id
    )
    db.add(db_bulletin)
    db.commit()
    db.refresh(db_bulletin)
    return db_bulletin

@app.post("/prescription/", response_model=schemas.Prescription)
def create_prescription(
    presc: schemas.PrescriptionCreate,
    db: Session = Depends(get_db)
):
    if not presc.items:
        raise HTTPException(400, "Prescription must have at least one item")

    # split the "First Last" into two parts
    try:
        first, last = presc.patientIdentity.split(" ", 1)
    except ValueError:
        raise HTTPException(400, "patientIdentity must be 'First Last'")

    # 1) find or create the patient by name
    patient = get_or_create_patient_by_name(db, first, last)

    # 2) create the prescription row
    data = presc.dict(exclude={"beneficiaryId"})
    db_presc = models.Prescription(
        **data,
        beneficiaryId=presc.beneficiaryId,
        patient_id=patient.id
    )
    db.add(db_presc)
    db.commit()
    db.refresh(db_presc)
    return db_presc

# ── File‐upload endpoints unchanged ──
UPLOAD_DIR = "bulletins"
os.makedirs(UPLOAD_DIR, exist_ok=True)

@app.post("/bulletin/upload", response_model=schemas.UploadResponse)
async def upload_bulletins(files: List[UploadFile] = File(...), db: Session = Depends(get_db)):
    uploaded = []
    for file in files:
        try:
            ts = datetime.utcnow().isoformat()
            safe = re.sub(r"[:.]", "-", ts)
            name = f"{safe}_{file.filename}"
            path = os.path.join(UPLOAD_DIR, name)
            with open(path, "wb") as buf:
                shutil.copyfileobj(file.file, buf)
            dbf = models.FileUpload(
                filename=name,
                original_name=file.filename,
                path=path,
                uploaded_at=datetime.utcnow()
            )
            db.add(dbf)
            db.commit()
            db.refresh(dbf)
            uploaded.append({"id": dbf.id, "filename": name, "original_name": file.filename})
        except:
            continue
    return {"message": f"{len(uploaded)} bulletin(s) uploaded", "uploaded_files": uploaded}

@app.get("/bulletin/uploaded/latest")
async def get_latest_bulletin(db: Session = Depends(get_db)):
    latest = db.query(models.FileUpload).order_by(desc(models.FileUpload.uploaded_at)).first()
    if not latest:
        return {"exists": False, "message": "No bulletins uploaded"}
    return {"id": latest.id, "filename": latest.filename,
            "original_name": latest.original_name, "uploaded_at": latest.uploaded_at, "exists": True}

@app.get("/bulletin/uploaded/all")
async def get_all_bulletins(db: Session = Depends(get_db)):
    files = db.query(models.FileUpload).order_by(desc(models.FileUpload.uploaded_at)).all()
    return [{"id": f.id, "filename": f.filename, "original_name": f.original_name, "uploaded_at": f.uploaded_at} for f in files]

@app.put("/bulletin/{bulletin_id}", response_model=schemas.Bulletin)
def update_bulletin(
    bulletin_id: int,
    bulletin: schemas.BulletinCreate = Body(...),
    db: Session = Depends(get_db)
):
    db_b = db.get(models.Bulletin, bulletin_id)
    if not db_b:
        raise HTTPException(404, "Bulletin not found")

    # Pydantic v2 → use model_dump()
    for key, val in bulletin.model_dump().items():
        setattr(db_b, key, val)

    db.commit()
    db.refresh(db_b)
    return db_b

@app.get("/health")
def health_check():
    return {"status": "healthy"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
