import logging
import aiohttp
from typing import Any, Annotated, Optional, List
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
# pyrefly: ignore [missing-import]
from app.api.deps import get_db, get_current_user
# pyrefly: ignore [missing-import]
from app.core.security import vault
# pyrefly: ignore [missing-import]
from app.models.orm import UserORM, ProviderConnectionORM, ProviderModelORM

router = APIRouter()
logger = logging.getLogger("api-providers")

class ProviderConnectionCreate(BaseModel):
    provider: str
    api_key: str

class ProviderModelResponse(BaseModel):
    id: str
    model_id: str
    name: str
    context_window: int
    capabilities: dict

class ProviderConnectionResponse(BaseModel):
    id: str
    provider: str
    status: str
    created_at: Any
    models_count: int
    models: List[ProviderModelResponse]

async def fetch_provider_models_api(provider: str, api_key: str) -> List[dict]:
    """
    Dynamically calls provider APIs to fetch available models.
    """
    models = []
    
    # 1. OPENAI
    if provider == "openai":
        try:
            headers = {"Authorization": f"Bearer {api_key}"}
            async with aiohttp.ClientSession() as session:
                async with session.get("https://api.openai.com/v1/models", headers=headers, timeout=5) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        for m in data.get("data", []):
                            mid = m.get("id")
                            # Filter chat models
                            if mid.startswith("gpt-") or mid.startswith("o1-") or mid.startswith("chatgpt-"):
                                models.append({
                                    "model_id": mid,
                                    "name": mid.replace("-", " ").title(),
                                    "context_window": 128000 if "gpt-4" in mid or "o1" in mid else 16384,
                                    "capabilities": {"supports_vision": "vision" in mid or "o1" in mid, "supports_tools": True}
                                })
        except Exception as e:
            logger.warning(f"Error fetching OpenAI models: {e}")
            
    # 2. OPENROUTER
    elif provider == "openrouter":
        try:
            headers = {"Authorization": f"Bearer {api_key}"}
            async with aiohttp.ClientSession() as session:
                async with session.get("https://openrouter.ai/api/v1/models", headers=headers, timeout=8) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        for m in data.get("data", []):
                            mid = m.get("id")
                            models.append({
                                "model_id": mid,
                                "name": m.get("name", mid),
                                "context_window": int(m.get("context_length", 0) or 4096),
                                "capabilities": {
                                    "supports_vision": "vision" in m.get("description", "").lower() or "multimodal" in m.get("description", "").lower(),
                                    "supports_tools": True
                                }
                            })
        except Exception as e:
            logger.warning(f"Error fetching OpenRouter models: {e}")

    # 3. GROQ
    elif provider == "groq":
        try:
            headers = {"Authorization": f"Bearer {api_key}"}
            async with aiohttp.ClientSession() as session:
                async with session.get("https://api.groq.com/openai/v1/models", headers=headers, timeout=5) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        for m in data.get("data", []):
                            mid = m.get("id")
                            # Groq's /models endpoint returns BOTH chat models
                            # (llama-3.x, mixtral, ...) and its hosted Whisper
                            # STT models (whisper-large-v3, distil-whisper-*)
                            # in one flat list. Previously every entry was
                            # tagged as a plain LLM model, so the frontend had
                            # no way to tell them apart and Groq never showed
                            # up as a real, model-aware STT option — it just
                            # fell back to whatever was hardcoded.
                            if "whisper" in mid.lower():
                                models.append({
                                    "model_id": mid,
                                    "name": mid.replace("-", " ").title(),
                                    "context_window": 0,
                                    "capabilities": {"type": "stt"}
                                })
                            else:
                                models.append({
                                    "model_id": mid,
                                    "name": mid.replace("-", " ").title(),
                                    "context_window": 128000 if "70b" in mid or "llama-3.3" in mid else 8192,
                                    "capabilities": {"supports_vision": "vision" in mid, "supports_tools": True}
                                })
        except Exception as e:
            logger.warning(f"Error fetching Groq models: {e}")

    # 4. DEEPSEEK
    elif provider == "deepseek":
        try:
            headers = {"Authorization": f"Bearer {api_key}"}
            async with aiohttp.ClientSession() as session:
                async with session.get("https://api.deepseek.com/models", headers=headers, timeout=5) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        for m in data.get("data", []):
                            mid = m.get("id")
                            models.append({
                                "model_id": mid,
                                "name": mid.replace("-", " ").title(),
                                "context_window": 64000,
                                "capabilities": {"supports_vision": False, "supports_tools": True}
                            })
        except Exception as e:
            logger.warning(f"Error fetching DeepSeek models: {e}")

    # 5. TOGETHER AI
    elif provider == "together_ai":
        try:
            headers = {"Authorization": f"Bearer {api_key}"}
            async with aiohttp.ClientSession() as session:
                async with session.get("https://api.together.xyz/v1/models", headers=headers, timeout=5) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        for m in data:
                            if isinstance(m, dict):
                                mid = m.get("id")
                                if mid:
                                    models.append({
                                        "model_id": mid,
                                        "name": m.get("display_name", mid),
                                        "context_window": int(m.get("context_length", 4096) or 4096),
                                        "capabilities": {"supports_vision": "vision" in mid, "supports_tools": True}
                                    })
        except Exception as e:
            logger.warning(f"Error fetching Together AI models: {e}")

    # 5.5 GEMINI
    elif provider == "gemini":
        try:
            async with aiohttp.ClientSession() as session:
                url = f"https://generativelanguage.googleapis.com/v1beta/models?key={api_key}"
                async with session.get(url, timeout=5) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        for m in data.get("models", []):
                            mname = m.get("name", "")
                            model_id = mname.replace("models/", "")
                            if "gemini" in model_id:
                                models.append({
                                    "model_id": model_id,
                                    "name": m.get("displayName", model_id),
                                    "context_window": m.get("inputTokenLimit", 1048576),
                                    "capabilities": {"supports_vision": "vision" in model_id or "flash" in model_id or "pro" in model_id, "supports_tools": True}
                                })
        except Exception as e:
            logger.warning(f"Error fetching Gemini models: {e}")

    # 5.6 ANTHROPIC
    # FIX: this provider previously had NO live branch at all — it only
    # ever returned the hand-maintained "Rich Static Fallbacks" entries
    # below, so a connected Anthropic key never actually reflected which
    # Claude models the account could see. Anthropic exposes a real
    # GET /v1/models endpoint; use it like every other LLM provider here.
    elif provider == "anthropic":
        try:
            headers = {
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
            }
            async with aiohttp.ClientSession() as session:
                async with session.get("https://api.anthropic.com/v1/models", headers=headers, timeout=5) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        for m in data.get("data", []):
                            mid = m.get("id")
                            models.append({
                                "model_id": mid,
                                "name": m.get("display_name", mid),
                                "context_window": 200000,
                                "capabilities": {"supports_vision": True, "supports_tools": True}
                            })
        except Exception as e:
            logger.warning(f"Error fetching Anthropic models: {e}")

    # 6. ELEVENLABS
    elif provider == "elevenlabs":
        try:
            headers = {"xi-api-key": api_key}
            async with aiohttp.ClientSession() as session:
                async with session.get("https://api.elevenlabs.io/v1/voices", headers=headers, timeout=5) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        for v in data.get("voices", []):
                            models.append({
                                "model_id": v.get("voice_id"),
                                "name": v.get("name"),
                                "context_window": 0,
                                "capabilities": {"type": "voice", "gender": v.get("labels", {}).get("gender", "unknown")}
                            })
        except Exception as e:
            logger.warning(f"Error fetching ElevenLabs voices: {e}")

    # 7. CARTESIA
    elif provider == "cartesia":
        try:
            headers = {"X-API-Key": api_key, "Cartesia-Version": "2024-06-10"}
            async with aiohttp.ClientSession() as session:
                async with session.get("https://api.cartesia.ai/voices", headers=headers, timeout=5) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        for v in data:
                            models.append({
                                "model_id": v.get("id"),
                                "name": v.get("name"),
                                "context_window": 0,
                                "capabilities": {"type": "voice", "gender": v.get("gender", "unknown")}
                            })
        except Exception as e:
            logger.warning(f"Error fetching Cartesia voices: {e}")

        # Cartesia's /voices endpoint only returns TTS voice identities
        # (used for the `voice` field), not the model catalogue itself.
        # Without these, the STT/TTS *Model* dropdowns had nothing to
        # populate for Cartesia and the UI silently fell back to a
        # hardcoded default the user could never actually change.
        models.append({"model_id": "ink-whisper", "name": "Ink Whisper (Multilingual STT)", "context_window": 0, "capabilities": {"type": "stt"}})
        models.append({"model_id": "sonic-2", "name": "Sonic 2 (Multilingual TTS)", "context_window": 0, "capabilities": {"type": "tts"}})
        models.append({"model_id": "sonic-english", "name": "Sonic English (TTS)", "context_window": 0, "capabilities": {"type": "tts"}})

    # 8. SARVAM
    elif provider == "sarvam":
        if api_key and len(api_key.strip()) > 5:
            models = [
                {"model_id": "saaras:v3", "name": "saaras:v3 (Indic Speech-to-Text)", "context_window": 0, "capabilities": {"type": "stt"}},
                {"model_id": "bulbul:v3", "name": "bulbul:v3 (Indic Text-to-Speech)", "context_window": 0, "capabilities": {"type": "tts"}}
            ]

    # 9. DEEPGRAM
    elif provider == "deepgram":
        try:
            headers = {"Authorization": f"Token {api_key}"}
            async with aiohttp.ClientSession() as session:
                async with session.get("https://api.deepgram.com/v1/projects", headers=headers, timeout=5) as resp:
                    if resp.status == 200:
                        models = [
                            {"model_id": "nova-2", "name": "Nova-2 (Speech-to-Text)", "context_window": 0, "capabilities": {"type": "stt"}},
                            {"model_id": "aura", "name": "Aura (Text-to-Speech)", "context_window": 0, "capabilities": {"type": "tts"}}
                        ]
        except Exception as e:
            logger.warning(f"Error checking Deepgram: {e}")

    # Rich Static Fallbacks / Constants
    if not models:
        if provider == "openai":
            models = [
                {"model_id": "gpt-4o", "name": "GPT-4o (Flagship)", "context_window": 128000, "capabilities": {"supports_vision": True}},
                {"model_id": "gpt-4o-mini", "name": "GPT-4o Mini", "context_window": 128000, "capabilities": {"supports_vision": True}},
                {"model_id": "o1-mini", "name": "O1 Mini", "context_window": 128000, "capabilities": {"supports_vision": False}}
            ]
        elif provider == "groq":
            models = [
                {"model_id": "llama-3.3-70b-versatile", "name": "Llama 3.3 (70B)", "context_window": 128000, "capabilities": {"supports_vision": False}},
                {"model_id": "llama-3.1-8b-instant", "name": "Llama 3.1 (8B)", "context_window": 8192, "capabilities": {"supports_vision": False}}
            ]
        elif provider == "gemini":
            models = [
                {"model_id": "gemini-2.5-flash", "name": "Gemini 2.5 Flash", "context_window": 1048576, "capabilities": {"supports_vision": True}},
                {"model_id": "gemini-2.5-pro", "name": "Gemini 2.5 Pro", "context_window": 2097152, "capabilities": {"supports_vision": True}},
                {"model_id": "gemini-1.5-flash", "name": "Gemini 1.5 Flash", "context_window": 1048576, "capabilities": {"supports_vision": True}},
                {"model_id": "gemini-1.5-pro", "name": "Gemini 1.5 Pro", "context_window": 2097152, "capabilities": {"supports_vision": True}},
                {"model_id": "gemini-1.0-pro", "name": "Gemini 1.0 Pro", "context_window": 32768, "capabilities": {"supports_vision": False}}
            ]
        elif provider == "anthropic":
            models = [
                {"model_id": "claude-3-5-sonnet-latest", "name": "Claude 3.5 Sonnet", "context_window": 200000, "capabilities": {"supports_vision": True}},
                {"model_id": "claude-3-5-haiku-latest", "name": "Claude 3.5 Haiku", "context_window": 200000, "capabilities": {"supports_vision": False}}
            ]
        elif provider == "deepseek":
            models = [
                {"model_id": "deepseek-chat", "name": "DeepSeek Chat (V3)", "context_window": 64000, "capabilities": {"supports_vision": False}}
            ]
        elif provider == "assemblyai":
            models = [
                {"model_id": "assemblyai-stt", "name": "AssemblyAI Speech-to-Text", "context_window": 0, "capabilities": {"type": "stt"}}
            ]
        elif provider == "sarvam":
            models = [
                {"model_id": "saaras:v3", "name": "saaras:v3 (Indic Speech-to-Text)", "context_window": 0, "capabilities": {"type": "stt"}},
                {"model_id": "bulbul:v3", "name": "bulbul:v3 (Indic Text-to-Speech)", "context_window": 0, "capabilities": {"type": "tts"}}
            ]
        elif provider == "deepgram":
            models = [
                {"model_id": "nova-2", "name": "Nova-2 (Speech-to-Text)", "context_window": 0, "capabilities": {"type": "stt"}},
                {"model_id": "aura", "name": "Aura (Text-to-Speech)", "context_window": 0, "capabilities": {"type": "tts"}}
            ]
            
    return models

@router.get("/", response_model=List[ProviderConnectionResponse])
async def list_providers(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[UserORM, Depends(get_current_user)]
):
    """
    List connected providers and dynamic models.
    """
    stmt = select(ProviderConnectionORM).where(ProviderConnectionORM.user_id == current_user.id)
    res = await db.execute(stmt)
    connections = res.scalars().all()
    
    response = []
    for conn in connections:
        # Load related models
        m_stmt = select(ProviderModelORM).where(ProviderModelORM.provider_connection_id == conn.id)
        m_res = await db.execute(m_stmt)
        models = m_res.scalars().all()
        
        response.append(ProviderConnectionResponse(
            id=conn.id,
            provider=conn.provider,
            status=conn.status,
            created_at=conn.created_at,
            models_count=len(models),
            models=[ProviderModelResponse(
                id=m.id,
                model_id=m.model_id,
                name=m.name,
                context_window=m.context_window,
                capabilities=m.capabilities or {}
            ) for m in models]
        ))
        
    return response

@router.post("/", response_model=dict)
async def connect_provider(
    payload: ProviderConnectionCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[UserORM, Depends(get_current_user)]
):
    """
    Establish a connection with an AI provider, test credentials, and dynamically ingest models.
    """
    provider_name = payload.provider.lower()
    api_key_plain = payload.api_key.strip()
    
    # Simple check: Verify connection validity by attempting to fetch models
    test_models = await fetch_provider_models_api(provider_name, api_key_plain)
    if not test_models:
        # If no models were fetched and it isn't a static fallback provider, raise error
        if provider_name in ["openai", "openrouter", "groq", "deepseek", "gemini", "together_ai", "elevenlabs", "cartesia", "sarvam", "deepgram"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Failed to verify API key for {provider_name}. Please double check your credentials."
            )
            
    # Remove existing connection for this provider to prevent duplicates
    await db.execute(
        delete(ProviderConnectionORM).where(
            ProviderConnectionORM.user_id == current_user.id,
            ProviderConnectionORM.provider == provider_name
        )
    )
    
    # Create new connection
    encrypted_key = vault.encrypt(api_key_plain)
    conn = ProviderConnectionORM(
        user_id=current_user.id,
        provider=provider_name,
        api_key=encrypted_key,
        status="connected"
    )
    db.add(conn)
    await db.flush() # Populate connection ID
    
    # Store dynamic models
    for m in test_models:
        model_orm = ProviderModelORM(
            provider_connection_id=conn.id,
            model_id=m["model_id"],
            name=m["name"],
            context_window=m.get("context_window", 0),
            capabilities=m.get("capabilities", {})
        )
        db.add(model_orm)
        
    await db.commit()
    return {
        "status": "success",
        "message": f"Successfully connected to {provider_name}!",
        "models_count": len(test_models)
    }

@router.post("/{connection_id}/test", response_model=dict)
async def test_provider_connection(
    connection_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[UserORM, Depends(get_current_user)]
):
    """
    Tests and updates the connection status.
    """
    stmt = select(ProviderConnectionORM).where(
        ProviderConnectionORM.id == connection_id,
        ProviderConnectionORM.user_id == current_user.id
    )
    res = await db.execute(stmt)
    conn = res.scalar_one_or_none()
    
    if not conn:
        raise HTTPException(status_code=404, detail="Provider connection not found")
        
    decrypted_key = vault.decrypt(conn.api_key)
    test_models = await fetch_provider_models_api(conn.provider, decrypted_key)
    
    if test_models:
        conn.status = "connected"
        await db.commit()
        return {"status": "success", "message": "Connection tested successfully"}
    else:
        conn.status = "error"
        await db.commit()
        raise HTTPException(status_code=400, detail="Connection test failed. API Key might be expired.")

@router.post("/{connection_id}/refresh", response_model=dict)
async def refresh_provider_models(
    connection_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[UserORM, Depends(get_current_user)]
):
    """
    Refetches all models from the provider and updates the database cache.
    """
    stmt = select(ProviderConnectionORM).where(
        ProviderConnectionORM.id == connection_id,
        ProviderConnectionORM.user_id == current_user.id
    )
    res = await db.execute(stmt)
    conn = res.scalar_one_or_none()
    
    if not conn:
        raise HTTPException(status_code=404, detail="Provider connection not found")
        
    decrypted_key = vault.decrypt(conn.api_key)
    test_models = await fetch_provider_models_api(conn.provider, decrypted_key)
    
    if not test_models:
        raise HTTPException(status_code=400, detail="Failed to fetch models from provider API.")
        
    # Delete old models
    await db.execute(
        delete(ProviderModelORM).where(ProviderModelORM.provider_connection_id == conn.id)
    )
    
    # Re-insert fresh models
    for m in test_models:
        model_orm = ProviderModelORM(
            provider_connection_id=conn.id,
            model_id=m["model_id"],
            name=m["name"],
            context_window=m.get("context_window", 0),
            capabilities=m.get("capabilities", {})
        )
        db.add(model_orm)
        
    conn.status = "connected"
    await db.commit()
    
    return {"status": "success", "message": f"Successfully re-synced {len(test_models)} models."}

@router.delete("/{connection_id}", response_model=dict)
async def disconnect_provider(
    connection_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[UserORM, Depends(get_current_user)]
):
    """
    Remove connection and cascade delete all models.
    """
    stmt = select(ProviderConnectionORM).where(
        ProviderConnectionORM.id == connection_id,
        ProviderConnectionORM.user_id == current_user.id
    )
    res = await db.execute(stmt)
    conn = res.scalar_one_or_none()
    
    if not conn:
        raise HTTPException(status_code=404, detail="Provider connection not found")
        
    await db.delete(conn)
    await db.commit()
    
    return {"status": "success", "message": f"Successfully disconnected provider"}