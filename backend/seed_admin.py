# backend/seed_admin.py

import os
import sys
from getpass import getpass
from passlib.context import CryptContext
from sqlalchemy.orm import Session

# Make sure project root (one level up) is on sys.path
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, root)

# Now import using the package name
from backend.database import SessionLocal, engine, Base
from backend.models import User

pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")

def get_password_hash(password: str) -> str:
    return pwd_ctx.hash(password)

def add_or_update_admin(username: str, email: str, password: str):
    print("→ Creating tables (if needed)…")
    Base.metadata.create_all(bind=engine)

    db: Session = SessionLocal()
    try:
        user = db.query(User).filter_by(username=username).first()
        if user:
            print(f"→ Found existing user {email}, updating to superuser.")
            user.hashed_password = get_password_hash(password)
            user.is_superuser = True
        else:
            print(f"→ Creating new superuser {username} <{email}.")
            user = User(
                username=username,
                email=email,
                hashed_password=get_password_hash(password),
                is_superuser=True
            )
            db.add(user)
        db.commit()
        print("✅ Done.")
    finally:
        db.close()

if __name__ == "__main__":
    print("=== seed_admin starting ===")
    username = input("Enter admin username: ").strip()
    email = input("Enter admin email: ").strip()
    password = getpass("Enter admin password: ").strip()
    add_or_update_admin(username, email, password)
    print("=== seed_admin finished ===")
