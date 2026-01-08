# API routes for AI Model Management
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional, Dict, Any, List

from app.core.ai_service import ai_service

router = APIRouter(prefix="/models", tags=["AI Models"])


class SetModelRequest(BaseModel):
    provider: str
    model: str


class ProviderInfo(BaseModel):
    name: str
    models: List[Dict[str, Any]]
    available: bool


@router.get("/providers")
async def get_providers(model_type: str) -> Dict[str, Any]:
    """Get all available AI providers and their models."""
    providers = await ai_service.get_available_providers(model_type=model_type)
    return {
        "providers": providers,
        "current": ai_service.get_current_model(),
    }


@router.post("/select")
async def select_model(request: SetModelRequest) -> Dict[str, Any]:
    """Set the current AI model."""
    success = ai_service.set_model(request.provider, request.model)
    print(ai_service.get_current_model())
    return {
        "success": success,
        "current": ai_service.get_current_model(),
    }


@router.get("/current")
async def get_current_model() -> Dict[str, str]:
    """Get the currently selected model."""
    return ai_service.get_current_model()


class SetApiKeyRequest(BaseModel):
    provider: str
    apiKey: str


@router.post("/api-key")
async def set_api_key(request: SetApiKeyRequest) -> Dict[str, Any]:
    """Set API key for a provider."""
    success = ai_service.set_api_key(request.provider, request.apiKey)
    return {"success": success}
