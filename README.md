# OPREL Studio — Notebook IDE

A modern, lightweight notebook editor for Python with AI-powered code generation, real-time syntax checking, and notebook isolation.

![OPREL Studio](https://img.shields.io/badge/OPREL-Studio-red?style=for-the-badge)
![Python](https://img.shields.io/badge/Python-3.12+-blue?style=flat-square)
![React](https://img.shields.io/badge/React-18+-61DAFB?style=flat-square)
![FastAPI](https://img.shields.io/badge/FastAPI-0.100+-009688?style=flat-square)

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           OPREL Studio                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    Desktop UI (React + Vite)                     │   │
│  │  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌──────────────┐  │   │
│  │  │ Notebook  │  │   Cell    │  │  Sidebar  │  │   AI Chat    │  │   │
│  │  │ Component │  │ Component │  │  (Files)  │  │   Panel      │  │   │
│  │  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘  └──────┬───────┘  │   │
│  │        │              │              │               │          │   │
│  │        └──────────────┴──────────────┴───────────────┘          │   │
│  │                              │                                   │   │
│  │                    Controller Client (HTTP/SSE)                  │   │
│  └──────────────────────────────┼───────────────────────────────────┘   │
│                                 │                                       │
│                          HTTP :8000                                     │
│                                 │                                       │
│  ┌──────────────────────────────┼───────────────────────────────────┐   │
│  │              Controller (FastAPI + Python)                       │   │
│  │  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌──────────────┐  │   │
│  │  │ Execution │  │  Kernels  │  │ Notebooks │  │      AI      │  │   │
│  │  │    API    │  │    API    │  │    API    │  │   Service    │  │   │
│  │  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘  └──────┬───────┘  │   │
│  │        │              │              │               │          │   │
│  │        └──────────────┴──────────────┴───────────────┘          │   │
│  │                              │                                   │   │
│  │  ┌───────────────────────────┴───────────────────────────────┐  │   │
│  │  │                   Kernel Manager                           │  │   │
│  │  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐│  │   │
│  │  │  │ Exec Queue  │  │  Notebook   │  │   Shared Registry   ││  │   │
│  │  │  │  (asyncio)  │  │  Isolation  │  │  (export/import)    ││  │   │
│  │  │  └─────────────┘  └─────────────┘  └─────────────────────┘│  │   │
│  │  └───────────────────────────────────────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🗂️ Project Structure

```
notebook-ide/
├── apps/
│   ├── desktop-ui/                 # React Frontend (Vite + TypeScript)
│   │   ├── src/
│   │   │   ├── components/
│   │   │   │   ├── Notebook/       # Notebook & Cell components
│   │   │   │   ├── Layout/         # Sidebar, Header
│   │   │   │   └── Chat/           # AI Chat panel
│   │   │   ├── services/           # API client
│   │   │   ├── state/              # Zustand stores
│   │   │   └── types/              # TypeScript types
│   │   └── index.html
│   │
│   └── controller-fastapi/         # Python Backend (FastAPI)
│       ├── app/
│       │   ├── api/                # API routes
│       │   │   ├── execution.py    # Cell execution endpoints
│       │   │   ├── kernels.py      # Kernel management
│       │   │   ├── notebooks.py    # Notebook CRUD
│       │   │   ├── ai.py           # AI generation
│       │   │   └── files.py        # File operations
│       │   ├── core/
│       │   │   ├── kernel_manager.py  # Execution engine
│       │   │   ├── ai_service.py      # LLM integration
│       │   │   └── notebook_model.py  # Data models
│       │   └── main.py             # FastAPI app
│       └── notebooks/              # Saved notebooks
│
└── README.md
```

---

## 🔧 Core Components

### 1. Kernel Manager (`kernel_manager.py`)

The heart of the execution system with:

| Feature | Description |
|---------|-------------|
| **Notebook Isolation** | Each notebook has its own `globals_dict` - variables don't leak between notebooks |
| **Execution Queue** | `asyncio.Queue` + single worker ensures serialized, deterministic execution |
| **Shared Registry** | Explicit `export_var()` / `import_var()` for controlled variable sharing |
| **Streaming Output** | Real-time stdout/stderr via SSE (Server-Sent Events) |
| **Execution Logging** | Audit trail with timestamps, queue order, duration, success status |

```python
# Notebook Isolation
notebook_vars = {
    "notebook_A": {"__builtins__": ..., "x": 42},
    "notebook_B": {"__builtins__": ..., "y": 100}
}
# x from notebook_A is NOT visible in notebook_B
```

### 2. Cell Component (`Cell.tsx`)

Rich code editor with:

- **Line Numbers** - Always visible with proper alignment
- **Syntax Highlighting** - Prism.js for Python
- **Real-time Syntax Checking** - Detects errors before execution:
  - ● Red: Missing colons, unclosed brackets
  - ⚠ Yellow: Mixed tabs/spaces, odd indentation
- **Running Indicator** - Yellow ▶ on line 1 during execution
- **Error Line Highlighting** - Red background on error lines

### 3. AI Service (`ai_service.py`)

Two-step intelligent code generation:

1. **Research Agent** - Analyzes task, suggests HuggingFace datasets
2. **Code Generator** - Creates complete, runnable notebooks

Supports multiple providers:
- OpenAI (GPT-4, GPT-3.5)  
- Google (Gemini)
- Anthropic (Claude)
- Groq (Llama, Mixtral)

---

## 🔄 Execution Flow

```
┌─────────┐     ┌──────────────┐     ┌─────────────────┐     ┌────────────┐
│  User   │────▶│  Frontend    │────▶│  Controller     │────▶│   Kernel   │
│ clicks  │     │  (React)     │     │  (FastAPI)      │     │  Manager   │
│  Run    │     │              │     │                 │     │            │
└─────────┘     └──────────────┘     └─────────────────┘     └────────────┘
                      │                      │                      │
                      │  POST /run_cell      │                      │
                      │  {cellId, code,      │                      │
                      │   notebookId}        │                      │
                      │─────────────────────▶│                      │
                      │                      │  queue.put(request)  │
                      │                      │─────────────────────▶│
                      │                      │                      │
                      │      SSE stream      │   exec(code, ns)     │
                      │◀─────────────────────│◀─────────────────────│
                      │   {type: "output",   │                      │
                      │    data: "Hello"}    │                      │
                      │                      │                      │
                      │   {type: "complete", │                      │
                      │    success: true}    │                      │
                      │◀─────────────────────│◀─────────────────────│
```

---

## 🚀 Quick Start

### Prerequisites

- Python 3.12+
- Node.js 18+
- npm or pnpm

### Installation

```bash
# Clone the repository
git clone https://github.com/your-repo/notebook-ide.git
cd notebook-ide

# Start Backend
cd apps/controller-fastapi
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# Start Frontend (new terminal)
cd apps/desktop-ui
npm install
npm run dev
```

Open **http://localhost:3000** in your browser.

---

## 📡 API Endpoints

### Execution

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/execution/run_cell` | POST | Execute single cell (non-streaming) |
| `/execution/run_cell_stream` | POST | Execute with SSE streaming output |
| `/execution/run_all` | POST | Execute all cells in order |
| `/execution/queue` | GET | Get execution queue status |
| `/execution/export` | POST | Export variable to shared registry |
| `/execution/import` | POST | Import variable from registry |
| `/execution/reset` | POST | Reset notebook namespace |
| `/execution/logs` | GET | Get execution audit logs |

### Kernel

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/kernels/start` | POST | Start kernel |
| `/kernels/stop` | POST | Stop kernel |
| `/kernels/restart` | POST | Restart kernel (clears all state) |
| `/kernels/status` | GET | Get kernel info |

### AI

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/ai/generate` | POST | Generate notebook operations |
| `/ai/fix-error` | POST | Fix code errors with AI |
| `/ai/providers` | GET | List available AI providers |

---

## 🔒 Security Model

> **⚠️ Single-Tenant Trusted Execution**

- Uses Python's `exec()` with full access
- No sandboxing - code can access filesystem, network, etc.
- Designed for **local, trusted use only**
- Not suitable for untrusted code or multi-user deployments

---

## 📊 Comparison

| Feature | OPREL Studio | Jupyter | Google Colab |
|---------|:------------:|:-------:|:------------:|
| Startup Time | ⚡ Instant | 🐢 Moderate | 🐢 Slow |
| Notebook Isolation | ✅ Per-notebook | ❌ Per-kernel | ❌ Per-runtime |
| Streaming Output | ✅ SSE | ✅ ZMQ | ✅ WebSocket |
| AI Integration | ✅ Built-in | ❌ Extensions | ✅ Limited |
| Syntax Checking | ✅ Real-time | ❌ None | ❌ None |
| Error Line Highlight | ✅ Yes | ❌ No | ❌ No |
| Deployment | 🏠 Local | 🏠/☁️ Both | ☁️ Cloud |
| Multi-user | ❌ Single | ✅ JupyterHub | ✅ Native |

---

## 🛠️ Development

### Running Tests

```bash
cd apps/controller-fastapi
pytest -v
```

### Building for Production

```bash
cd apps/desktop-ui
npm run build
```

---

## 📝 License

MIT License - See [LICENSE](LICENSE) for details.

---

## 🙏 Acknowledgments

- [FastAPI](https://fastapi.tiangolo.com/) - Modern Python web framework
- [React](https://react.dev/) - UI library
- [Vite](https://vitejs.dev/) - Build tool
- [Tailwind CSS](https://tailwindcss.com/) - Styling
- [Prism.js](https://prismjs.com/) - Syntax highlighting
- [LangChain](https://langchain.com/) - LLM integration
