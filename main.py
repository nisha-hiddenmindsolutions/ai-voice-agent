import uvicorn
import os
import sys
from pathlib import Path

# Add the current directory to sys.path so we can import modules
sys.path.append(str(Path(__file__).parent))
sys.path.append(str(Path(__file__).parent / "backend"))

if __name__ == "__main__":
    print("\n" + "="*50)
    print("🚀 VOICE AI SAAS — UNIFIED STARTUP")
    print("="*50)
    
    # Check for .env
    if not os.path.exists(".env"):
        print("⚠️  Warning: .env not found in project root!")

    # Start the FastAPI Application
    # Note: backend.app.main:app includes the lifecycle to start the Agent Worker automatically
    uvicorn.run("backend.app.main:app", host="0.0.0.0", port=8000, reload=True)