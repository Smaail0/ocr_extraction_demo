#Schemas

from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel

class BulletinBase(BaseModel):
    prenom: Optional[str] = None
    nom: Optional[str] = None
    adresse: Optional[str] = None
    codePostal: Optional[str] = None
    prenomMalade: Optional[str] = None
    nomMalade: Optional[str] = None
    assureSocial: bool = False
    conjoint: bool = False
    enfant: bool = False
    ascendant: bool = False
    dateNaissance: Optional[str] = None
    numTel: Optional[str] = None
    refDossier: Optional[str] = None
    identifiantUnique: Optional[str] = None
    cnss: bool = False
    cnrps: bool = False
    convbi: bool = False
    patientType: Optional[str] = None

class BulletinCreate(BulletinBase):
    pass

class Bulletin(BulletinBase):
    id: int
    created_at: datetime
    updated_at: datetime

    class Config:
        orm_mode = True

class FileUploadBase(BaseModel):
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
        
        
class UploadedFileInfo(BaseModel):
    id: int
    filename: str
    original_name: str

class UploadResponse(BaseModel):
    message: str
    uploaded_files: List[UploadedFileInfo]
