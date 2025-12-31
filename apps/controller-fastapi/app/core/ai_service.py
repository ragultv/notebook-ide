# AI Service - Multi-Provider Integration (NVIDIA NIM, Groq, Gemini)
import json
import re
import os
from typing import Optional, Dict, Any, List
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage

# ===== Provider Configuration =====

# NVIDIA NIM
NIM_API_KEY = os.getenv("NVIDIA_NIM_API_KEY", "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")
NIM_BASE_URL = "https://integrate.api.nvidia.com/v1"

# Groq
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_BASE_URL = "https://api.groq.com/openai/v1"

# Google Gemini
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"

# Available Models per Provider
AVAILABLE_MODELS = {
    "nvidia": {
        "name": "NVIDIA NIM",
        "models": [
            {"id": "meta/llama-3.1-8b-instruct", "name": "Llama 3.1 8B Instruct", "context": 8192},
            {"id": "meta/llama-3.1-70b-instruct", "name": "Llama 3.1 70B Instruct", "context": 8192},
            {"id": "meta/llama-3.1-405b-instruct", "name": "Llama 3.1 405B Instruct", "context": 8192},
            {"id": "mistralai/mixtral-8x7b-instruct-v0.1", "name": "Mixtral 8x7B", "context": 32768},
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
            {"id": "gemini-2.0-flash-exp", "name": "Gemini 2.0 Flash Exp", "context": 1000000},
        ],
        "api_key": GEMINI_API_KEY,
        "base_url": GEMINI_BASE_URL,
    },
}

# Default model
DEFAULT_PROVIDER = "nvidia"
DEFAULT_MODEL = "meta/llama-3.1-8b-instruct"

SYSTEM_PROMPT = """You are an expert Python Code Generator for OPREL IDE - a notebook environment for data science and ML.

**YOUR PRIMARY ROLE:**
Generate complete, production-ready Python code that runs without errors.

**CODE GENERATION RULES:**
1. **ALWAYS start with package installation** - First cell must contain:
   ```python
   # Install required packages
   !pip install pandas numpy matplotlib seaborn scikit-learn -q
   ```
   Add any additional packages needed for the task.

2. **Structure notebooks properly:**
   - Cell 1: Package installations (!pip install ... -q)
   - Cell 2: Import statements
   - Cell 3+: Data loading, processing, analysis, visualization

3. **Code Quality:**
   - Use proper variable names
   - Add comments explaining key steps
   - Handle errors gracefully
   - Use print() statements to show results
   - For visualizations, use plt.show()

4. **Data Science Best Practices:**
   - For CSV: pd.read_csv('path/to/file.csv')
   - For visualizations: import matplotlib.pyplot as plt, seaborn as sns
   - For ML: from sklearn.model_selection import train_test_split

**AVAILABLE OPERATIONS:**
1. add_cell: Add a new cell
   {"type": "add_cell", "params": {"type": "code|markdown", "content": "cell content"}}

2. edit_cell: Edit an existing cell (1-based index)
   {"type": "edit_cell", "params": {"cellIndex": 1, "content": "new content"}}

3. delete_cell: Delete a cell (1-based index)
   {"type": "delete_cell", "params": {"cellIndex": 1}}

4. create_notebook: Create a new notebook
   {"type": "create_notebook", "params": {"name": "filename.ipynb"}}

**RESPONSE FORMAT:**
Always respond with:
1. Brief explanation of what you'll create
2. JSON operations array in ```operations``` block

Example for "create a data analysis notebook":
"I'll create a data analysis notebook with package installation and basic analysis.
```operations
[
  {"type": "add_cell", "params": {"type": "markdown", "content": "# Data Analysis Notebook"}},
  {"type": "add_cell", "params": {"type": "code", "content": "# Install required packages\n!pip install pandas numpy matplotlib seaborn -q"}},
  {"type": "add_cell", "params": {"type": "code", "content": "# Import libraries\nimport pandas as pd\nimport numpy as np\nimport matplotlib.pyplot as plt\nimport seaborn as sns\n\n# Configure display\nplt.style.use('seaborn-v0_8-whitegrid')\npd.set_option('display.max_columns', None)"}},
  {"type": "add_cell", "params": {"type": "code", "content": "# Load data\n# df = pd.read_csv('your_data.csv')\n# df.head()"}}
]
```"

**CRITICAL:**
- Generate COMPLETE, RUNNABLE code
- ALWAYS include pip install in first code cell
- Use -q flag for quiet installation"""

ERROR_FIX_PROMPT = """You are a Python Error Fixing Agent for OPREL IDE notebooks.

Your job is to analyze Python execution errors and provide fixes.

**ERROR HANDLING RULES:**

1. **ModuleNotFoundError / ImportError**: 
   - Use add_package operation to install missing package
   - This will add "!pip install package_name -q" to Cell 1
   - Common packages: pandas, numpy, matplotlib, seaborn, scikit-learn, torch, tensorflow

2. **NameError (variable/function not defined)**: 
   - Check if import is missing
   - Or add the missing definition

3. **SyntaxError**: 
   - Fix the syntax in the specific cell

4. **TypeError / ValueError**: 
   - Fix the function call or data type

5. **FileNotFoundError**:
   - Check the file path
   - Suggest correct path format

**AVAILABLE OPERATIONS:**

1. add_package: Add package installation to Cell 1
   {"type": "add_package", "params": {"packages": ["package1", "package2"]}}
   This will add: !pip install package1 package2 -q

2. edit_cell: Edit a specific cell to fix error
   {"type": "edit_cell", "params": {"cellIndex": 1, "content": "fixed code"}}

**RESPONSE FORMAT:**
```operations
[
  {"type": "add_package", "params": {"packages": ["missing_package"]}},
  {"type": "edit_cell", "params": {"cellIndex": 3, "content": "# Fixed code\nfixed_code_here"}}
]
```

**PACKAGE MAPPING (common errors):**
- "No module named 'pandas'" → add_package: ["pandas"]
- "No module named 'sklearn'" → add_package: ["scikit-learn"]
- "No module named 'cv2'" → add_package: ["opencv-python"]
- "No module named 'PIL'" → add_package: ["Pillow"]
- "No module named 'torch'" → add_package: ["torch"]

**CRITICAL:**
- For missing packages, ALWAYS use add_package (NOT edit_cell)
- Keep fixes minimal and targeted
- Preserve existing code logic"""


class AIService:
    """AI service with multi-provider support (NVIDIA NIM, Groq, Gemini)."""
    
    def __init__(self):
        self.current_provider = DEFAULT_PROVIDER
        self.current_model = DEFAULT_MODEL
        self._clients: Dict[str, ChatOpenAI] = {}
        self._init_default_client()
    
    def _init_default_client(self):
        """Initialize the default NVIDIA client."""
        self._clients["nvidia"] = ChatOpenAI(
            model=DEFAULT_MODEL,
            temperature=0.2,
            api_key=NIM_API_KEY,
            base_url=NIM_BASE_URL,
        )
    
    def _get_client(self, provider: str, model: str) -> Optional[ChatOpenAI]:
        """Get or create a client for the specified provider and model."""
        cache_key = f"{provider}:{model}"
        
        if cache_key in self._clients:
            return self._clients[cache_key]
        
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
    
    def get_available_providers(self) -> Dict[str, Any]:
        """Get all available providers and their models."""
        result = {}
        for provider_id, config in AVAILABLE_MODELS.items():
            # Check if provider has API key configured
            has_key = bool(config["api_key"])
            result[provider_id] = {
                "name": config["name"],
                "models": config["models"],
                "available": has_key,
            }
        return result
    
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
    
    async def generate(self, prompt: str, context: Optional[Dict[str, Any]] = None, 
                       provider: str = None, model: str = None) -> Dict[str, Any]:
        """Generate response with potential operations."""
        
        # Use specified or current model
        if provider and model:
            llm = self._get_client(provider, model)
            if not llm:
                llm = self.llm
        else:
            llm = self.llm
        
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
            
            # Extract operations from response
            operations = self._extract_operations(text)
            
            # Clean text (remove operations block)
            clean_text = re.sub(r'```operations\s*\n?\[[\s\S]*?\]\s*\n?```', '', text).strip()
            
            return {
                "text": clean_text,
                "operations": operations,
            }
            
        except Exception as e:
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
            
            operations = self._extract_operations(text)
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
    
    def _extract_operations(self, text: str) -> Optional[List[Dict[str, Any]]]:
        """Extract operations JSON from response text."""
        
        # Look for operations block
        match = re.search(r'```operations\s*\n?(\[[\s\S]*?\])\s*\n?```', text)
        if match:
            try:
                return json.loads(match.group(1))
            except json.JSONDecodeError:
                pass
        
        # Try to find JSON array directly
        match = re.search(r'\[\s*\{[^}]*"type"[^}]*\}[\s\S]*?\]', text)
        if match:
            try:
                return json.loads(match.group(0))
            except json.JSONDecodeError:
                pass
        
        return None


# Singleton instance
ai_service = AIService()
