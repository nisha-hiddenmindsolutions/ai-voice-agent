import asyncio
import uuid
# pyrefly: ignore [missing-import]
from app.db.session import AsyncSessionLocal
# pyrefly: ignore [missing-import]
from app.models.orm import UserORM
# pyrefly: ignore [missing-import]
from app.core.security import get_password_hash
from sqlalchemy import select

async def create_operator():
    email = "operator@gmail.com"
    password = "123456"
    full_name = "System Operator"
    
    print(f"🚀 [FORGE] Initializing Node Identity: {email}")
    
    async with AsyncSessionLocal() as db:
        # Check if user exists
        result = await db.execute(select(UserORM).where(UserORM.email == email))
        existing_user = result.scalar_one_or_none()
        
        if existing_user:
            print(f"⚠️ [FORGE] Identity already exists in Registry. Updating Protocol...")
            existing_user.hashed_password = get_password_hash(password)
            existing_user.full_name = full_name
        else:
            new_user = UserORM(
                id=str(uuid.uuid4()),
                email=email,
                hashed_password=get_password_hash(password),
                full_name=full_name,
                is_active=True
            )
            db.add(new_user)
            print(f"✅ [FORGE] Neural Handshake Success: Identity Registered.")
            
        await db.commit()
        print(f"🔒 [FORGE] Security protocols active. Password hashed with Bcrypt.")

if __name__ == "__main__":
    asyncio.run(create_operator())
