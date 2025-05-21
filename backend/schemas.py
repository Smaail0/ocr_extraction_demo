from datetime import datetime
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field, Extra, EmailStr

class PrescriptionItem(BaseModel):
    codePCT: str = ""
    produit: str = ""
    forme: str = ""
    qte: str = ""
    puv: str = ""
    montantPercu: str = ""
    nio: str = ""
    prLot: str = ""

class PrescriptionBase(BaseModel):
    pharmacyName: str
    pharmacyAddress: Optional[str] = ""
    pharmacyContact: Optional[str] = ""
    pharmacyFiscalId: Optional[str] = ""

    beneficiaryId: Optional[str] = ""
    patientIdentity: Optional[str] = ""
    prescriberCode: Optional[str] = ""
    prescriptionDate: Optional[str] = ""
    regimen: Optional[str] = ""
    dispensationDate: Optional[str] = ""
 
    executor: Optional[str] = ""
    pharmacistCnamRef: Optional[str] = Field("", alias="ref_cnam")

    items: List[PrescriptionItem]  = Field(default_factory=list)
    total: Optional[str] = ""
    totalInWords: Optional[str] = ""
    
    signatureCropFile: Optional[str] = None
    nom_prenom_docteur: Optional[str] = Field(None, alias="nom_prenom_docteur")
    
    class Config:
        extra = Extra.ignore
        validate_by_name = True

class PrescriptionCreate(PrescriptionBase):
    beneficiaryId: str = ""
    
    class Config(PrescriptionBase.Config):
        validate_by_name = True
        pass


class Prescription(PrescriptionBase):
    id: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

class BulletinBase(BaseModel):
    prenom:            Optional[str] = None
    nom:               Optional[str] = None
    adresse:           Optional[str] = None
    codePostal:        Optional[str] = None
    prenomMalade:      Optional[str] = None
    nomMalade:         Optional[str] = None
    assureSocial:      bool = False
    conjoint:          bool = False
    enfant:            bool = False
    ascendant:         bool = False
    dateNaissance:     Optional[str] = None
    numTel:            Optional[str] = None
    refDossier:        Optional[str] = None
    identifiantUnique: Optional[str] = None
    cnss:              bool = False
    cnrps:             bool = False
    convbi:            bool = False
    patientType:       Optional[str] = None

    consultationsDentaires: List[Dict[str,str]] = Field(default_factory=list, alias="consultationsDentaires")
    prothesesDentaires:     List[Dict[str,str]] = Field(default_factory=list, alias="prothesesDentaires")
    consultationsVisites:   List[Dict[str,str]] = Field(default_factory=list, alias="consultationsVisites")
    actesMedicaux:          List[Dict[str,str]] = Field(default_factory=list, alias="actesMedicaux")
    actesParamed:           List[Dict[str,str]] = Field(default_factory=list, alias="actesParamed")
    biologie:               List[Dict[str,str]] = Field(default_factory=list, alias="biologie")
    hospitalisation:        List[Dict[str,str]] = Field(default_factory=list, alias="hospitalisation")
    pharmacie:              List[Dict[str,str]] = Field(default_factory=list, alias="pharmacie")

    apci:             bool = False
    mo:               bool = False
    hosp:             bool = False
    grossesse:        bool = False

    codeApci:         Optional[str] = Field(None, alias="codeApci")
    dateAccouchement: Optional[str] = Field(None, alias="dateAccouchement")
    
    class Config:
        allow_population_by_field_name = True
        validate_by_name = True
        from_attributes = True
        
class BulletinCreate(BulletinBase):
    identifiantUnique: str

class UploadedFileInfo(BaseModel):
    id: int
    filename: str
    original_name: str
    path: str
    type: str
    uploaded_at: datetime

    class Config:
        orm_mode = True
    
class CourierBase(BaseModel):
    mat_fiscale: str
    nom_complet_adherent: str
    nom_complet_beneficiaire: str
    
class CourierCreate(CourierBase):
    pass

class Courier(CourierBase):
    id: int
    created_at: datetime
    files: List[UploadedFileInfo]

    class Config:
        orm_mode = True

class Bulletin(BulletinBase):
    id: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
        
class UploadResponse(BaseModel):
    message: str
    uploaded_files: List[UploadedFileInfo]
   
class BulletinInDB(Bulletin):
    id: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
        
class PrescriptionInDB(Prescription):
    id: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

class FileUploadBase(BaseModel):
    filename: str
    file_path: str

class FileUploadCreate(FileUploadBase):
    pass

class FileUpload(FileUploadBase):
    id: int

    class Config:
        orm_mode = True

class FileDocumentAssociation(BaseModel):
    file_id: int
    document_id: int
    document_type: str  # "bulletin" or "prescription" or "ordonnance"
            
class UserBase(BaseModel):
    email: EmailStr

class UserCreate(UserBase):
    username: str
    password: str
    is_superuser: Optional[bool] = False
    is_active:    Optional[bool] = True

class UserRead(UserBase):
    id: int
    is_active: bool
    is_superuser: bool
    class Config:
        orm_mode = True
        
class UserUpdate(BaseModel):
    username:    Optional[str]      = None
    email:       Optional[EmailStr] = None
    password:    Optional[str]      = None
    is_active:   Optional[bool]     = None
    is_superuser: Optional[bool]    = None
    
    class Config:
        # allow omission of unset fields
        extra = "ignore"
    
class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"