# main.py
from datetime import datetime
import os, re, shutil
import traceback
from typing import List
from fastapi import Body
import tempfile
from pathlib import Path
import cv2
from fastapi import FastAPI, File, HTTPException, Depends, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import desc
from sqlalchemy.orm import Session, joinedload
from .schemas import PatientWithDocs
from . import models, schemas
from .database import engine, SessionLocal
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

    # LOCAL classification only
    form_key = classify_form(
        scan_path=tmp_path,
        presc_hdr_img=PRESC_HDR,
        bullet_hdr_img=BULL_HDR,
    )
    tmp_path.unlink()

    # now dispatch to Azure
    try:
        if form_key == "prescription":
            parsed = await parse_prescription_ocr(data, file.filename)
        else :
            parsed = await parse_bulletin_ocr(data, file.filename)

    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))

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


# ── Create Prescription ──
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
    data = presc.dict(exclude={"beneficiaryId", "patientIdentity"})
    db_presc = models.Prescription(
        **data,
        beneficiaryId=presc.beneficiaryId,
        patient_id=patient.id
    )
    db.add(db_presc)
    db.commit()
    db.refresh(db_presc)
    return db_presc

UPLOAD_DIR = "bulletins"
os.makedirs(UPLOAD_DIR, exist_ok=True)

@app.post("/bulletin/upload", response_model=schemas.UploadResponse)

async def upload_bulletins(files: List[UploadFile] = File(...), db: Session = Depends(get_db)):
    uploaded = []

    for file in files:
        try:
            raw_timestamp = datetime.utcnow().isoformat()
            safe_timestamp = re.sub(r"[:.]", "-", raw_timestamp)

            filename = f"{safe_timestamp}_{file.filename}"
            file_path = os.path.join(UPLOAD_DIR, filename)

            with open(file_path, "wb") as buffer:
                shutil.copyfileobj(file.file, buffer)

                db_file = models.FileUpload(
                    filename=filename,
                    original_name=file.filename,
                    path=file_path,
                    type="bulletin",  # Confirm this is being set
                    uploaded_at=datetime.utcnow()
            )
            db.add(db_file)
            db.commit()
            db.refresh(db_file)

            uploaded.append({
                "id": db_file.id, 
                "filename": filename, 
                "original_name": file.filename,
                "type": "bulletin"
            })

        except Exception as e:
            print(f"Error uploading {file.filename}: {e}")
            traceback.print_exc()

    return {
        "message": f"{len(uploaded)} bulletin(s) uploaded successfully",
        "uploaded_files": uploaded
    }


ORDONNANCE_UPLOAD_DIR = "ordonnances"
os.makedirs(ORDONNANCE_UPLOAD_DIR, exist_ok=True)

@app.post("/ordonnance/upload", response_model=schemas.UploadResponse)
async def upload_ordonnances(files: List[UploadFile] = File(...), db: Session = Depends(get_db)):
    uploaded = []

    for file in files:
        try:
            raw_timestamp = datetime.utcnow().isoformat()
            safe_timestamp = re.sub(r"[:.]", "-", raw_timestamp)

            filename = f"{safe_timestamp}_{file.filename}"
            file_path = os.path.join(ORDONNANCE_UPLOAD_DIR, filename)

            with open(file_path, "wb") as buffer:
                shutil.copyfileobj(file.file, buffer)

            # Save file info to database
            db_file = models.FileUpload(
                filename=filename,
                original_name=file.filename,
                path=file_path,
                type="ordonnance",  
                
                uploaded_at=datetime.utcnow()
            )
            db.add(db_file)
            db.commit()
            db.refresh(db_file)

            uploaded.append({
                "id": db_file.id, 
                "filename": filename, 
                "original_name": file.filename,
                "type": "ordonnance"
                
            })

        except Exception as e:
            print(f"Error uploading {file.filename}: {e}")
            traceback.print_exc()

    
    return {
        "message": f"{len(uploaded)} ordonnance(s) uploaded successfully",
        "uploaded_files": uploaded,
    }


@app.get("/bulletin/uploaded/latest")
async def get_latest_bulletin(db: Session = Depends(get_db)):
    try:
        latest_bulletin = (
            db.query(models.FileUpload)
            .filter(models.FileUpload.type == "bulletin")
            .order_by(desc(models.FileUpload.uploaded_at))
            .first()
        )
        
        if latest_bulletin:
            return {
                "id": latest_bulletin.id,
                "filename": latest_bulletin.filename,
                "original_name": latest_bulletin.original_name,
                "uploaded_at": latest_bulletin.uploaded_at,
                "exists": True,
                "type": latest_bulletin.type
            }
        else:
            return {"exists": False, "message": "No bulletin found."}
    
    except Exception as e:
        print("Error in get_latest_bulletin:", e)
        traceback.print_exc()
        return {"exists": False, "message": "An error occurred."}
    
@app.get("/ordonnance/uploaded/latest")
async def get_latest_bulletin(db: Session = Depends(get_db)):
    try:
        latest_bulletin = (
            db.query(models.FileUpload)
            .filter(models.FileUpload.type == "ordonnance")
            .order_by(desc(models.FileUpload.uploaded_at))
            .first()
        )
        
        if latest_bulletin:
            return {
                "id": latest_bulletin.id,
                "filename": latest_bulletin.filename,
                "original_name": latest_bulletin.original_name,
                "uploaded_at": latest_bulletin.uploaded_at,
                "exists": True,
                "type": latest_bulletin.type
            }
        else:
            return {"exists": False, "message": "No bulletin found."}
    
    except Exception as e:
        print("Error in get_latest_bulletin:", e)
        traceback.print_exc()
        return {"exists": False, "message": "An error occurred."}

@app.get("/bulletin/uploaded/all")
async def get_all_bulletins(db: Session = Depends(get_db)):
    files = db.query(models.FileUpload).order_by(desc(models.FileUpload.uploaded_at)).all()
    bulletins = [
        {
            "id": f.id,
            "filename": f.filename,
            "original_name": f.original_name,
            "uploaded_at": f.uploaded_at,
            "type": f.type
        }
        for f in files if f.type == "bulletin"
    ]
    return bulletins

@app.get("/ordonnance/uploaded/all")
async def get_all_bulletins(db: Session = Depends(get_db)):
    files = db.query(models.FileUpload).order_by(desc(models.FileUpload.uploaded_at)).all()
    ordonnances = [
        {
            "id": f.id,
            "filename": f.filename,
            "original_name": f.original_name,
            "uploaded_at": f.uploaded_at,
            "type": f.type
        }
        for f in files if f.type == "ordonnance"
    ]
    return ordonnances


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


#@app.on_event("startup")
#def reset_database_on_startup():
    models.Base.metadata.drop_all(bind=engine)
    models.Base.metadata.create_all(bind=engine)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
