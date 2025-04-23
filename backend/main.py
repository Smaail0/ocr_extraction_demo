from datetime import datetime
import os
import re
import shutil
from fastapi import FastAPI, File, HTTPException, Depends, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from typing import List, Optional
from . import models, schemas
from .database import engine, SessionLocal
from sqlalchemy import desc
from .services.azure import parse_bulletin_ocr

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

@app.post("/bulletin/parse")
async def parse_bulletin(file: UploadFile = File(...)):
    """
    Receives one file, runs the Azure OCR pipeline in a threadpool,
    and returns the parsed JSON.
    """
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
        orm_mode = True

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

            # Save file info to database
            db_file = models.FileUpload(
                filename=filename,
                original_name=file.filename,
                path=file_path,
                uploaded_at=datetime.utcnow()
            )
            db.add(db_file)
            db.commit()
            db.refresh(db_file)

            uploaded.append({
                "id": db_file.id, 
                "filename": filename, 
                "original_name": file.filename
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

# Health check
@app.get("/health")
def health_check():
    return {"status": "healthy"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)