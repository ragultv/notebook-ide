# AI Service - Main Service Class with Multi-Provider Support
import json
import re
from typing import Optional, Dict, Any, List
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage

from .providers import (
    AVAILABLE_MODELS,
    DEFAULT_PROVIDER,
    DEFAULT_MODEL,
    OLLAMA_BASE_URL,
    OPREL_BASE_URL
)
from .prompts import (
    SYSTEM_PROMPT,
    RESEARCH_AGENT_PROMPT,
    ERROR_FIX_PROMPT
)
from .json_fixes import extract_operations


class AIService:
    """AI service with multi-provider support (NVIDIA NIM, Groq, Gemini, Ollama)."""
    
    def __init__(self):
        self.current_provider = DEFAULT_PROVIDER
        self.current_model = DEFAULT_MODEL
        self._clients: Dict[str, ChatOpenAI] = {}
        self._selected_models: List[Dict[str, str]] = []  # Models selected for chat dropdown
        self._init_default_client()
    
    def _init_default_client(self):
        """Initialize the default NVIDIA client."""
        provider_config = AVAILABLE_MODELS.get(DEFAULT_PROVIDER)
        if provider_config and provider_config["api_key"]:
            self._clients["nvidia"] = ChatOpenAI(
                model=DEFAULT_MODEL,
                temperature=0.2,
                api_key=provider_config["api_key"],
                base_url=provider_config["base_url"],
            )
    
    def _get_client(self, provider: str, model: str) -> Optional[ChatOpenAI]:
        """Get or create a client for the specified provider and model."""
        cache_key = f"{provider}:{model}"
        
        if cache_key in self._clients:
            return self._clients[cache_key]
        
        # Special case for ollama and oprel (custom models)
        if provider in ["ollama", "oprel"]:
            try:
                base_url = OPREL_BASE_URL if provider == "oprel" else OLLAMA_BASE_URL
                client = ChatOpenAI(
                    model=model,
                    temperature=0.2,
                    api_key="local",  # Local servers don't need real API key
                    base_url=f"{base_url}/v1",
                )
                self._clients[cache_key] = client
                return client
            except Exception as e:
                print(f"Error creating {provider} client for {model}: {e}")
                return None
        
        provider_config = AVAILABLE_MODELS.get(provider)
        if not provider_config:
            return None
        
        api_key = provider_config["api_key"]
        if not api_key:
            return None
        
        try:
            client = ChatOpenAI(
                model=model,
                temperature=0.2,
                api_key=api_key,
                base_url=provider_config["base_url"],
            )
            self._clients[cache_key] = client
            return client
        except Exception as e:
            print(f"Error creating client for {provider}/{model}: {e}")
            return None
    
    async def get_available_providers(self) -> Dict[str, Any]:
        """Get all available providers and their models (both cloud and local)."""
        result = {}
        
        # Add cloud providers
        for provider_id, config in AVAILABLE_MODELS.items():
            # Check if provider has API key configured
            has_key = bool(config["api_key"])
            result[provider_id] = {
                "name": config["name"],
                "models": config["models"],
                "available": has_key,
                "isLocal": False,
            }
        
        # Add local Ollama provider
        import httpx
        base_url = OLLAMA_BASE_URL.replace("/v1", "")
        if base_url.endswith("/"):
            base_url = base_url[:-1]
        url = f"{base_url}/api/tags"
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(url)
                response.raise_for_status()
                data = response.json()
                models = [{
                    "id": model["name"], 
                    "name": model["name"], 
                    "context": 8192,
                    "isLocal": True
                } for model in data.get("models", [])]
                result["ollama"] = {
                    "name": "Ollama (Local)",
                    "models": models,
                    "available": True if models else False,
                    "isLocal": True,
                }
        except Exception as e:
            print(f"Error fetching models from Ollama: {e}")
            result["ollama"] = {
                "name": "Ollama (Local)",
                "models": [],
                "available": False,
                "isLocal": True,
            }
        
        # Add local Oprel provider
        oprel_base_url = OPREL_BASE_URL.replace("/v1", "")
        if oprel_base_url.endswith("/"):
            oprel_base_url = oprel_base_url[:-1]
        oprel_url = f"{oprel_base_url}/models"
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(oprel_url)
                response.raise_for_status()
                data = response.json()
                models = [{
                    "id": model["name"], 
                    "name": model["name"], 
                    "context": model.get("details", {}).get("context_length", 8192),
                    "isLocal": True,
                    "backend": model.get("details", {}).get("format", "unknown"),
                } for model in data.get("models", [])]
                result["oprel"] = {
                    "name": "Oprel (Local)",
                    "models": models,
                    "available": True if models else False,
                    "isLocal": True,
                }
        except Exception as e:
            print(f"Error fetching models from Oprel: {e}")
            result["oprel"] = {
                "name": "Oprel (Local)",
                "models": [],
                "available": False,
                "isLocal": True,
            }
        
        return result
    
    def get_selected_models(self) -> List[Dict[str, str]]:
        """Get the list of models selected for the chat dropdown."""
        return list(self._selected_models)
    
    def toggle_model_selection(self, provider: str, model_id: str, selected: bool) -> List[Dict[str, str]]:
        """Toggle whether a model is selected for the chat dropdown."""
        model_key = {"provider": provider, "modelId": model_id}
        
        # Check if already in selected list
        existing_idx = None
        for i, sm in enumerate(self._selected_models):
            if sm["provider"] == provider and sm["modelId"] == model_id:
                existing_idx = i
                break
        
        if selected:
            # Add to selection if not already present
            if existing_idx is None:
                self._selected_models.append(model_key)
        else:
            # Remove from selection if present
            if existing_idx is not None:
                self._selected_models.pop(existing_idx)
        
        return list(self._selected_models)
    
    def set_api_key(self, provider: str, api_key: str) -> bool:
        """Set API key for a provider at runtime."""
        if provider not in AVAILABLE_MODELS:
            return False
        
        # Update the provider config
        AVAILABLE_MODELS[provider]["api_key"] = api_key
        
        # Clear any cached clients for this provider
        keys_to_remove = [k for k in self._clients.keys() if k.startswith(f"{provider}:")]
        for k in keys_to_remove:
            del self._clients[k]
        
        return True
    
    def set_model(self, provider: str, model: str) -> bool:
        """Set the current provider and model."""
        # Special case for local providers (ollama, oprel with custom models)
        if provider in ["ollama", "oprel"]:
            self.current_provider = provider
            self.current_model = model
            return True
        
        if provider not in AVAILABLE_MODELS:
            return False
        
        # Verify model exists for provider
        model_ids = [m["id"] for m in AVAILABLE_MODELS[provider]["models"]]
        if model not in model_ids:
            return False
        
        self.current_provider = provider
        self.current_model = model
        return True
    
    def get_current_model(self) -> Dict[str, str]:
        """Get the current provider and model."""
        return {
            "provider": self.current_provider,
            "model": self.current_model,
        }
    
    @property
    def llm(self) -> ChatOpenAI:
        """Get the current LLM client."""
        client = self._get_client(self.current_provider, self.current_model)
        if not client:
            # Fallback to default
            return self._clients.get("nvidia")
        return client
    
    async def research_dataset(self, problem_description: str, provider: str = None, model: str = None) -> Dict[str, Any]:
        """Research and suggest datasets for the given problem."""
        
        # Use specified or current model
        if provider and model:
            llm = self._get_client(provider, model)
            if not llm:
                llm = self.llm
        else:
            llm = self.llm
        
        messages = [
            SystemMessage(content=RESEARCH_AGENT_PROMPT),
            HumanMessage(content=f"Problem: {problem_description}\n\nAnalyze this problem and suggest the best dataset."),
        ]
        
        try:
            response = await llm.ainvoke(messages)
            text = response.content
            
            # Extract JSON from response
            match = re.search(r'```json\s*\n?({[\s\S]*?})\s*\n?```', text)
            if match:
                try:
                    dataset_info = json.loads(match.group(1))
                    # Clean text (remove JSON block)
                    clean_text = re.sub(r'```json\s*\n?{[\s\S]*?}\s*\n?```', '', text).strip()
                    return {
                        "thinking": dataset_info.get("thinking", ""),
                        "dataset": dataset_info.get("dataset", {}),
                        "text": clean_text
                    }
                except json.JSONDecodeError:
                    pass
            
            return {
                "thinking": "Could not parse dataset information",
                "dataset": {},
                "text": text
            }
            
        except Exception as e:
            return {
                "thinking": f"Error: {str(e)}",
                "dataset": {},
                "text": ""
            }
    
    async def generate(self, prompt: str, context: Optional[Dict[str, Any]] = None, 
                       provider: str = None, model: str = None) -> Dict[str, Any]:
        """Generate response with potential operations using two-step process."""
        
        # Use specified or current model
        if provider and model:
            llm = self._get_client(provider, model)
            if not llm:
                llm = self.llm
        else:
            llm = self.llm
        
        # Step 1: Check if this is a data science task that needs dataset research
        needs_dataset = any(keyword in prompt.lower() for keyword in [
            'dataset', 'data', 'prediction', 'classification', 'regression', 
            'machine learning', 'ml', 'train', 'model', 'huggingface'
        ])
        
        dataset_info = None
        thinking_text = ""
        
        if needs_dataset and not context.get("cells"):
            # This is a new notebook request - do research first
            research_result = await self.research_dataset(prompt, provider, model)
            dataset_info = research_result.get("dataset", {})
            thinking_text = f"**🔍 Dataset Research:**\n{research_result.get('thinking', '')}\n\n"
            
            if dataset_info:
                thinking_text += f"**📊 Selected Dataset:** {dataset_info.get('name', 'Unknown')}\n"
                thinking_text += f"- Task: {dataset_info.get('task', 'N/A')}\n"
                thinking_text += f"- Target: {dataset_info.get('target', 'N/A')}\n"
                thinking_text += f"- Features: {', '.join(dataset_info.get('features', [])[:5])}...\n\n"
        
        # Build context string
        context_str = ""
        if context:
            if context.get("notebookName"):
                context_str += f"\nCurrent notebook: {context['notebookName']}"
            if context.get("cells"):
                context_str += f"\nCurrent cells ({len(context['cells'])}):"
                for i, cell in enumerate(context['cells'], 1):
                    preview = cell['content'][:200] + "..." if len(cell['content']) > 200 else cell['content']
                    context_str += f"\n  Cell {i} ({cell['type']}): {preview}"
        
        # Add dataset info to context if available
        if dataset_info:
            context_str += f"\n\nDataset to use:\n"
            context_str += f"- Name: {dataset_info.get('name')}\n"
            context_str += f"- HF ID: {dataset_info.get('hf_id')}\n"
            context_str += f"- Task: {dataset_info.get('task')}\n"
            context_str += f"- Target: {dataset_info.get('target')}\n"
            context_str += f"- Load snippet: {dataset_info.get('load_snippet')}\n"
        
        full_prompt = prompt
        if context_str:
            full_prompt = f"{context_str}\n\nUser request: {prompt}"
        
        messages = [
            SystemMessage(content=SYSTEM_PROMPT),
            HumanMessage(content=full_prompt),
        ]
        
        try:
            response = await llm.ainvoke(messages)
            text = response.content
            
            print(f"\n===== AI GENERATE RESPONSE =====")
            print(f"Model: {self.current_provider}/{self.current_model}")
            print(f"Response: {text[:500]}..." if len(text) > 500 else f"Response: {text}")
            
            # Check if small model is being used (likely to have issues)
            model_lower = self.current_model.lower()
            is_small_model = any(size in model_lower for size in ['1.5b', '1b', '3b', '0.5b'])
            
            if is_small_model and ('deepseek' in model_lower or 'qwen' in model_lower):
                print(f"⚠️  WARNING: Small model detected ({self.current_model})")
                print(f"    Small models often struggle with structured JSON output.")
                print(f"    For best results, use larger models like:")
                print(f"    - qwen2.5-coder:7b or higher")
                print(f"    - deepseek-r1:7b or higher")
                print(f"    - llama3.1:8b or higher")
            
            # Extract operations from response
            operations = extract_operations(text, self.current_model)
            
            # Clean text (remove operations block)
            clean_text = re.sub(r'```(?:operations|json)?\s*\n?\[[\s\S]*?\]\s*\n?```', '', text).strip()
            # Add thinking text at the beginning
            final_text = thinking_text + clean_text
            
            # Add completion summary
            if operations:
                final_text += f"\n\n**✅ Generated {len(operations)} operations** - Notebook is ready!"
            
            return {
                "text": final_text,
                "operations": operations,
            }
            
        except Exception as e:
            print(f"\n✗ Error in generate: {e}")
            return {
                "text": f"Error: {str(e)}",
                "operations": None,
            }
    
    async def fix_error(self, error_info: Dict[str, Any], context: Optional[Dict[str, Any]] = None,
                        provider: str = None, model: str = None) -> Dict[str, Any]:
        """Analyze and fix execution errors in notebook cells."""
        
        # Use specified or current model
        if provider and model:
            llm = self._get_client(provider, model)
            if not llm:
                llm = self.llm
        else:
            llm = self.llm
        
        cell_index = error_info.get("cellIndex", 0)
        error_message = error_info.get("error", "")
        cell_content = error_info.get("cellContent", "")
        
        # Build full notebook context
        notebook_context = ""
        if context and context.get("cells"):
            notebook_context = "\\n\\nFULL NOTEBOOK CONTENT:"
            for i, cell in enumerate(context['cells'], 1):
                notebook_context += f"\\n\\n--- Cell {i} ({cell['type']}) ---\\n{cell['content']}"
        
        error_prompt = f"""ANALYZE AND FIX THIS ERROR:

**Error occurred in Cell {cell_index}:**
```python
{cell_content}
```

**Error Message:**
```
{error_message}
```
{notebook_context}

Analyze the error and provide the fix. 
- If it's a missing package, use add_package to add to Cell 1
- If it's a code error, use edit_cell to fix Cell {cell_index}
- Consider dependencies from other cells"""

        messages = [
            SystemMessage(content=ERROR_FIX_PROMPT),
            HumanMessage(content=error_prompt),
        ]
        
        try:
            response = await llm.ainvoke(messages)
            text = response.content
            
            operations = extract_operations(text, self.current_model)
            clean_text = re.sub(r'```operations\s*\n?\[[\s\S]*?\]\s*\n?```', '', text).strip()
            
            return {
                "text": clean_text,
                "operations": operations,
            }
            
        except Exception as e:
            return {
                "text": f"Error analyzing: {str(e)}",
                "operations": None,
            }
    
    async def generate_code(self, prompt: str, context: Optional[Dict[str, Any]] = None,
                            provider: str = None, model: str = None) -> str:
        """Generate only code (no operations)."""
        
        # Use specified or current model
        if provider and model:
            llm = self._get_client(provider, model)
            if not llm:
                llm = self.llm
        else:
            llm = self.llm
        
        code_prompt = f"""Generate Python code for: {prompt}

Return ONLY the code, no explanations. The code should be complete and runnable."""
        
        messages = [
            SystemMessage(content="You are a Python code generator. Return only code, no markdown."),
            HumanMessage(content=code_prompt),
        ]
        
        try:
            response = await llm.ainvoke(messages)
            code = response.content
            
            # Clean markdown code blocks if present
            code = re.sub(r'^```python\s*\n?', '', code)
            code = re.sub(r'\n?```$', '', code)
            
            return code.strip()
            
        except Exception as e:
            return f"# Error generating code: {str(e)}"


# Singleton instance
ai_service = AIService()
