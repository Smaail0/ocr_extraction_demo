from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel

# ── Your existing Prescription/PrescriptionItem ──
class PrescriptionItem(BaseModel):
    codePCT: str
    produit: str
    forme: str
    qte: str
    puv: str
    montantPercu: str
    nio: str
    prLot: str

class PrescriptionBase(BaseModel):
    pharmacyName: str
    pharmacyAddress: Optional[str]
    pharmacyContact: Optional[str]
    pharmacyFiscalId: Optional[str]

    beneficiaryId: Optional[str]
    patientIdentity: str
    prescriberCode: Optional[str]
    prescriptionDate: Optional[str]
    regimen: Optional[str]
    dispensationDate: Optional[str]

    executor: Optional[str]
    pharmacistCnamRef: Optional[str]

    items: List[PrescriptionItem]
    total: Optional[str]
    totalInWords: Optional[str]

class PrescriptionCreate(PrescriptionBase):
    beneficiaryId: str

class Prescription(PrescriptionBase):
    id: int
    created_at: datetime
    updated_at: datetime

    class Config:
        orm_mode = True

# ── Your existing Bulletin ──
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
    identifiantUnique: str 

class Bulletin(BulletinBase):
    id: int
    created_at: datetime
    updated_at: datetime

    class Config:
        orm_mode = True

# ── FileUpload / UploadResponse ──
class UploadedFileInfo(BaseModel):
    id: int
    filename: str
    original_name: str
    type: str

class UploadResponse(BaseModel):
    message: str
    uploaded_files: List[UploadedFileInfo]

# ── Patient & relationships ──
class PatientBase(BaseModel):
    first_name: str
    last_name: str

class PatientCreate(PatientBase):
    pass

class Patient(PatientBase):
    id: int
    created_at: datetime
    updated_at: datetime

    class Config:
        orm_mode = True

# Now extend your DB-ready schemas with patient_id
class BulletinInDB(Bulletin):
    id: int
    patient_id: int
    created_at: datetime
    updated_at: datetime

    class Config:
        orm_mode = True

class PrescriptionInDB(Prescription):
    id: int
    patient_id: int
    created_at: datetime
    updated_at: datetime

    class Config:
        orm_mode = True

# Finally, a wrapper that includes both lists
class PatientWithDocs(Patient):
    bulletins: List[BulletinInDB]       = []
    prescriptions: List[PrescriptionInDB] = []
    
