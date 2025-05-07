from datetime import datetime
import os
import re
import shutil
from fastapi import FastAPI, File, HTTPException, Depends, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from typing import List, Optional
from . import models, schemas
from .database import Base, engine, SessionLocal
from sqlalchemy import desc
from .services.azure import parse_bulletin_ocr
from .services.azure import parse_ordonnance_ocr 

# Create database tables
models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="Medical Documents API")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

@app.on_event("startup")
def reset_db():
    Base.metadata.drop_all(bind=engine)  # ❌ Drop all tables
    Base.metadata.create_all(bind=engine)  # ✅ Recreate them from models

@app.post("/bulletin/parse")
async def parse_bulletin(file: UploadFile = File(...)):
    # read file bytes
    contents = await file.read()
    # call your azure wrapper
    parsed = await parse_bulletin_ocr(contents, file.filename)
    return parsed

# Dependency to get the database session
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# Create new bulletin
@app.post("/bulletin/", response_model=schemas.Bulletin)
def create_bulletin(bulletin: schemas.BulletinCreate, db: Session = Depends(get_db)):
    db_bulletin = models.Bulletin(**bulletin.dict())
    db.add(db_bulletin)
    db.commit()
    db.refresh(db_bulletin)
    return db_bulletin

UPLOAD_DIR = "bulletins"
os.makedirs(UPLOAD_DIR, exist_ok=True)



# Create FileUpload schema in schemas.py
class FileUploadBase(schemas.BaseModel):
    filename: str
    original_name: str
    path: str

class FileUploadCreate(FileUploadBase):
    pass

class FileUpload(FileUploadBase):
    id: int
    uploaded_at: datetime

    class Config:
       from_attributes = True


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

                # Debug: Print what we're trying to insert
                print(f"Inserting file with type: ordonnance and path: {file_path}")

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
            continue  # continue uploading others even if one fails

    return {
        "message": f"{len(uploaded)} bulletin(s) uploaded successfully",
        "uploaded_files": uploaded
    }

@app.get("/bulletin/uploaded/latest")
async def get_latest_bulletin(db: Session = Depends(get_db)):
    latest_file = db.query(models.FileUpload).order_by(desc(models.FileUpload.uploaded_at)).first()
    
    if not latest_file:
        return {
            "filename": None,
            "original_name": None,
            "uploaded_at": None,
            "exists": False,
            "message": "No bulletins uploaded yet"
        }
    
    return {
        "id": latest_file.id,
        "filename": latest_file.filename,
        "original_name": latest_file.original_name,
        "uploaded_at": latest_file.uploaded_at,
        "exists": True
    }

@app.get("/bulletin/uploaded/all")
async def get_all_bulletins(db: Session = Depends(get_db)):
    files = db.query(models.FileUpload).order_by(desc(models.FileUpload.uploaded_at)).all()
    
    if not files:
        return []
    
    return [
        {
            "id": file.id,
            "filename": file.filename,
            "original_name": file.original_name,
            "uploaded_at": file.uploaded_at
        } for file in files
    ]

# Update bulletin
@app.put("/bulletin/{bulletin_id}", response_model=schemas.Bulletin)
def update_bulletin(bulletin_id: int, bulletin: schemas.BulletinCreate, db: Session = Depends(get_db)):
    db_bulletin = db.query(models.Bulletin).filter(models.Bulletin.id == bulletin_id).first()
    if db_bulletin is None:
        raise HTTPException(status_code=404, detail="Bulletin not found")
    
    for key, value in bulletin.dict().items():
        setattr(db_bulletin, key, value)
    
    db.commit()
    db.refresh(db_bulletin)
    return db_bulletin




ORDONNANCE_UPLOAD_DIR = "ordonnances"
os.makedirs(ORDONNANCE_UPLOAD_DIR, exist_ok=True)

# Create new ordonnance
@app.post("/ordonnance/", response_model=schemas.Ordonnance)
def create_ordonnance(ordonnance: schemas.OrdonnanceCreate, db: Session = Depends(get_db)):
    db_ordonnance = models.Ordonnance(**ordonnance.dict())
    db.add(db_ordonnance)
    db.commit()
    db.refresh(db_ordonnance)
    return db_ordonnance



# Update ordonnance
@app.put("/ordonnance/{ordonnance_id}", response_model=schemas.Ordonnance)
def update_ordonnance(ordonnance_id: int, ordonnance: schemas.OrdonnanceCreate, db: Session = Depends(get_db)):
    db_ordonnance = db.query(models.Ordonnance).filter(models.Ordonnance.id == ordonnance_id).first()
    if db_ordonnance is None:
        raise HTTPException(status_code=404, detail="Ordonnance not found")
    
    for key, value in ordonnance.dict().items():
        setattr(db_ordonnance, key, value)
    
    db.commit()
    db.refresh(db_ordonnance)
    return db_ordonnance



# Parse ordonnance with OCR
@app.post("/ordonnance/parse")
async def parse_ordonnance(file: UploadFile = File(...)):
    # Read file bytes
    contents = await file.read()

    parsed = await parse_ordonnance_ocr(contents,file.filename)
    return parsed

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()



# Upload ordonnance files
@app.post("/ordonnance/upload", response_model=schemas.UploadResponse)
async def upload_ordonnances(files: List[UploadFile] = File(...), db: Session = Depends(get_db)):
    uploaded = []
    failed = []
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
                type="ordonnance",  # Confirm this is being set
                
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
            failed.append({"filename": file.filename, "error": str(e)})
            # The continue statement should be inside the except block if needed,
            # but it's not actually necessary here since we're already at the end of the loop
    
    return {
        "message": f"{len(uploaded)} ordonnance(s) uploaded successfully",
        "uploaded_files": uploaded,
        "failed_uploads": failed
    }


@app.post("/ordonnance/upload/debug")
async def debug_upload_ordonnances(files: List[UploadFile] = File(...)):
    """A simplified version to debug file uploads"""
    received_files = []
    
    for file in files:
        received_files.append({
            "filename": file.filename,
            "content_type": file.content_type,
            "size": len(await file.read())
        })
    
    return {
        "message": f"Received {len(received_files)} files",
        "files": received_files
    }

# Get latest uploaded ordonnance
@app.get("/ordonnance/uploaded/latest")
async def get_latest_ordonnance(db: Session = Depends(get_db)):
    # Assuming you'd track ordonnance uploads separately or have a type field in FileUpload
    # This is a simplified approach - you might want to modify FileUpload model to include a type field
    latest_file = db.query(models.FileUpload).filter(
        models.FileUpload.path.like(f"{ORDONNANCE_UPLOAD_DIR}%")
    ).order_by(desc(models.FileUpload.uploaded_at)).first()
    
    if not latest_file:
        return {
            "filename": None,
            "original_name": None,
            "uploaded_at": None,
            "exists": False,
            "message": "No ordonnances uploaded yet"
        }
    
    return {
        "id": latest_file.id,
        "filename": latest_file.filename,
        "original_name": latest_file.original_name,
        "uploaded_at": latest_file.uploaded_at,
        "exists": True
    }

# Get all uploaded ordonnances
@app.get("/ordonnance/uploaded/all")
async def get_all_ordonnances_uploaded(db: Session = Depends(get_db)):
    # Similar to the latest endpoint, assuming you'd track by path or add a type field
    files = db.query(models.FileUpload).filter(
        models.FileUpload.path.like(f"{ORDONNANCE_UPLOAD_DIR}%")
    ).order_by(desc(models.FileUpload.uploaded_at)).all()
    
    if not files:
        return []
    
    return [
        {
            "id": file.id,
            "filename": file.filename,
            "original_name": file.original_name,
            "uploaded_at": file.uploaded_at
        } for file in files
    ]




# Health check
@app.get("/health")
def health_check():
    return {"status": "healthy"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)