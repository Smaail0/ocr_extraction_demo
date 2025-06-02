-- Enable UUID and JSON support if needed
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Table: users
CREATE TABLE "users" (
    "id" SERIAL PRIMARY KEY,
    "username" VARCHAR NOT NULL UNIQUE,
    "email" VARCHAR NOT NULL UNIQUE,
    "hashed_password" VARCHAR NOT NULL,
    "is_active" BOOLEAN DEFAULT TRUE,
    "is_superuser" BOOLEAN DEFAULT FALSE,
    "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table: couriers
CREATE TABLE "couriers" (
    "id" SERIAL PRIMARY KEY,
    "mat_fiscale" VARCHAR,
    "nom_complet_adherent" VARCHAR,
    "nom_complet_beneficiaire" VARCHAR,
    "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table: bulletins
CREATE TABLE "bulletins" (
    "id" SERIAL PRIMARY KEY,
    "prenom" VARCHAR,
    "nom" VARCHAR,
    "adresse" VARCHAR,
    "codePostal" VARCHAR,
    "prenomMalade" VARCHAR,
    "nomMalade" VARCHAR,
    "assureSocial" BOOLEAN DEFAULT FALSE,
    "conjoint" BOOLEAN DEFAULT FALSE,
    "enfant" BOOLEAN DEFAULT FALSE,
    "ascendant" BOOLEAN DEFAULT FALSE,
    "dateNaissance" VARCHAR,
    "numTel" VARCHAR,
    "refDossier" VARCHAR,
    "identifiantUnique" VARCHAR NOT NULL,
    "cnss" BOOLEAN DEFAULT FALSE,
    "cnrps" BOOLEAN DEFAULT FALSE,
    "convbi" BOOLEAN DEFAULT FALSE,
    "patientType" VARCHAR,
    "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "consultations_dentaires" JSON NOT NULL DEFAULT '[]',
    "protheses_dentaires" JSON NOT NULL DEFAULT '[]',
    "consultations_visites" JSON NOT NULL DEFAULT '[]',
    "actes_medicaux" JSON NOT NULL DEFAULT '[]',
    "actes_paramed" JSON NOT NULL DEFAULT '[]',
    "biologie" JSON NOT NULL DEFAULT '[]',
    "hospitalisation" JSON NOT NULL DEFAULT '[]',
    "pharmacie" JSON NOT NULL DEFAULT '[]',
    "apci" BOOLEAN DEFAULT FALSE,
    "mo" BOOLEAN DEFAULT FALSE,
    "hosp" BOOLEAN DEFAULT FALSE,
    "grossesse" BOOLEAN DEFAULT FALSE,
    "codeApci" VARCHAR,
    "dateAccouchement" VARCHAR,
    "is_verified" BOOLEAN DEFAULT FALSE
);

-- Table: prescriptions
CREATE TABLE "prescriptions" (
    "id" SERIAL PRIMARY KEY,
    "pharmacyName" VARCHAR NOT NULL,
    "pharmacyAddress" VARCHAR,
    "pharmacyContact" VARCHAR,
    "pharmacyFiscalId" VARCHAR,
    "beneficiaryId" VARCHAR NOT NULL,
    "patientIdentity" VARCHAR,
    "prescriberCode" VARCHAR,
    "prescriptionDate" VARCHAR,
    "regimen" VARCHAR,
    "dispensationDate" VARCHAR,
    "executor" VARCHAR,
    "pharmacistCnamRef" VARCHAR,
    "items" JSON NOT NULL,
    "total" VARCHAR,
    "totalInWords" VARCHAR,
    "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "signatureCropFile" VARCHAR,
    "nom_prenom_docteur" VARCHAR,
    "is_verified" BOOLEAN DEFAULT FALSE,
    "is_flagged" BOOLEAN DEFAULT FALSE
);

-- Table: file_uploads
CREATE TABLE "file_uploads" (
    "id" SERIAL PRIMARY KEY,
    "filename" VARCHAR NOT NULL,
    "original_name" VARCHAR NOT NULL,
    "path" VARCHAR NOT NULL,
    "type" VARCHAR NOT NULL,
    "uploaded_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "size_in_bytes" INTEGER NOT NULL DEFAULT 0,
    "courier_id" INTEGER NOT NULL REFERENCES "couriers"("id") ON DELETE CASCADE,
    "prescription_id" INTEGER REFERENCES "prescriptions"("id") ON DELETE SET NULL,
    "bulletin_id" INTEGER REFERENCES "bulletins"("id") ON DELETE SET NULL
);

-- Indexes
CREATE INDEX idx_users_id ON "users"("id");
CREATE INDEX idx_couriers_id ON "couriers"("id");
CREATE INDEX idx_bulletins_id ON "bulletins"("id");
CREATE INDEX idx_prescriptions_id ON "prescriptions"("id");
CREATE INDEX idx_file_uploads_id ON "file_uploads"("id");
