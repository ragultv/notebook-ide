# API routes for AI Model Management
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional, Dict, Any, List

from app.core.ai import ai_service

router = APIRouter(prefix="/models", tags=["AI Models"])


class SetModelRequest(BaseModel):
    provider: str
    model: str


class ToggleModelSelectionRequest(BaseModel):
    provider: str
    modelId: str
    selected: bool


class ProviderInfo(BaseModel):
    name: str
    models: List[Dict[str, Any]]
    available: bool
    isLocal: Optional[bool] = False


class SelectedModel(BaseModel):
    provider: str
    modelId: str


@router.get("/providers")
async def get_providers() -> Dict[str, Any]:
    """Get all available AI providers and their models (both cloud and local)."""
    providers = await ai_service.get_available_providers()
    return {
        "providers": providers,
        "current": ai_service.get_current_model(),
        "selectedModels": ai_service.get_selected_models(),
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


@router.post("/toggle-selection")
async def toggle_model_selection(request: ToggleModelSelectionRequest) -> Dict[str, Any]:
    """Toggle whether a model is selected for the chat dropdown."""
    selected_models = ai_service.toggle_model_selection(
        request.provider, 
        request.modelId, 
        request.selected
    )
    return {
        "success": True,
        "selectedModels": selected_models,
    }


@router.get("/selected")
async def get_selected_models() -> Dict[str, Any]:
    """Get the list of models selected for the chat dropdown."""
    return {
        "selectedModels": ai_service.get_selected_models(),
    }


class SetApiKeyRequest(BaseModel):
    provider: str
    apiKey: str


@router.post("/api-key")
async def set_api_key(request: SetApiKeyRequest) -> Dict[str, Any]:
    """Set API key for a provider."""
    success = ai_service.set_api_key(request.provider, request.apiKey)
    return {"success": success}
