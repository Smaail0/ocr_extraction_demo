#Models
from datetime import datetime
from sqlalchemy import Boolean, Column, ForeignKey, Integer, String, DateTime, Text
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
    uploaded_at = Column(DateTime, default=datetime.utcnow)
