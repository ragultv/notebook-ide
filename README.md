# OctoML — AI-Native Desktop Notebook IDE

A project-centric, AI-native desktop notebook for data scientists. Runs locally as an Electron app with a Node.js/TypeScript controller and isolated Python kernels per notebook.

![OctoML](https://img.shields.io/badge/OctoML-Notebook-red?style=for-the-badge)
![Python](https://img.shields.io/badge/Python-3.12+-blue?style=flat-square)
![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square)
![Fastify](https://img.shields.io/badge/Fastify-5-000000?style=flat-square)
![Electron](https://img.shields.io/badge/Electron-31-47848F?style=flat-square)

---

## Architecture Overview

OctoML is built as three cooperating processes:

```
┌─────────────────────────────────────────────────────────┐
│                   Electron 31 Shell                      │
│  ┌────────────────────┐   ┌──────────────────────────┐  │
│  │   desktop-ui       │   │   controller-node        │  │
│  │   (React + Vite)   │◄──►   (Fastify + TypeScript) │  │
│  │                    │ WS │                          │  │
│  │  Monaco Editor     │   │  KernelManager           │  │
│  │  Zustand Store     │   │  ExecutionQueue          │  │
│  │  MIME Renderers    │   │  ExecutionEngine         │  │
│  │  ipywidgets        │   │  AIService               │  │
│  └────────────────────┘   │  NotebookManager         │  │
│                           │  TerminalManager         │  │
│                           └──────────┬───────────────┘  │
│                                      │ stdio JSON        │
│                           ┌──────────▼───────────────┐  │
│                           │   kernel-python          │  │
│                           │   IPython bridge         │  │
│                           │   One process per        │  │
│                           │   notebook               │  │
│                           └──────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

---

## Apps

### `apps/desktop-ui` — React Frontend

| Component | Description |
|---|---|
| `MonacoCellEditor` | Monaco Editor with auto-height, IntelliSense completions, Shift+Enter to run |
| `Cell` | Per-cell gutter — run / stop / queued-cancel buttons, execution timer, AI error fix |
| `CellOutputView` | Streaming output buffer; appends chunks without re-rendering the full tree |
| `OutputItem` + `MimeBundleRenderer` | MIME priority router (see MIME section below) |
| `PlotlyOutputFrame` | Sandboxed `srcdoc` iframe with Plotly 2.27; supports 2D and 3D WebGL |
| `VegaOutputFrame` | Sandboxed `srcdoc` iframe with Vega 5 / Vega-Lite 5 / vega-embed 6 |
| `HtmlOutputFrame` | Sandboxed `srcdoc` iframe for HTML, SVG, pandas DataFrames, Bokeh |
| `AnsiRenderer` | Full ANSI escape parser — 16-color, 256-color, truecolor, bold/italic/underline |
| `NotebookWSContext` | Translates WebSocket messages into Zustand execution store actions |
| `WidgetRenderer` | ipywidgets rendering via `@jupyter-widgets/html-manager` |
| `TerminalOutput` | Integrated terminal via xterm.js connected to node-pty |

**State management:** Zustand execution store holds per-cell state: `idle → queued → running → stopping → success/error`. Only the affected cell re-renders on state change.

---

### `apps/controller-node` — Fastify Backend (TypeScript / Node.js)

| Module | Description |
|---|---|
| `KernelManager` | Owns Python bridge processes; FIFO serial queue per notebook via Promise chaining |
| `ExecutionQueue` | Named queue per notebook for `run_all` / `run_above` / `run_below` / `run_selection` |
| `ExecutionEngine` | Orchestrates multi-cell runs; emits `cell:started`, `cell:completed`, `cell:failed` |
| `BridgeProcess` | Manages the Python bridge subprocess over stdio JSON protocol |
| `KernelPool` | Pre-warms Python bridge processes for instant cold-start |
| `NotebookManager` | In-memory notebook model; tracks cell sources and outputs |
| `NotebookSerializer` | `.ipynb` read/write (Jupyter notebook format compatible) |
| `AIService` | LLM integration via LangChain — Anthropic / OpenAI / Groq |
| `RAGService` | Retrieval-augmented generation over project files |
| `TerminalManager` | node-pty interactive terminal sessions |
| `EventBus` | Internal pub/sub for decoupled event propagation |
| `SessionManager` | Per-notebook session lifecycle |
| `PersistenceManager` | better-sqlite3 storage for sessions and AI memory |

---

### `apps/kernel-python` — Python IPython Bridge

A lightweight Python process (`kernel_bridge.py`) that:

- Runs an **IPython `InteractiveShell`** instance
- Accepts JSON messages over **stdin**: `execute`, `interrupt`, `restart`, `stdin_reply`, `get_variables`, `complete`
- Streams results over **stdout**: `stream`, `result`, `display`, `error`, `status`, `input_request`, `comm_open`, `comm_msg`
- Handles all IPython magic commands natively (`%matplotlib`, `%%time`, `!pip install`, etc.)
- Captures rich MIME output: `application/vnd.plotly.v1+json`, `application/vnd.vegalite.v5+json`, `image/png`, `text/html`, and more

---

### `apps/electron` — Desktop Shell

Hosts `desktop-ui` in a `BrowserWindow` and spawns `controller-node` as a child process. Packages everything into a single distributable via `electron-builder`.

---

## WebSocket Protocol (`/ws/:notebookId`)

| Direction | Message | Purpose |
|---|---|---|
| Browser → Server | `execute` | Run a single cell |
| Browser → Server | `run_all`, `run_above`, `run_below`, `run_selection` | Batch execution |
| Browser → Server | `interrupt` | Send SIGINT to kernel; unblocks queue for next cell |
| Browser → Server | `restart` | Drain queue + interrupt + restart Python bridge |
| Browser → Server | `stop_execution` | Drain queue + interrupt (cancel all pending) |
| Browser → Server | `stdin_reply` | Respond to `input()` prompt |
| Browser → Server | `comm_msg` | ipywidgets comm protocol |
| Server → Browser | `execution_started` | Cell accepted → UI shows yellow Queued |
| Server → Browser | `cell_started` | Kernel dequeued and running it → UI shows green Running |
| Server → Browser | `output` | Streaming chunk (stream / result / display / error) |
| Server → Browser | `execution_complete` | Cell finished successfully |
| Server → Browser | `execution_error` | Cell finished with error |
| Server → Browser | `cell_interrupted` | Kernel acknowledged interrupt |
| Server → Browser | `cell_cancelled` | Cell removed from queue before running |
| Server → Browser | `input_request` | Kernel called `input()` — show stdin prompt |
| Server → Browser | `kernel_status` | Kernel idle / busy |
| Server → Browser | `comm_open`, `comm_msg`, `comm_close` | ipywidgets comm events |

---

## Execution State Machine

```
idle ──► queued ──► running ──► success
                      │
                   stopping ──► error
```

- **Queued** (yellow): server confirmed the cell was accepted into the execution queue
- **Running** (green): kernel dequeued the cell and is actively executing it
- **Stopping**: SIGINT sent; kernel raises `KeyboardInterrupt`; the next queued cell starts automatically
- **Success / Error**: final state; outputs persisted in Zustand store

When **Stop** is clicked on a running cell, only that cell is interrupted. All other queued cells continue in order.

---

## MIME Output Priority

Output rendering follows the same priority order as VS Code notebooks:

```
application/vnd.jupyter.widget-view+json   → ipywidgets
application/vnd.plotly.v1+json             → Plotly (2D + 3D WebGL)
application/vnd.vega.v5+json               → Vega
application/vnd.vegalite.v4+json           → Vega-Lite v4
application/vnd.vegalite.v5+json           → Vega-Lite v5
application/vnd.altair.v1+json             → Altair (= Vega-Lite)
application/json                            → formatted JSON
application/javascript                      → sandboxed script
text/html                                   → sandboxed iframe
image/svg+xml                               → sandboxed iframe
text/markdown                               → rendered markdown
text/latex                                  → monospace
image/png, image/jpeg, image/gif            → <img>
text/plain                                  → ANSI renderer
```

All rich outputs (Plotly, Vega, HTML, SVG, JS) render inside sandboxed `srcdoc` iframes with `allow-scripts allow-same-origin allow-popups allow-downloads`. Heights are auto-sized via `postMessage`.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | Electron 31 |
| Frontend | React 19, Vite 6, TypeScript, Tailwind CSS 3 |
| Editor | Monaco Editor 0.55 (`@monaco-editor/react`) |
| State | Zustand 4 |
| Backend | Fastify 5, TypeScript, Node.js (ESM) |
| Python kernel | IPython, Python 3.12+ |
| Terminal | node-pty + xterm.js |
| AI / LLM | LangChain — `@langchain/anthropic`, `@langchain/openai`, `@langchain/groq` |
| Widgets | `@jupyter-widgets/html-manager` |
| Charts | Plotly 2.27 (CDN), Vega 5 / Vega-Lite 5 (CDN) |
| Database | better-sqlite3 (sessions, AI memory) |
| Packaging | electron-builder |

---

## Development

```bash
# Install all workspaces
npm install

# Start controller (port 3001)
cd apps/controller-node && npm run dev

# Start UI (port 5000)
cd apps/desktop-ui && npm run dev

# Start Electron shell (opens the desktop app)
cd apps/electron && npm run dev
```

Notebooks are stored as standard `.ipynb` files (Jupyter-compatible).

---

## Project Structure

```
notebook-ide/
├── apps/
│   ├── controller-node/            # Fastify 5 backend
│   │   └── src/
│   │       ├── core/
│   │       │   ├── KernelManager.ts        # Python bridge lifecycle + serial queue
│   │       │   ├── BridgeProcess.ts        # stdio IPC to Python
│   │       │   ├── KernelPool.ts           # Pre-warmed kernel pool
│   │       │   ├── TerminalManager.ts      # node-pty terminal sessions
│   │       │   ├── EventBus.ts             # Internal pub/sub
│   │       │   ├── SessionManager.ts       # Per-notebook session lifecycle
│   │       │   ├── PersistenceManager.ts   # better-sqlite3 persistence
│   │       │   ├── notebook/
│   │       │   │   ├── ExecutionEngine.ts    # run_all / run_above / run_below
│   │       │   │   ├── ExecutionQueue.ts     # Per-notebook FIFO queue
│   │       │   │   ├── NotebookManager.ts    # In-memory notebook model
│   │       │   │   └── NotebookSerializer.ts # .ipynb read/write
│   │       │   └── ai/
│   │       │       ├── AIService.ts          # LLM chat + code generation
│   │       │       └── RAGService.ts         # Project-file retrieval
│   │       └── routes/
│   │           └── websocket.ts            # WS message router
│   │
│   ├── desktop-ui/                 # React 19 frontend
│   │   └── src/
│   │       ├── components/
│   │       │   └── Notebook/
│   │       │       ├── Cell.tsx                  # Cell gutter + controls
│   │       │       ├── MonacoCellEditor.tsx       # Monaco auto-height editor
│   │       │       ├── NotebookWSContext.tsx      # WS → Zustand bridge
│   │       │       └── CellOutput/
│   │       │           ├── CellOutputView.tsx         # Streaming buffer
│   │       │           ├── OutputItem.tsx             # MIME router
│   │       │           ├── MimeBundleRenderer.tsx     # Priority resolver
│   │       │           ├── PlotlyOutputFrame.tsx      # Plotly iframe
│   │       │           ├── VegaOutputFrame.tsx        # Vega iframe
│   │       │           ├── HtmlOutputFrame.tsx        # HTML/SVG iframe
│   │       │           └── AnsiRenderer.tsx           # ANSI escape parser
│   │       └── store/
│   │           └── execution.store.ts        # Cell execution state (Zustand)
│   │
│   ├── kernel-python/              # Python IPython bridge
│   │   └── bridge/
│   │       └── kernel_bridge.py    # IPython shell + stdio JSON protocol
│   │
│   └── electron/                   # Electron shell + electron-builder packaging
│
└── package.json                    # npm workspaces root
```

---

## License

MIT
