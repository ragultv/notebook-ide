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
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "AIzaSyA3cVlS4lqbjxt03YdOwib3d1b9uebJzrY")
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
            {"id": "moonshotai/kimi-k2-instruct", "name": "Kimi-2","context":85000},
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
}

# Default model
DEFAULT_PROVIDER = "nvidia"
DEFAULT_MODEL = "meta/llama-3.1-405b-instruct"

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
   - Use -q flag for quiet installation
   - Install one package per line if there are compatibility issues
   - For HuggingFace datasets: !pip install datasets -q

2. **Structure notebooks properly:**
   - Cell 1: Package installations (!pip install ... -q)
   - Cell 2: Import statements
   - Cell 3: Data loading/downloading (if using HuggingFace or URLs)
   - Cell 4+: Data processing, analysis, visualization

3. **HuggingFace Datasets Handling:**
   - Download and save datasets locally for reusability
   - Example pattern:
     ```python
     from datasets import load_dataset
     import os
     
     # Create data directory
     os.makedirs('data', exist_ok=True)
     
     # Load dataset from HuggingFace
     dataset = load_dataset('dataset_name', split='train')
     
     # Convert to pandas and save locally
     df = dataset.to_pandas()
     df.to_csv('data/dataset_name.csv', index=False)
     print(f"Dataset saved to: {os.path.abspath('data/dataset_name.csv')}")
     print(f"Shape: {df.shape}")
     df.head()
     ```
   - Always print the absolute path so user can find the file
   - Use forward slashes in paths (works on all OS)

4. **Code Quality:**
   - Use proper variable names
   - Add comments explaining key steps
   - Handle errors gracefully
   - Use print() statements to show results and file paths
   - For visualizations, use plt.show()
   - Always show data shape and preview after loading

5. **Data Science Best Practices:**
   - For local CSV: pd.read_csv('data/file.csv')
   - For URLs: pd.read_csv(url) or use requests
   - For visualizations: import matplotlib.pyplot as plt, seaborn as sns
   - For ML: from sklearn.model_selection import train_test_split
   - Always check for missing values and data types

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

Example for "create a house price prediction notebook using HuggingFace data":
"I'll create a house price prediction notebook that downloads data from HuggingFace, saves it locally, and trains a model.
```json
[
  {"type": "create_notebook", "params": {"name": "house_price_prediction.ipynb"}},
  {"type": "add_cell", "params": {"type": "markdown", "content": "# House Price Prediction\\nUsing HuggingFace Datasets and Linear Regression"}},
  {"type": "add_cell", "params": {"type": "code", "content": "# Install required packages\\n!pip install pandas numpy matplotlib seaborn scikit-learn -q\\n!pip install datasets -q"}},
  {"type": "add_cell", "params": {"type": "code", "content": "# Import libraries\\nimport pandas as pd\\nimport numpy as np\\nimport matplotlib.pyplot as plt\\nimport seaborn as sns\\nfrom sklearn.model_selection import train_test_split\\nfrom sklearn.linear_model import LinearRegression\\nfrom sklearn.metrics import mean_squared_error, r2_score\\nimport os"}},
  {"type": "add_cell", "params": {"type": "code", "content": "# Load dataset from HuggingFace and save locally\\nfrom datasets import load_dataset\\n\\n# Create data directory\\nos.makedirs('data', exist_ok=True)\\n\\n# Load dataset\\ndataset = load_dataset('your_dataset_id', split='train')\\ndf = dataset.to_pandas()\\n\\n# Save to CSV\\ndf.to_csv('data/house_prices.csv', index=False)\\nprint(f'Dataset saved to: {os.path.abspath(\\\"data/house_prices.csv\\\")}')\\nprint(f'Shape: {df.shape}')\\ndf.head()"}},
  {"type": "add_cell", "params": {"type": "code", "content": "# Data preprocessing\\nprint(df.info())\\nprint(df.describe())"}}
]
```"


**CRITICAL:**
- Generate COMPLETE, RUNNABLE code
- ALWAYS include pip install in first code cell
- Use -q flag for quiet installation"""

RESEARCH_AGENT_PROMPT = """You are the Research Agent for OPREL IDE.

Your job is to analyze the user's problem and suggest appropriate public datasets.

**ANALYSIS PROCESS:**
1. Understand the problem type (classification, regression, clustering, etc.)
2. Identify key requirements (features needed, target variable, data size)
3. Search for suitable HuggingFace datasets or well-known public datasets
4. Provide 1-2 best options with complete details

**OUTPUT FORMAT:**
Provide your analysis as conversational text, then output strict JSON:

```json
{
  "thinking": "Brief analysis of the problem and why these datasets fit",
  "dataset": {
    "name": "Dataset display name",
    "hf_id": "huggingface/dataset-id or scikit-learn/dataset-name",
    "task": "classification|regression|clustering|etc",
    "target": "target_column_name",
    "features": ["feature1", "feature2", "feature3"],
    "load_snippet": "from datasets import load_dataset; dataset = load_dataset('hf_id', split='train')",
    "notes": "License info, size, special considerations"
  }
}
```

**EXAMPLE:**
For "house price prediction":
```json
{
  "thinking": "This is a regression problem requiring numerical features about houses (size, location, age, etc.) to predict price. The California Housing dataset is perfect - it's well-documented, clean, and specifically designed for regression tasks.",
  "dataset": {
    "name": "California Housing Dataset",
    "hf_id": "scikit-learn/california-housing",
    "task": "regression",
    "target": "median_house_value",
    "features": ["median_income", "housing_median_age", "total_rooms", "total_bedrooms", "population", "households", "latitude", "longitude"],
    "load_snippet": "from sklearn.datasets import fetch_california_housing; data = fetch_california_housing(as_frame=True)",
    "notes": "20,640 samples, 8 features, public domain, ideal for learning regression"
  }
}
```

**POPULAR DATASETS:**
- Classification: iris, wine, breast_cancer, mnist, fashion_mnist
- Regression: california_housing, boston (deprecated, use california), diabetes
- NLP: imdb, ag_news, sst2
- Computer Vision: cifar10, cifar100, imagenet (subset)

**CRITICAL:**
- Always provide thinking/analysis first
- Use real, accessible datasets
- Prefer HuggingFace or scikit-learn datasets
- Include complete load snippet"""

ERROR_FIX_PROMPT = """You are a Python Error Fixing Agent for OPREL IDE notebooks.

Your job is to analyze Python execution errors and provide fixes that WORK.

**CRITICAL ENVIRONMENT INFO:**
- This is a Jupyter-style notebook environment
- May be running on Windows (no bash commands like curl, cat, wget)
- Use Python code for all operations (requests, urllib, pandas.read_csv with URLs)
- NEVER use shell commands (!curl, !cat, !wget) - they fail on Windows

**ERROR HANDLING RULES:**

1. **ModuleNotFoundError / ImportError**: 
   - Use add_package operation to install missing package
   - This will add "!pip install package_name -q" to Cell 1
   - Common packages: pandas, numpy, matplotlib, seaborn, scikit-learn, torch, tensorflow, requests, datasets

2. **Command/Shell Errors (curl, cat, wget not recognized)**:
   - REPLACE shell commands with Python equivalents:
     * !curl URL -o file.csv → Use requests or urllib
     * !wget URL → Use requests.get()
     * !cat file → Use with open() or pd.read_csv()
   - Example fix:
     ```python
     import requests
     url = "https://example.com/data.csv"
     response = requests.get(url)
     with open('data.csv', 'wb') as f:
         f.write(response.content)
     df = pd.read_csv('data.csv')
     ```
   - Or directly: `df = pd.read_csv(url)`

3. **NameError (variable/function not defined)**: 
   - Check if import is missing
   - Or add the missing definition
   - Check if variable was defined in a previous cell

4. **SyntaxError**: 
   - Fix the syntax in the specific cell
   - Check for missing colons, parentheses, quotes

5. **TypeError / ValueError**: 
   - Fix the function call or data type
   - Check data format and conversions

6. **FileNotFoundError**:
   - Check if file exists or needs to be downloaded
   - Use proper path format (forward slashes work on all OS)
   - Consider downloading from URL if applicable

**AVAILABLE OPERATIONS:**

1. add_package: Add package installation to Cell 1
   {"type": "add_package", "params": {"packages": ["package1", "package2"]}}
   This will add: !pip install package1 package2 -q

2. edit_cell: Edit a specific cell to fix error
   {"type": "edit_cell", "params": {"cellIndex": 1, "content": "fixed code"}}

**RESPONSE FORMAT:**
```json
[
  {"type": "add_package", "params": {"packages": ["missing_package"]}},
  {"type": "edit_cell", "params": {"cellIndex": 3, "content": "# Fixed code\\nfixed_code_here"}}
]
```

**PACKAGE MAPPING (common errors):**
- "No module named 'pandas'" → add_package: ["pandas"]
- "No module named 'sklearn'" → add_package: ["scikit-learn"]
- "No module named 'cv2'" → add_package: ["opencv-python"]
- "No module named 'PIL'" → add_package: ["Pillow"]
- "No module named 'torch'" → add_package: ["torch"]
- "No module named 'requests'" → add_package: ["requests"]
- "No module named 'datasets'" → add_package: ["datasets"]

**CRITICAL:**
- For missing packages, ALWAYS use add_package (NOT edit_cell)
- For shell command errors, ALWAYS replace with Python code
- Keep fixes minimal and targeted
- Preserve existing code logic
- Test your fix mentally - will it actually work?
- Consider the full notebook context when fixing"""


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
        
        # Special case for ollama (custom models)
        if provider == "ollama":
            try:
                client = ChatOpenAI(
                    model=model,
                    temperature=0.2,
                    api_key="ollama",  # Ollama doesn't need real API key
                    base_url="http://localhost:11434/v1",
                )
                self._clients[cache_key] = client
                return client
            except Exception as e:
                print(f"Error creating Ollama client for {model}: {e}")
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
    
    async def get_available_providers(self, model_type: str) -> Dict[str, Any]:
        """Get all available providers and their models."""
        result = {}
        if(model_type == "default"):
            for provider_id, config in AVAILABLE_MODELS.items():
                # Check if provider has API key configured
                has_key = bool(config["api_key"])
                result[provider_id] = {
                    "name": config["name"],
                    "models": config["models"],
                    "available": has_key,
                }
        else:
            import httpx
            url = f"http://localhost:11434/api/tags"
            try:
                async with httpx.AsyncClient() as client:
                    response = await client.get(url)
                    response.raise_for_status()
                    data = response.json()
                    models = [{"id": model["name"], "name": model["name"], "context": 8192} for model in data["models"]]
                    result["ollama"] = {
                        "name": "Ollama (Local)",
                        "models": models,
                        "available": True if models else False
                    }
            except Exception as e:
                print(f"Error fetching models from local service: {e}")
                result["ollama"] = {
                    "name": "Ollama (Local)",
                    "models": [],
                    "available": False
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
        # Special case for ollama (custom models)
        if provider == "ollama":
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
            operations = self._extract_operations(text)
            
            # Clean text (remove operations block)
            clean_text = re.sub(r'```(?:operations|json)?\s*\n?\[[\s\S]*?\]\s*\n?```', '', text).strip()
            # clean_text = re.sub(r'```json\s*\n?\[[\s\S]*?\]\s*\n?```', '', clean_text).strip()
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
    
    def _fix_deepseek_json(self, json_str: str) -> str:
        """Fix common JSON issues from DeepSeek models."""
        print(f"\n🔧 Applying DeepSeek JSON fixes...")
        
        # Strategy: Parse character by character, properly tracking JSON string context
        # and escape unescaped quotes within string values
        
        result = []
        i = 0
        in_string = False
        is_key = False  # Are we in a key or value?
        escape_next = False
        brace_depth = 0
        
        while i < len(json_str):
            char = json_str[i]
            
            if escape_next:
                result.append(char)
                escape_next = False
                i += 1
                continue
            
            if char == '\\':
                result.append(char)
                escape_next = True
                i += 1
                continue
            
            # Track brace depth (outside strings)
            if not in_string:
                if char in '{[':
                    brace_depth += 1
                elif char in '}]':
                    brace_depth -= 1
            
            # Handle quotes
            if char == '"':
                if not in_string:
                    # Starting a string
                    in_string = True
                    # Check if this is a key (look back for { or ,)
                    prev_significant = ''.join(result).rstrip()
                    is_key = prev_significant.endswith('{') or prev_significant.endswith(',')
                    result.append(char)
                else:
                    # Potentially ending a string
                    # Look ahead to see what comes next
                    lookahead = json_str[i+1:i+10].lstrip()
                    
                    # If we're in a value and the next char is not : or , or } or ],
                    # this might be a nested quote
                    if not is_key and lookahead and lookahead[0] not in ',:}]':
                        # This is likely a nested quote - escape it
                        result.append('\\"')
                        i += 1
                        continue
                    
                    # Otherwise, close the string
                    in_string = False
                    result.append(char)
            elif in_string:
                # Inside a string - escape control chars
                if char == '\n':
                    result.append('\\n')
                elif char == '\r':
                    result.append('\\r')
                elif char == '\t':
                    result.append('\\t')
                else:
                    result.append(char)
            else:
                result.append(char)
            
            i += 1
        
        json_str = ''.join(result)
        
        # Now apply structural fixes
        
        # Fix 1: Remove stray closing brackets
        json_str = re.sub(r'\}\]\s*,\s*\n', '},\n', json_str)
        
        # Fix 2: Remove blank lines within arrays
        lines = json_str.split('\n')
        fixed_lines = []
        bracket_depth = 0
        
        for line in lines:
            stripped = line.strip()
            bracket_depth += stripped.count('[') + stripped.count('{')
            bracket_depth -= stripped.count(']') + stripped.count('}')
            
            # Skip blank lines inside arrays
            if not stripped and bracket_depth > 0:
                continue
            
            # Fix }], to },
            if bracket_depth > 0 and re.search(r'\}\]\s*,\s*$', stripped):
                line = re.sub(r'\}\]\s*,\s*$', '},', line)
            
            fixed_lines.append(line)
        
        json_str = '\n'.join(fixed_lines)
        
        # Fix 3: Remove trailing commas
        json_str = re.sub(r',(\s*)\]', r'\1]', json_str)
        json_str = re.sub(r',(\s*)\}', r'\1}', json_str)
        
        # Fix 4: Clean up spacing
        json_str = re.sub(r',\s*\n\s*\n', ',\n', json_str)
        
        print(f"✓ DeepSeek JSON fixes applied")
        print(f"Fixed JSON preview (first 800 chars):\n{json_str[:800]}...")
        return json_str
    
    def _fix_json_string(self, json_str: str) -> str:
        """Fix common JSON formatting issues from LLM outputs by escaping control characters."""
        result = []
        in_string = False
        escape_next = False
        string_start_char = None  # Track if string started with " or '
        
        for i, char in enumerate(json_str):
            if escape_next:
                result.append(char)
                escape_next = False
                continue
            
            if char == '\\':
                result.append(char)
                escape_next = True
                continue
            
            # Handle quotes
            if char == '"':
                if not in_string:
                    # Starting a new string
                    in_string = True
                    string_start_char = '"'
                    result.append(char)
                elif string_start_char == '"':
                    # Check if this is actually closing the string or a nested quote
                    # Look ahead to see if this might be a nested quote
                    # If next chars suggest we're still in a string, escape it
                    remaining = json_str[i+1:i+50] if i+1 < len(json_str) else ""
                    
                    # Heuristic: if after this quote we see more code-like content before
                    # seeing a comma or closing brace, it's likely a nested quote
                    if in_string and remaining and not remaining.lstrip().startswith((',', '}', ']')):
                        # Check if remaining looks like it's still inside Python code
                        if any(indicator in remaining[:30] for indicator in ['print', '(', ')', '=', 'f"', "f'"]):
                            # This is a nested quote, escape it
                            result.append('\\"')
                            continue
                    
                    # Otherwise, it's closing the string
                    in_string = False
                    string_start_char = None
                    result.append(char)
                else:
                    # We're in a single-quoted string, so " is just a char
                    result.append(char)
                continue
            
            # If we're inside a string and hit a control character, escape it
            if in_string:
                if char == '\n':
                    result.append('\\n')
                elif char == '\r':
                    result.append('\\r')
                elif char == '\t':
                    result.append('\\t')
                else:
                    result.append(char)
            else:
                result.append(char)
        
        return ''.join(result)

    def _extract_operations(self, text: str) -> Optional[List[Dict[str, Any]]]:
        """Extract operations JSON from response text."""
        print(f"\n===== EXTRACTING OPERATIONS =====")
        # Don't truncate the debug output - show everything
        print(f"Full AI Response Text ({len(text)} chars):\n{text}\n")
        
        # Check if using DeepSeek model
        is_deepseek = 'deepseek' in self.current_model.lower()
        
        # Method 1: Look for ```operations block
        match = re.search(r'```operations\s*\n?(\[[\s\S]*?\])\s*\n?```', text)
        if match:
            try:
                json_str = self._fix_deepseek_json(match.group(1)) if is_deepseek else self._fix_json_string(match.group(1))
                ops = json.loads(json_str)
                print(f"✓ Extracted {len(ops)} operations from ```operations block")
                return ops
            except json.JSONDecodeError as e:
                print(f"✗ Failed to parse operations block JSON: {e}")
        
        # Method 2: Look for ```json block
        match = re.search(r'```json\s*\n?(\[[\s\S]*?\])\s*\n?```', text)
        if match:
            try:
                json_str = self._fix_deepseek_json(match.group(1)) if is_deepseek else self._fix_json_string(match.group(1))
                ops = json.loads(json_str)
                print(f"✓ Extracted {len(ops)} operations from ```json block")
                return ops
            except json.JSONDecodeError as e:
                print(f"✗ Failed to parse json block JSON: {e}")
                if is_deepseek:
                    print(f"Fixed JSON attempt:\n{json_str[:500]}...")
        
        # Method 3: Look for any code block with JSON array
        match = re.search(r'```\s*\n?(\[[\s\S]*?\])\s*\n?```', text)
        if match:
            try:
                json_str = self._fix_deepseek_json(match.group(1)) if is_deepseek else self._fix_json_string(match.group(1))
                ops = json.loads(json_str)
                # Verify it looks like operations
                if ops and isinstance(ops, list) and len(ops) > 0 and isinstance(ops[0], dict) and 'type' in ops[0]:
                    print(f"✓ Extracted {len(ops)} operations from generic code block")
                    return ops
            except (json.JSONDecodeError, KeyError, IndexError) as e:
                print(f"✗ Failed to parse generic code block: {e}")
        
        # Method 4: Try to find JSON array directly (no code fence)
        match = re.search(r'\[\s*\{\s*"type"\s*:\s*"[^"]+"\s*,\s*"params"\s*:[\s\S]*?\}\s*\]', text)
        if match:
            try:
                json_str = self._fix_deepseek_json(match.group(0)) if is_deepseek else self._fix_json_string(match.group(0))
                ops = json.loads(json_str)
                print(f"✓ Extracted {len(ops)} operations from direct JSON")
                return ops
            except json.JSONDecodeError as e:
                print(f"✗ Failed to parse direct JSON: {e}")
        
        # Method 5: Look for any JSON array with "type" field (most lenient)
        match = re.search(r'\[\s*\{[^}]*"type"[^}]*\}[\s\S]*?\]', text)
        if match:
            try:
                json_str = self._fix_deepseek_json(match.group(0)) if is_deepseek else self._fix_json_string(match.group(0))
                ops = json.loads(json_str)
                print(f"✓ Extracted {len(ops)} operations from loose JSON match")
                return ops
            except json.JSONDecodeError as e:
                print(f"✗ Failed to parse loose JSON: {e}")
        
        print(f"✗ No operations found in response")
        return None


# Singleton instance
ai_service = AIService()
