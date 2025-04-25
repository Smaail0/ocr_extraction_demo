#Models
from datetime import datetime
from sqlalchemy import Boolean, Column, Float, ForeignKey, Integer, String, DateTime, Text
from sqlalchemy.orm import relationship
from .database import Base

class Bulletin(Base):
    __tablename__ = "bulletins"

    id = Column(Integer, primary_key=True, index=True)
    prenom = Column(String, nullable=True)
    nom = Column(String, nullable=True)
    adresse = Column(String, nullable=True)
    codePostal = Column(String, nullable=True)
    prenomMalade = Column(String, nullable=True)
    nomMalade = Column(String, nullable=True)
    assureSocial = Column(Boolean, default=False)
    conjoint = Column(Boolean, default=False)
    enfant = Column(Boolean, default=False)
    ascendant = Column(Boolean, default=False)
    dateNaissance = Column(String, nullable=True)
    numTel = Column(String, nullable=True)
    refDossier = Column(String, nullable=True)
    identifiantUnique = Column(String, nullable=True)
    cnss = Column(Boolean, default=False)
    cnrps = Column(Boolean, default=False)
    convbi = Column(Boolean, default=False)
    patientType = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class FileUpload(Base):
    __tablename__ = "file_uploads"

    id = Column(Integer, primary_key=True, index=True)
    filename = Column(String, nullable=False)
    original_name = Column(String, nullable=False)
    path = Column(String, nullable=False)
    type = Column(String, nullable=False)  # Add this field ("bulletin" or "ordonnance")
    uploaded_at = Column(DateTime, default=datetime.utcnow)

class Ordonnance(Base): 
    
    __tablename__ = "ordonnances"
      
      
    id = Column(Integer, primary_key=True, index=True)
    nom_pharmacie = Column(String, nullable=True)
    adresse_pharmacie = Column(String, nullable=True)
    telephone_fax = Column(String, nullable=True)
    matricule_fiscale = Column(String, nullable=True)
 

    id_beneficiaire = Column(String, nullable=True)
    nom_malade = Column(String, nullable=True)
    code_prescripteur = Column(String, nullable=True)
    date_prescription = Column(String, nullable=True)  # ou Date si parsé
    regime = Column(String, nullable=True)
    date_dispensation = Column(String, nullable=True)  # ou Date si parsé
    code_executeur = Column(String, nullable=True)
    reference_cnam = Column(String, nullable=True)

    code_pct = Column(String, nullable=True)
    produit = Column(String, nullable=True)
    forme = Column(String, nullable=True)
    quantite = Column(Integer, nullable=True)
    prix_unitaire = Column(Float, nullable=True)
    montant_percu = Column(Float, nullable=True)
    nio = Column(String, nullable=True)
    pr_lot = Column(String, nullable=True)
    
    montant_total = Column(Float, nullable=True)
    montant_en_lettres = Column(String, nullable=True)
    
    

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    