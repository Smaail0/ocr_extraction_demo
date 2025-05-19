from datetime import datetime
import os, re, shutil
import traceback
from typing import List, Optional
from fastapi import Body, Form
import tempfile
from pathlib import Path
import cv2
from fastapi import FastAPI, File, HTTPException, Depends, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from sqlalchemy import desc
from sqlalchemy.orm import Session, joinedload

from . import models, schemas
from .database import engine, SessionLocal
from .services.azure import classify_form_on_bytes, parse_bulletin_ocr, parse_prescription_ocr
from azure_model.pipeline import classify_form


from fastapi import FastAPI, File, Form, UploadFile, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import datetime
import os, re, shutil

from . import models, schemas
from .database import engine, SessionLocal


models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="Medical Documents API")

BASE = Path(__file__).resolve().parent.parent

PRESC_HDR = cv2.imread(str(BASE / "assets" /"ordonnance_header1.png"))
BULL_HDR = cv2.imread(str(BASE / "assets" /"bulletin_de_soin_header1.png"))
if PRESC_HDR is None or BULL_HDR is None:
    raise RuntimeError("Could not load header templates – check your paths!")


app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:4200"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

@app.post("/api/documents/parse")
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
        else:
            parsed = await parse_bulletin_ocr(data, file.filename)

    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))

    return {"header": {"documentType": form_key}, **parsed}


UPLOAD_DIR = "files"
os.makedirs(UPLOAD_DIR, exist_ok=True)




models.Base.metadata.create_all(bind=engine)
UPLOAD_DIR = "files"
os.makedirs(UPLOAD_DIR, exist_ok=True)



def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()



def detect_file_type_from_filename(filename: str) -> str:
    filename_upper = filename.upper()
    if filename_upper.startswith("BULLETIN"):
        return "bulletin"
    elif filename_upper.startswith("ORDONNANCE"):
        return "ordonnance"
    else:
        return "unknown"



@app.post(
    "/api/courrier/upload",
    response_model=schemas.Courier,
    summary="Créer un Courier et y attacher 1+ fichiers"
)
async def upload_courrier(
    mat_fiscale: str              = Form(...),
    nom_complet_adherent: str     = Form(...),
    nom_complet_beneficiaire: str = Form(...),
    files: List[UploadFile]       = File(...),
    db: Session                   = Depends(get_db)
):

    db_courier = models.Courier(
        mat_fiscale=mat_fiscale,
        nom_complet_adherent=nom_complet_adherent,
        nom_complet_beneficiaire=nom_complet_beneficiaire,
        created_at=datetime.utcnow()
    )
    db.add(db_courier)
    db.commit()
    db.refresh(db_courier)


    for upload in files:
        # Générer un nom unique pour le disque
        ts        = datetime.utcnow().isoformat()
        safe_ts   = re.sub(r"[:.]", "-", ts)
        stored    = f"{safe_ts}_{upload.filename}"
        full_path = os.path.join(UPLOAD_DIR, stored)

        with open(full_path, "wb") as out_f:
            shutil.copyfileobj(upload.file, out_f)

        file_type = detect_file_type_from_filename(upload.filename)

        db_file = models.FileUpload(
            filename      = stored,
            original_name = upload.filename,
            path          = full_path,
            type          = file_type,       
            courier_id    = db_courier.id

        )
        db.add(db_file)

    db.commit()
    db.refresh(db_courier)

    return db_courier

@app.post("/api/bulletin/", response_model=schemas.Bulletin)
def create_bulletin(bulletin: schemas.BulletinCreate, file_id: Optional[int] = None, db: Session = Depends(get_db)):
    print(f"Received bulletin data: {bulletin}")

    try:
        # Create new bulletin
        db_bulletin = models.Bulletin(
            **bulletin.dict(exclude={"identifiantUnique"}),
            identifiantUnique=bulletin.identifiantUnique
        )

        db.add(db_bulletin)
        db.commit()
        db.refresh(db_bulletin)
        
        # Associate with file if file_id is provided
        if file_id:
            file = db.query(models.FileUpload).filter(models.FileUpload.id == file_id).first()
            if file:
                file.bulletin_id = db_bulletin.id
                db.commit()
        
        return db_bulletin

    except Exception as e:
        db.rollback()
        print(f"Error creating bulletin: {str(e)}")
        raise HTTPException(500, f"Failed to save bulletin: {str(e)}")


@app.post("/api/prescription/", response_model=schemas.Prescription)
def create_prescription(
    presc: schemas.PrescriptionCreate,
    file_id: Optional[int] = None,
    db: Session = Depends(get_db)
):
    print(f"Received prescription data: {presc}")
    try:
        if not presc.items:
            raise HTTPException(400, "Prescription must have at least one item")

        # Create new prescription
        data = presc.dict()
        db_presc = models.Prescription(**data)
        
        db.add(db_presc)
        db.commit()
        db.refresh(db_presc)
        
        # Associate with file if file_id is provided
        if file_id:
            file = db.query(models.FileUpload).filter(models.FileUpload.id == file_id).first()
            if file:
                file.prescription_id = db_presc.id
                db.commit()
        
        return db_presc
    
    except Exception as e:
        db.rollback()  # Rollback transaction on error
        # Log the actual error
        print(f"Error creating prescription: {str(e)}")
        raise HTTPException(500, f"Failed to save prescription: {str(e)}")


BULLETIN_UPLOAD_DIR = "bulletins"
os.makedirs(BULLETIN_UPLOAD_DIR, exist_ok=True)

@app.post("/api/documents/associate")
def associate_file_with_document(
    association: schemas.FileDocumentAssociation,
    db: Session = Depends(get_db)
):
    try:
        file = db.query(models.FileUpload).filter(models.FileUpload.id == association.file_id).first()
        if not file:
            raise HTTPException(404, "File not found")

        if association.document_type == "bulletin":
            file.bulletin_id = association.document_id
            file.prescription_id = None
        elif association.document_type == "prescription" or association.document_type == "ordonnance":
            file.prescription_id = association.document_id
            file.bulletin_id = None
        else:
            raise HTTPException(400, "Invalid document type")
            
        db.commit()
        db.refresh(file)
        
        return {
            "message": "Association successful",
            "file": {
                "id": file.id,
                "filename": file.filename,
                "type": file.type,
                "bulletin_id": file.bulletin_id,
                "prescription_id": file.prescription_id
            }
        }
        
    except Exception as e:
        db.rollback()
        print(f"Error associating file with document: {str(e)}")
        raise HTTPException(500, f"Failed to associate file: {str(e)}")
    
@app.get("/api/bulletin/uploaded/latest")
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
                "type": latest_bulletin.type,
                "bulletin_id": latest_bulletin.bulletin_id
            }
        else:
            return {"exists": False, "message": "No bulletin found."}
    
    except Exception as e:
        print("Error in get_latest_bulletin:", e)
        traceback.print_exc()
        return {"exists": False, "message": "An error occurred."}
    
@app.get("/api/ordonnance/uploaded/latest")
async def get_latest_ordonnance(db: Session = Depends(get_db)):
    try:
        latest_ordonnance = (
            db.query(models.FileUpload)
            .filter(models.FileUpload.type == "ordonnance")
            .order_by(desc(models.FileUpload.uploaded_at))
            .first()
        )
        
        if latest_ordonnance:
            return {
                "id": latest_ordonnance.id,
                "filename": latest_ordonnance.filename,
                "original_name": latest_ordonnance.original_name,
                "uploaded_at": latest_ordonnance.uploaded_at,
                "exists": True,
                "type": latest_ordonnance.type,
                "prescription_id": latest_ordonnance.prescription_id
            }
        else:
            return {"exists": False, "message": "No ordonnance found."}
    
    except Exception as e:
        print("Error in get_latest_ordonnance:", e)
        traceback.print_exc()
        return {"exists": False, "message": "An error occurred."}

@app.get("/api/bulletin/uploaded/all")
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



@app.get("/api/ordonnance/uploaded/all")
async def get_all_ordonnances(db: Session = Depends(get_db)):
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

@app.get("/api/courrier/uploaded/all", response_model=List[schemas.Courier])
async def get_all_courriers(db: Session = Depends(get_db)):

    courriers = (
        db.query(models.Courier)
          .options(joinedload(models.Courier.files))
          .all()
    )
    return courriers
@app.get("/api/courrier/uploaded/latest", response_model=List[schemas.Courier])
async def get_all_courriers(db: Session = Depends(get_db)):

    courriers = (
        db.query(models.Courier)
          .options(joinedload(models.Courier.files))
          .order_by(models.Courier.created_at.desc())
          .all()
    )
    return courriers
@app.get("/api/courrier/uploaded/all", response_model=schemas.Courier)
async def get_latest_courrier(db: Session = Depends(get_db)):
    """
    Return the single most recently created Courier, with its files.
    """
    try:
        latest = (
            db.query(models.Courier)
              .options(joinedload(models.Courier.files))
              .order_by(models.Courier.created_at.desc())
              .first()
        )
        if not latest:
            raise HTTPException(404, detail="No courier found")
        return latest
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(500, detail="Failed to fetch latest courier")

@app.put("/api/bulletin/{bulletin_id}", response_model=schemas.Bulletin)
def update_bulletin(
    bulletin_id: int,
    bulletin: schemas.BulletinCreate = Body(...),
    db: Session = Depends(get_db)
):
    db_b = db.get(models.Bulletin, bulletin_id)
    if not db_b:
        raise HTTPException(404, "Bulletin not found")

    for key, val in bulletin.model_dump().items():
        setattr(db_b, key, val)

    db.commit()
    db.refresh(db_b)
    return db_b

@app.get("/api/files/{file_id}")
async def get_file(file_id: int, db: Session = Depends(get_db)):
    """
    Serve a file by its ID. Returns the actual file content.
    """
    try:
        # Get the file record from database
        db_file = db.query(models.FileUpload).filter(models.FileUpload.id == file_id).first()
        
        if not db_file:
            raise HTTPException(status_code=404, detail="File not found")
        
        # Check if the file exists on disk
        if not os.path.exists(db_file.path):
            raise HTTPException(status_code=404, detail="File not found on disk")
        
        # Determine the media type based on file extension
        file_extension = os.path.splitext(db_file.original_name)[1].lower()
        media_type = "application/pdf"  # Default to PDF
        
        if file_extension == ".pdf":
            media_type = "application/pdf"
        elif file_extension in [".jpg", ".jpeg"]:
            media_type = "image/jpeg"
        elif file_extension == ".png":
            media_type = "image/png"
        
        # Return the file
        return FileResponse(
            path=db_file.path,
            media_type=media_type,
            filename=db_file.original_name,
            headers={"Content-Disposition": f"inline; filename=\"{db_file.original_name}\""}
        )
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error serving file: {str(e)}")
        raise HTTPException(status_code=500, detail="Error serving file")


#@app.on_event("startup")
#def reset_database_on_startup():
    models.Base.metadata.drop_all(bind=engine)
    models.Base.metadata.create_all(bind=engine)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)