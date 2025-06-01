# main.py
from datetime import datetime, timedelta
import os, re, shutil
import time, asyncio
from typing import List, Optional
from fastapi import Body, Form
import tempfile
from pathlib import Path
import cv2, logging
import traceback
from fastapi import FastAPI, File, HTTPException, Depends, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from jose import jwt, JWTError
from sqlalchemy import desc
from passlib.context import CryptContext
from sqlalchemy.orm import Session, joinedload
from . import models, schemas
from .database import engine, SessionLocal
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, Response
from .services.azure import classify_form_on_bytes, parse_bulletin_ocr, parse_prescription_ocr
from azure_model.pipeline import client as azure_client, model_id as azure_model_id, classify_form
from azure_model.signature_pipeline import get_signature_crop, get_doctor_name, verify_signature
logger = logging.getLogger("uvicorn")
import json

models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="Medical Documents API")

SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY:
    raise RuntimeError("SECRET_KEY not set")

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30

pwd_context    = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme  = OAuth2PasswordBearer(tokenUrl="login")

BASE = Path(__file__).resolve().parent.parent
# ── Load header templates ──
PRESC_HDR = cv2.imread(str(BASE / "assets" /"ordonnance_header1.png"))
BULL_HDR = cv2.imread(str(BASE / "assets" /"bulletin_de_soin_header1.png"))
if PRESC_HDR is None or BULL_HDR is None:
    raise RuntimeError("Could not load header templates – check your paths!")
SIGNATURE_DIR = os.path.join(os.path.dirname(__file__), "..", "signatures")
app.mount(
    "/signatures",
    StaticFiles(directory=SIGNATURE_DIR),
    name="signatures",
)

UPLOAD_DIR = "files"
os.makedirs(UPLOAD_DIR, exist_ok=True)

models.Base.metadata.create_all(bind=engine)
UPLOAD_DIR = "files"
os.makedirs(UPLOAD_DIR, exist_ok=True)

# ── CORS ──
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:4200"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Dependency ──
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def detect_file_type_from_filename(filename: str) -> str:
    filename_upper = filename.upper()
    if filename_upper.startswith("BULLETIN"):
        return "bulletin"
    elif filename_upper.startswith("ORDONNANCE"):
        return "ordonnance"
    else:
        return "unknown"

def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)

def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)

def authenticate_user(db: Session, email: str, password: str):
    user = db.query(models.User).filter_by(email=email).first()
    if not user or not verify_password(password, user.hashed_password):
        return None
    return user

def create_access_token(data: dict, expires_delta: timedelta | None = None):
    to_encode = data.copy()
    expire    = datetime.utcnow() + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

@app.get("/api/courrier/{courier_id}", response_model=schemas.Courier)
def get_courrier(courier_id: int, db: Session = Depends(get_db)):
    courier = (
        db.query(models.Courier)
          .options(joinedload(models.Courier.files))
          .filter(models.Courier.id == courier_id)
          .first()
    )
    if not courier:
        raise HTTPException(404, f"Courier {courier_id} not found")
    return courier

async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db:    Session = Depends(get_db)
):
    creds_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email   = payload.get("sub")
        if email is None:
            raise creds_exc
    except JWTError:
        raise creds_exc

    user = db.query(models.User).filter_by(email=email).first()
    if not user:
        raise creds_exc
    return user

async def get_current_superuser(
    current_user: models.User = Depends(get_current_user)
):
    if not current_user.is_superuser:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="Not enough permissions")
    return current_user

@app.post("/api/prescriptions/", response_model=schemas.Prescription)
def create_prescription(
    presc: schemas.PrescriptionCreate,
    file_id: Optional[int] = None,
    db: Session = Depends(get_db)
):
    db_presc = models.Prescription(**presc.dict())
    db.add(db_presc); db.commit(); db.refresh(db_presc)
    if file_id:
        f = db.query(models.FileUpload).get(file_id)
        if f:
            f.prescription_id = db_presc.id
            db.commit()
    return db_presc

@app.post("/api/bulletins", response_model=schemas.Bulletin)
def create_bulletin(
    bull: schemas.BulletinCreate,
    file_id: Optional[int] = None,
    db: Session = Depends(get_db)
):
    db_bull = models.Bulletin(**bull.dict())
    db.add(db_bull); db.commit(); db.refresh(db_bull)
    if file_id:
        f = db.query(models.FileUpload).get(file_id)
        if f:
            f.bulletin_id = db_bull.id
            db.commit()
    return db_bull

@app.put(
    "/api/bulletins/{bulletin_id}",
    response_model=schemas.Bulletin,
    summary="Mettre à jour un Bulletin de soin"
)
def update_bulletin(
    bulletin_id: int,
    bulletin_up: schemas.BulletinCreate = Body(...),
    db: Session = Depends(get_db),
):
    db_b = db.get(models.Bulletin, bulletin_id)
    if not db_b:
        raise HTTPException(404, "Bulletin non trouvé")
    for field, val in bulletin_up.dict(exclude_unset=True).items():
        setattr(db_b, field, val)
    db_b.is_verified = True
    db.commit(); db.refresh(db_b)
    return db_b

@app.get(
    "/api/bulletins/{bulletin_id}",
    response_model=schemas.Bulletin,
    summary="Récupérer un Bulletin de soin par ID"
)
def read_bulletin(
    bulletin_id: int,
    db: Session = Depends(get_db)
):
    b = db.get(models.Bulletin, bulletin_id)
    if not b:
        raise HTTPException(status_code=404, detail="Bulletin non trouvé")
    return b

@app.put(
    "/api/prescriptions/{presc_id}",
    response_model=schemas.Prescription,
    summary="Mettre à jour une Prescription"
)
def update_prescription(
    presc_id: int,
    presc_up: schemas.PrescriptionCreate = Body(...),
    db: Session = Depends(get_db),
):
    db_p = db.get(models.Prescription, presc_id)
    if not db_p:
        raise HTTPException(404, "Prescription non trouvée")
    for field, val in presc_up.dict(exclude_unset=True).items():
        setattr(db_p, field, val)
    db_p.is_verified = True
    db.commit(); db.refresh(db_p)
    return db_p

@app.get(
    "/api/prescriptions/{presc_id}",
    response_model=schemas.Prescription,
    summary="Récupérer une Prescription par ID"
)
def read_prescription(
    presc_id: int,
    db: Session = Depends(get_db)
):
    p = db.get(models.Prescription, presc_id)
    if not p:
        raise HTTPException(status_code=404, detail="Prescription non trouvée")
    return p

@app.post(
    "/api/courrier/upload",
    response_model=schemas.Courier,
    summary="Créer un Courier et y attacher 1+ fichiers, en extrayant et sauvegardant immédiatement"
)
async def upload_courrier(
    mat_fiscale: str              = Form(...),
    nom_complet_adherent: str     = Form(...),
    nom_complet_beneficiaire: str = Form(...),
    files: List[UploadFile]       = File(...),
    db:     Session               = Depends(get_db)
):
    """
    1) Crée le courier (matricule, nom adherent, nom beneficiaire).
    2) Pour chaque fichier envoyé :
       a) Lit les bytes, écrit le fichier sur disque.
       b) Classifie (prescription vs bulletin) via Azure.
       c) Parse le document (appel async à Azure + traitements).
       d) Crée la ligne Prescription ou Bulletin en base et
          met à jour le FileUpload associé.
    3) Renvoie le Courier (avec tous ses FileUpload + FK remplis).
    """
    # ── 1) Créer le Courier de base ──────────────────────────────
    db_courier = models.Courier(
        mat_fiscale              = mat_fiscale,
        nom_complet_adherent     = nom_complet_adherent,
        nom_complet_beneficiaire = nom_complet_beneficiaire,
        created_at               = datetime.utcnow()
    )
    db.add(db_courier)
    db.commit()
    db.refresh(db_courier)

    # ── 2) Pour chaque fichier uploadé ───────────────────────────
    for upload in files:
        # ---- 2a) Lire bytes + stocker sur disque -----------------
        raw_bytes = await upload.read()
        if not raw_bytes or not upload.filename:
            # Si pas de contenu, on l’ignore ou on lève une erreur
            raise HTTPException(status_code=400, detail=f"Fichier invalide : {upload.filename}")

        # Générer un nom unique pour le fichier sur disque
        ts      = datetime.utcnow().isoformat()
        safe_ts = re.sub(r"[:.]", "-", ts)
        stored  = f"{safe_ts}_{upload.filename}"
        full_path = os.path.join(UPLOAD_DIR, stored)

        # Écrire le fichier brut sur disque
        with open(full_path, "wb") as out_f:
            out_f.write(raw_bytes)

        size_bytes = os.path.getsize(full_path)
        
        # Créer d’abord un FileUpload temporaire (type="unknown") pour avoir l’ID
        db_file = models.FileUpload(
            filename      = stored,
            original_name = upload.filename,
            path          = full_path,
            size_in_bytes = size_bytes,
            type          = "unknown",   # nous mettrons à jour après classification
            courier_id    = db_courier.id
        )
        db.add(db_file)
        db.commit()
        db.refresh(db_file)

        # ---- 2b) Classification Azure (prescription vs bulletin) ---
        try:
            form_key = await classify_form_on_bytes(raw_bytes, upload.filename)
        except Exception as e:
            # Si classification échoue, on marque l’erreur et continue
            db_file.type = "error"
            db.add(db_file)
            db.commit()
            # (optionnel : lister une erreur dans la réponse finale, ou lever ici)
            raise HTTPException(
                status_code=400,
                detail=f"Impossible de classifier {upload.filename} : {str(e)}"
            )

        # Azure renvoie parfois "bulletin" ou "bulletin_de_soin", on normalise
        if form_key.lower().startswith("bulletin"):
            form_key = "bulletin_de_soin"
        elif form_key.lower().startswith("prescription"):
            form_key = "prescription"
        else:
            # classification inconnue
            db_file.type = "invalid"
            db.add(db_file)
            db.commit()
            raise HTTPException(
                status_code=400,
                detail=f"Type de document non reconnu pour {upload.filename}: {form_key}"
            )

        # ---- 2c) Parsing avec Azure (appel async + extraction) ------
        parsed: dict
        try:
            if form_key == "prescription":
                parsed = await parse_prescription_ocr(raw_bytes, upload.filename)
            else:  # "bulletin_de_soin"
                parsed = await parse_bulletin_ocr(raw_bytes, upload.filename)
        except Exception as e:
            # L’API Azure a échoué ou timeout :
            db_file.type = "error"
            db.add(db_file)
            db.commit()
            raise HTTPException(
                status_code=500,
                detail=f"Échec du parsing {upload.filename}: {str(e)}"
            )

        # ---- 2d) Enregistrer Prescription ou Bulletin en base -------
        # parsed est un dict contenant un champ "header": {"documentType": "..."} plus tous les champs extraits.
        header = parsed.get("header", {})
        doc_type = header.get("documentType")

        # On retire "header" du dict pour ne pas surcharger le modèle SQLAlchemy
        body_data = { k:v for k,v in parsed.items() if k != "header" }

        if doc_type == "prescription":
            cnam_val = body_data.pop("ref_cnam", None)
            if cnam_val:
                body_data["pharmacistCnamRef"] = cnam_val
            # Créer une Prescription
            try:
                db_presc = models.Prescription(**body_data)
                db.add(db_presc)
                db.commit()
                db.refresh(db_presc)

                # Mettre à jour le FileUpload pour lier la Prescription
                db_file.type = "prescription"
                db_file.prescription_id = db_presc.id
                db.add(db_file)
                db.commit()
            except Exception as e:
                # Si insertion échoue, on marque error
                db_file.type = "error"
                db.add(db_file)
                db.commit()
                raise HTTPException(
                    status_code=500,
                    detail=f"Impossible de sauver la prescription en base : {str(e)}"
                )

        elif doc_type == "bulletin_de_soin":
            # Créer un Bulletin
            try:
                db_bull = models.Bulletin(**body_data)
                db.add(db_bull)
                db.commit()
                db.refresh(db_bull)

                # Mettre à jour le FileUpload pour lier le Bulletin
                db_file.type = "bulletin"
                db_file.bulletin_id = db_bull.id
                db.add(db_file)
                db.commit()
            except Exception as e:
                db_file.type = "error"
                db.add(db_file)
                db.commit()
                raise HTTPException(
                    status_code=500,
                    detail=f"Impossible de sauver le bulletin en base : {str(e)}"
                )

        else:
            # En principe on ne devrait jamais arriver ici
            db_file.type = "invalid"
            db.add(db_file)
            db.commit()
            raise HTTPException(
                status_code=400,
                detail=f"Type inattendu pour le parsing : {doc_type}"
            )

    # ── 3) Recharger le Courier AVEC ses associations (files, prescriptions, bulletins) ──
    courier_with_files = (
        db.query(models.Courier)
          .options(joinedload(models.Courier.files))
          .filter(models.Courier.id == db_courier.id)
          .first()
    )

    return courier_with_files

@app.post(
    "/api/courrier/{courier_id}/files",
    response_model=schemas.Courier,
    summary="Attach files to an existing Courier, classify+parse, and save to DB"
)
async def add_and_parse_files_to_courrier(
    courier_id: int,
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
):
    """
    1) Look up the existing Courier by courier_id
    2) For each uploaded file:
       a) Read bytes → save to disk
       b) Create FileUpload(type='unknown') so we get an ID
       c) Call Azure to classify (prescription vs bulletin).
       d) Call Azure to parse; create a Prescription or Bulletin row.
       e) Update FileUpload.type and prescription_id or bulletin_id.
    3) Return the updated Courier (with its files). 
    """
    db_courier = db.query(models.Courier).get(courier_id)
    if not db_courier:
        raise HTTPException(status_code=404, detail=f"Courier {courier_id} not found")

    for upload in files:
        raw_bytes = await upload.read()
        if not raw_bytes or not upload.filename:
            raise HTTPException(status_code=400, detail=f"Invalid file: {upload.filename}")

        # ── 2a) Save to disk ──────────────────────────────────
        ts = datetime.utcnow().isoformat()
        safe_ts = re.sub(r"[:.]", "-", ts)
        stored_name = f"{safe_ts}_{upload.filename}"
        full_path = os.path.join(UPLOAD_DIR, stored_name)

        with open(full_path, "wb") as out_f:
            out_f.write(raw_bytes)
            
        size_bytes = os.path.getsize(full_path)

        # ── 2b) Create a FileUpload record (type='unknown') ───
        db_file = models.FileUpload(
            filename=stored_name,
            original_name=upload.filename,
            size_in_bytes=size_bytes,
            path=full_path,
            type="unknown",
            courier_id=db_courier.id
        )
        db.add(db_file)
        db.commit()
        db.refresh(db_file)

        # ── 2c) Classification Azure ---------------------------
        try:
            form_key = await classify_form_on_bytes(raw_bytes, upload.filename)
        except Exception as e:
            # Mark as error
            db_file.type = "error"
            db.add(db_file)
            db.commit()
            raise HTTPException(
                status_code=400,
                detail=f"Cannot classify {upload.filename}: {str(e)}"
            )

        if form_key not in ("bulletin_de_soin", "prescription"):
            db_file.type = "invalid"
            db.add(db_file)
            db.commit()
            raise HTTPException(
                status_code=400,
                detail=f"Unknown document type for {upload.filename}: {form_key}"
            )

        # ── 2d) Parsing Azure + Insert into DB --------------
        try:
            if form_key == "prescription":
                parsed = await parse_prescription_ocr(raw_bytes, upload.filename)
            else:  # bulletin_de_soin
                parsed = await parse_bulletin_ocr(raw_bytes, upload.filename)
        except Exception as e:
            db_file.type = "error"
            db.add(db_file)
            db.commit()
            raise HTTPException(status_code=500,
                                detail=f"Parsing failed for {upload.filename}: {str(e)}")

        header = parsed.get("header", {})
        doc_type = header.get("documentType")
        body_data = {k: v for k, v in parsed.items() if k != "header"}

        if doc_type == "prescription":
            cnam_val = body_data.pop("ref_cnam", None)
            if cnam_val:
                body_data["pharmacistCnamRef"] = cnam_val

            try:
                db_presc = models.Prescription(**body_data)
                db.add(db_presc)
                db.commit()
                db.refresh(db_presc)

                db_file.type = "prescription"
                db_file.prescription_id = db_presc.id
                db.add(db_file)
                db.commit()
            except Exception as e:
                db_file.type = "error"
                db.add(db_file)
                db.commit()
                raise HTTPException(status_code=500,
                                    detail=f"Cannot save prescription: {str(e)}")

        elif doc_type == "bulletin_de_soin":
            try:
                db_bull = models.Bulletin(**body_data)
                db.add(db_bull)
                db.commit()
                db.refresh(db_bull)

                db_file.type = "bulletin"
                db_file.bulletin_id = db_bull.id
                db.add(db_file)
                db.commit()
            except Exception as e:
                db_file.type = "error"
                db.add(db_file)
                db.commit()
                raise HTTPException(status_code=500,
                                    detail=f"Cannot save bulletin: {str(e)}")
        else:
            # Should never happen, but just in case
            db_file.type = "invalid"
            db.add(db_file)
            db.commit()
            raise HTTPException(status_code=400,
                                detail=f"Unexpected parsed documentType: {doc_type}")

    # ── 3) Return the Courier with all associated files ────
    updated = (
        db.query(models.Courier)
          .options(joinedload(models.Courier.files))
          .filter(models.Courier.id == courier_id)
          .first()
    )
    return updated

@app.get("/api/users", response_model=List[schemas.UserRead])
def list_users(db: Session = Depends(get_db)):
    return db.query(models.User).all()

@app.post("/api/users", response_model=schemas.UserRead)
def create_user(user: schemas.UserCreate, db: Session = Depends(get_db)):
    db_user = db.query(models.User).filter_by(email=user.email).first()
    if db_user:
        raise HTTPException(400, "Email already registered")
    hashed = get_password_hash(user.password)
    new = models.User(
        username=user.username,
        email=user.email,
        hashed_password=hashed,
        is_active=user.is_active,
        is_superuser=user.is_superuser,
    )
    db.add(new)
    db.commit()
    db.refresh(new)
    return new

@app.patch("/api/users/{user_id}", response_model=schemas.UserRead)
def patch_user(
    user_id: int,
    user_up: schemas.UserUpdate = Body(
      ...,
      examples={
        "partial": {
          "summary": "Only email and is_active",
          "value": {"email": "new@example.com", "is_active": False}
        }
      }
    ),
    db: Session = Depends(get_db)    # inject the DB session
):
    # Fetch the existing user
    user = db.get(models.User, user_id)
    if not user:
        raise HTTPException(404, "User not found")

    # Apply only the fields that were sent
    update_data = user_up.dict(exclude_unset=True)
    if "password" in update_data:
        user.hashed_password = get_password_hash(update_data.pop("password"))
        
    for field, value in update_data.items():
        setattr(user, field, value)

    # Persist and return
    db.commit()
    db.refresh(user)
    return user

@app.put("/api/users/{user_id}", response_model=schemas.UserRead)
def update_user(user_id: int, user_up: schemas.UserUpdate,
                db: Session = Depends(get_db),
                admin: models.User = Depends(get_current_superuser)):
    user = db.get(models.User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    if user_up.email is not None:
        user.email = user_up.email
    if user_up.password is not None:
        user.hashed_password = get_password_hash(user_up.password)
    if user_up.is_active is not None:
        user.is_active = user_up.is_active
    if user_up.is_superuser is not None:
        user.is_superuser = user_up.is_superuser
    db.commit(); db.refresh(user)
    return user

@app.delete("/api/users/{user_id}", status_code=204)
def delete_user(user_id: int,
                db: Session = Depends(get_db),
                admin: models.User = Depends(get_current_superuser)):
    user = db.get(models.User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    db.delete(user); db.commit()
        
def is_mostly_empty(parsed: dict, threshold: float = 0.9) -> bool:
    
    keys = [k for k in parsed.keys() if k != "header"]
    if not keys:
        return True
    empty_count = 0
    for k in keys:
        v = parsed[k]
        if v is None or v == "" or v == [] or v == {}:
            empty_count += 1
    return (empty_count / len(keys)) >= threshold

@app.post("/login", response_model=schemas.Token)
def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db:        Session = Depends(get_db)
):
    user = authenticate_user(db, form_data.username, form_data.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = create_access_token({
        "sub":          user.email,
        "is_superuser": user.is_superuser
    })
    return {"access_token": token, "token_type": "bearer"}

@app.post("/api/prescriptions/{id}/verify-signature")
def verify_signature_endpoint(id: int, db: Session = Depends(get_db)):
    presc = db.query(models.Prescription).get(id)
    if not presc or not presc.signatureCropFile:
        raise HTTPException(404, "No signature found for that prescription")

    here        = Path(__file__).resolve().parent
    sigs_folder = here / "genuine_signatures"
    if not sigs_folder.exists() or not sigs_folder.is_dir():
        raise HTTPException(500, f"Signature folder not found at '{sigs_folder}'")

    # Load the signature crop in grayscale
    test_crop = cv2.imread(str(presc.signatureCropFile), cv2.IMREAD_GRAYSCALE)
    if test_crop is None:
        raise HTTPException(500, f"Cannot load signature crop at '{presc.signatureCropFile}'")

    try:
        raw_result = verify_signature(
            test_crop    = test_crop,
            genuine_path = str(sigs_folder)
        )
        # raw_result is probably a dict with numpy types, e.g. numpy.bool_, numpy.float64, etc.
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))

    # Convert any NumPy types to native Python:
    # (adjust keys based on what your pipeline actually returns)
    clean_result = {
        "akaze":    float(raw_result["akaze"]),
        "ssim":     float(raw_result["ssim"]),
        "genuine":  bool(raw_result["genuine"])
    }

    return clean_result

@app.post("/api/documents/parse")
async def parse_document(file: UploadFile = File(...)):
    data = await file.read()

    form_key = await classify_form_on_bytes(data, file.filename)
    if form_key == "bulletin":
        form_key = "bulletin_de_soin"

    if form_key == "prescription":
        parsed = await parse_prescription_ocr(data, file.filename)
    else:
        parsed = await parse_bulletin_ocr(data, file.filename)

    return {
        "document_type": form_key,
        "filename":      file.filename,
        "parsed":        parsed,
    }
    
@app.get("/api/bulletin/uploaded/latest")
async def get_latest_bulletin(db: Session = Depends(get_db)):
    try:
        latest_bulletin = (
            db.query(models.FileUpload)
            .filter(models.FileUpload.type == "bulletin")
            .order_by(desc(models.FileUpload.uploaded_at))
            .first()
        )
        
        if latest_bulletin:
            return {
                "id": latest_bulletin.id,
                "filename": latest_bulletin.filename,
                "original_name": latest_bulletin.original_name,
                "uploaded_at": latest_bulletin.uploaded_at,
                "exists": True,
                "type": latest_bulletin.type,
                "bulletin_id": latest_bulletin.bulletin_id
            }
        else:
            return {"exists": False, "message": "No bulletin found."}
    
    except Exception as e:
        print("Error in get_latest_bulletin:", e)
        traceback.print_exc()
        return {"exists": False, "message": "An error occurred."}
    
@app.get("/api/ordonnance/uploaded/latest")
async def get_latest_ordonnance(db: Session = Depends(get_db)):
    try:
        latest_ordonnance = (
            db.query(models.FileUpload)
            .filter(models.FileUpload.type == "ordonnance")
            .order_by(desc(models.FileUpload.uploaded_at))
            .first()
        )
        
        if latest_ordonnance:
            return {
                "id": latest_ordonnance.id,
                "filename": latest_ordonnance.filename,
                "original_name": latest_ordonnance.original_name,
                "uploaded_at": latest_ordonnance.uploaded_at,
                "exists": True,
                "type": latest_ordonnance.type,
                "prescription_id": latest_ordonnance.prescription_id
            }
        else:
            return {"exists": False, "message": "No ordonnance found."}
    
    except Exception as e:
        print("Error in get_latest_ordonnance:", e)
        traceback.print_exc()
        return {"exists": False, "message": "An error occurred."}

@app.post("/bulletin/upload", response_model=schemas.UploadResponse)
async def upload_bulletins(files: List[UploadFile] = File(...), db: Session = Depends(get_db)):
    uploaded = []
    for file in files:
        try:
            ts = datetime.utcnow().isoformat()
            safe = re.sub(r"[:.]", "-", ts)
            name = f"{safe}_{file.filename}"
            path = os.path.join(UPLOAD_DIR, name)
            with open(path, "wb") as buf:
                shutil.copyfileobj(file.file, buf)
            dbf = models.FileUpload(
                filename=name,
                original_name=file.filename,
                path=path,
                uploaded_at=datetime.utcnow()
            )
            db.add(dbf)
            db.commit()
            db.refresh(dbf)
            uploaded.append({"id": dbf.id, "filename": name, "original_name": file.filename})
        except:
            continue
    return {"message": f"{len(uploaded)} bulletin(s) uploaded", "uploaded_files": uploaded}

@app.get("/api/bulletin/uploaded/all")
async def get_all_bulletins(db: Session = Depends(get_db)):
    files = db.query(models.FileUpload).order_by(desc(models.FileUpload.uploaded_at)).all()
    bulletins = [
        {
            "id": f.id,
            "filename": f.filename,
            "original_name": f.original_name,
            "uploaded_at": f.uploaded_at,
            "type": f.type
        }
        for f in files if f.type == "bulletin"
    ]
    return bulletins

@app.get("/api/ordonnance/uploaded/all")
async def get_all_ordonnances(db: Session = Depends(get_db)):
    files = db.query(models.FileUpload).order_by(desc(models.FileUpload.uploaded_at)).all()
    ordonnances = [
        {
            "id": f.id,
            "filename": f.filename,
            "original_name": f.original_name,
            "uploaded_at": f.uploaded_at,
            "type": f.type
        }
        for f in files if f.type == "prescription"
    ]
    return ordonnances

@app.get("/api/courrier/uploaded/all", response_model=List[schemas.Courier])
async def get_all_courriers(db: Session = Depends(get_db)):

    courriers = (
        db.query(models.Courier)
          .options(joinedload(models.Courier.files))
          .all()
    )
    return courriers

@app.get("/api/courrier/uploaded/latest", response_model=schemas.Courier)
async def get_latest_courrier(db: Session = Depends(get_db)):
    """
    Return the single most recently created Courier, with its files.
    """
    try:
        latest = (
            db.query(models.Courier)
              .options(joinedload(models.Courier.files))
              .order_by(models.Courier.created_at.desc())
              .first()
        )
        if not latest:
            raise HTTPException(404, detail="No courier found")
        return latest
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(500, detail="Failed to fetch latest courier")
    
    
@app.get("/api/files/{file_id}")
async def get_file(file_id: int, db: Session = Depends(get_db)):
    """
    Serve a file by its ID. Returns the actual file content.
    """
    try:
        # Get the file record from database
        db_file = db.query(models.FileUpload).filter(models.FileUpload.id == file_id).first()
        
        if not db_file:
            raise HTTPException(status_code=404, detail="File not found")
        
        # Check if the file exists on disk
        if not os.path.exists(db_file.path):
            raise HTTPException(status_code=404, detail="File not found on disk")
        
        # Determine the media type based on file extension
        file_extension = os.path.splitext(db_file.original_name)[1].lower()
        media_type = "application/pdf"  # Default to PDF
        
        if file_extension == ".pdf":
            media_type = "application/pdf"
        elif file_extension in [".jpg", ".jpeg"]:
            media_type = "image/jpeg"
        elif file_extension == ".png":
            media_type = "image/png"
        
        # Return the file
        return FileResponse(
            path=db_file.path,
            media_type=media_type,
            filename=db_file.original_name,
            headers={"Content-Disposition": f"inline; filename=\"{db_file.original_name}\""}
        )
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error serving file: {str(e)}")
        raise HTTPException(status_code=500, detail="Error serving file")
    
@app.delete("/api/files/{file_id}", status_code=204)
async def delete_file(file_id: int, db: Session = Depends(get_db)):
    db_file = db.query(models.FileUpload).get(file_id)
    if not db_file:
        raise HTTPException(status_code=404, detail="File not found")
    # Delete from disk if you want:
    if os.path.exists(db_file.path):
        try:
            os.remove(db_file.path)
        except OSError:
            pass
    db.delete(db_file)
    db.commit()
    return Response(status_code=204)

@app.get("/health")
def health_check():
    return {"status": "healthy"}

    models.Base.metadata.drop_all(bind=engine)
    models.Base.metadata.create_all(bind=engine)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
