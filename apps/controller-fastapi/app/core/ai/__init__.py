# AI Service Module - Clean, Organized Structure
# Exports the main AI service instance for use across the application

from .ai_service import ai_service, AIService
from .providers import (
    AVAILABLE_MODELS,
    DEFAULT_PROVIDER,
    DEFAULT_MODEL,
    get_provider_config,
    get_model_info,
    list_all_providers,
    list_models_for_provider
)
from .prompts import (
    SYSTEM_PROMPT,
    RESEARCH_AGENT_PROMPT,
    ERROR_FIX_PROMPT
)
from .json_fixes import (
    extract_operations,
    fix_deepseek_json,
    fix_json_string
)

__all__ = [
    'ai_service',
    'AIService',
    'AVAILABLE_MODELS',
    'DEFAULT_PROVIDER',
    'DEFAULT_MODEL',
    'SYSTEM_PROMPT',
    'RESEARCH_AGENT_PROMPT',
    'ERROR_FIX_PROMPT',
]
