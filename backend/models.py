#Models
from datetime import datetime
from sqlalchemy import Boolean, Column, ForeignKey, Integer, String, DateTime, Text, UniqueConstraint
from sqlalchemy.orm import relationship
from .database import Base
from sqlalchemy.dialects.postgresql import JSON

class Patient(Base):
    __tablename__ = "patients"
    __table_args__ = (
      UniqueConstraint("first_name", "last_name", name="uq_patient_name"),
    )
    id          = Column(Integer, primary_key=True, index=True)
    first_name  = Column(String, nullable=False, index=True)
    last_name   = Column(String, nullable=False, index=True)
    created_at  = Column(DateTime, default=datetime.utcnow)
    updated_at  = Column(DateTime, default=datetime.utcnow,
                         onupdate=datetime.utcnow)

    bulletins     = relationship("Bulletin",    back_populates="patient")
    prescriptions = relationship("Prescription", back_populates="patient")


class Bulletin(Base):
    __tablename__ = "bulletins"

    id                 = Column(Integer, primary_key=True, index=True)
    prenom             = Column(String,  nullable=True)
    nom                = Column(String,  nullable=True)
    adresse            = Column(String,  nullable=True)
    codePostal         = Column(String,  nullable=True)
    prenomMalade       = Column(String,  nullable=True)
    nomMalade          = Column(String,  nullable=True)
    assureSocial       = Column(Boolean, default=False)
    conjoint           = Column(Boolean, default=False)
    enfant             = Column(Boolean, default=False)
    ascendant          = Column(Boolean, default=False)
    dateNaissance      = Column(String,  nullable=True)
    numTel             = Column(String,  nullable=True)
    refDossier         = Column(String,  nullable=True)
    identifiantUnique  = Column(String,  nullable=False)
    cnss               = Column(Boolean, default=False)
    cnrps              = Column(Boolean, default=False)
    convbi             = Column(Boolean, default=False)
    patientType        = Column(String,  nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    consultationsDentaires = Column("consultations_dentaires", JSON, nullable=False, default=list)
    prothesesDentaires     = Column("protheses_dentaires",     JSON, nullable=False, default=list)
    consultationsVisites   = Column("consultations_visites",   JSON, nullable=False, default=list)
    actesMedicaux          = Column("actes_medicaux",          JSON, nullable=False, default=list)
    actesParamed           = Column("actes_paramed",           JSON, nullable=False, default=list)
    biologie               = Column("biologie",                JSON, nullable=False, default=list)
    hospitalisation        = Column("hospitalisation",         JSON, nullable=False, default=list)
    pharmacie              = Column("pharmacie",               JSON, nullable=False, default=list)

    apci           = Column("apci",           Boolean, default=False)
    mo             = Column("mo",             Boolean, default=False)
    hosp           = Column("hosp",           Boolean, default=False)
    grossesse      = Column("grossesse",      Boolean, default=False)

    codeApci       = Column("codeApci",       String, nullable=True)
    dateAccouchement = Column("dateAccouchement", String, nullable=True)

    patient_id = Column(Integer, ForeignKey("patients.id"), nullable=False)
    patient    = relationship("Patient", back_populates="bulletins")


class Prescription(Base):
    __tablename__ = "prescriptions"

    id                 = Column(Integer, primary_key=True, index=True)
    pharmacyName       = Column(String,  nullable=False)
    pharmacyAddress    = Column(String,  nullable=True)
    pharmacyContact    = Column(String,  nullable=True)
    pharmacyFiscalId   = Column(String,  nullable=True)

    beneficiaryId      = Column(String,  nullable=False)
    patientIdentity    = Column(String,  nullable=True)
    prescriberCode     = Column(String,  nullable=True)
    prescriptionDate   = Column(String,  nullable=True)
    regimen            = Column(String,  nullable=True)
    dispensationDate   = Column(String,  nullable=True)

    executor           = Column(String,  nullable=True)
    pharmacistCnamRef  = Column(String,  nullable=True)

    items              = Column(JSON,    nullable=False)
    total              = Column(String,  nullable=True)
    totalInWords       = Column(String,  nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    patient_id = Column(Integer, ForeignKey("patients.id"), nullable=False)
    patient    = relationship("Patient", back_populates="prescriptions")


class FileUpload(Base):
    __tablename__ = "file_uploads"

    id            = Column(Integer, primary_key=True, index=True)
    filename      = Column(String,  nullable=False)
    original_name = Column(String,  nullable=False)
    path          = Column(String,  nullable=False)
    uploaded_at   = Column(DateTime, default=datetime.utcnow)
