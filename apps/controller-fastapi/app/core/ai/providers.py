# AI Service - Provider Configurations and Model Registry
import os
from typing import Dict, Any, List

# ===== Provider API Configuration =====

# NVIDIA NIM
NIM_API_KEY = os.getenv("NVIDIA_NIM_API_KEY", "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")
NIM_BASE_URL = "https://integrate.api.nvidia.com/v1"

# Groq
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_BASE_URL = "https://api.groq.com/openai/v1"

# Google Gemini
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "AIzaSyA3cVlS4lqbjxt03YdOwib3d1b9uebJzrY")
GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"

# Ollama (Local)
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")

# Oprel (Local - Ollama compatible)
OPREL_BASE_URL = os.getenv("OPREL_BASE_URL", "http://localhost:11434")


# ===== Available Models per Provider =====

AVAILABLE_MODELS: Dict[str, Dict[str, Any]] = {
    "nvidia": {
        "name": "NVIDIA NIM",
        "models": [
            {"id": "meta/llama-3.1-8b-instruct", "name": "Llama 3.1 8B Instruct", "context": 8192},
            {"id": "meta/llama-3.1-70b-instruct", "name": "Llama 3.1 70B Instruct", "context": 8192},
            {"id": "meta/llama-3.1-405b-instruct", "name": "Llama 3.1 405B Instruct", "context": 8192},
            {"id": "mistralai/mixtral-8x7b-instruct-v0.1", "name": "Mixtral 8x7B", "context": 32768},
            {"id": "moonshotai/kimi-k2-instruct", "name": "Kimi-2", "context": 85000},
            {"id": "microsoft/phi-3-mini-128k-instruct", "name": "Phi-3 Mini 128K", "context": 128000},
        ],
        "api_key": NIM_API_KEY,
        "base_url": NIM_BASE_URL,
    },
    "groq": {
        "name": "Groq",
        "models": [
            {"id": "llama-3.3-70b-versatile", "name": "Llama 3.3 70B Versatile", "context": 128000},
            {"id": "llama-3.1-8b-instant", "name": "Llama 3.1 8B Instant", "context": 128000},
            {"id": "llama3-70b-8192", "name": "Llama 3 70B", "context": 8192},
            {"id": "mixtral-8x7b-32768", "name": "Mixtral 8x7B", "context": 32768},
            {"id": "gemma2-9b-it", "name": "Gemma 2 9B", "context": 8192},
        ],
        "api_key": GROQ_API_KEY,
        "base_url": GROQ_BASE_URL,
    },
    "gemini": {
        "name": "Google Gemini",
        "models": [
            {"id": "gemini-1.5-flash", "name": "Gemini 1.5 Flash", "context": 1000000},
            {"id": "gemini-1.5-pro", "name": "Gemini 1.5 Pro", "context": 2000000},
            {"id": "gemini-2.5-flash-lite", "name": "Gemini 2.5 Flash Lite", "context": 1000000},
        ],
        "api_key": GEMINI_API_KEY,
        "base_url": GEMINI_BASE_URL,
    },
    "oprel": {
        "name": "Oprel (Local)",
        "models": [],  # Models will be fetched dynamically from the server
        "api_key": "",  # No API key needed for local server
        "base_url": OPREL_BASE_URL,
        "dynamic": True,  # Flag to indicate models should be fetched from server
    },
}

# Default configuration
DEFAULT_PROVIDER = "nvidia"
DEFAULT_MODEL = "meta/llama-3.1-405b-instruct"


def get_provider_config(provider: str) -> Dict[str, Any]:
    """Get configuration for a specific provider"""
    if provider not in AVAILABLE_MODELS:
        raise ValueError(f"Unknown provider: {provider}")
    return AVAILABLE_MODELS[provider]


def get_model_info(provider: str, model_id: str) -> Dict[str, Any]:
    """Get model information for a specific provider and model"""
    provider_config = get_provider_config(provider)
    for model in provider_config["models"]:
        if model["id"] == model_id:
            return model
    raise ValueError(f"Model {model_id} not found for provider {provider}")


def list_all_providers() -> List[str]:
    """List all available providers"""
    return list(AVAILABLE_MODELS.keys())


def list_models_for_provider(provider: str) -> List[Dict[str, Any]]:
    """List all models for a specific provider"""
    return get_provider_config(provider)["models"]
