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
    type: str  


class OrdonnanceBase(BaseModel):
    nom_pharmacie: Optional[str] = None
    adresse_pharmacie: Optional[str] = None
    telephone_fax: Optional[str] = None
    matricule_fiscale: Optional[str] = None

    id_beneficiaire: Optional[str] = None
    nom_malade: Optional[str] = None
    code_prescripteur: Optional[str] = None
    date_prescription: Optional[str] = None
    regime: Optional[str] = None
    date_dispensation: Optional[str] = None
    code_executeur: Optional[str] = None
    reference_cnam: Optional[str] = None

    code_pct: Optional[str] = None
    produit: Optional[str] = None
    forme: Optional[str] = None
    quantite: Optional[int] = None
    prix_unitaire: Optional[float] = None
    montant_percu: Optional[float] = None
    nio: Optional[str] = None
    pr_lot: Optional[str] = None

    montant_total: Optional[float] = None
    montant_en_lettres: Optional[str] = None


class OrdonnanceCreate(OrdonnanceBase):
    pass


class Ordonnance(OrdonnanceBase):
    id: int
    created_at: datetime
    updated_at: datetime

    class Config:
        orm_mode = True





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
    type: str

class UploadResponse(BaseModel):
    message: str
    uploaded_files: List[UploadedFileInfo]
    failed_uploads: Optional[List[dict]] = None
