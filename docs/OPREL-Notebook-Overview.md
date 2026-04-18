**OPREL Notebook — High Level Overview**

This document is a concise, team-facing overview of the OPREL Notebook (formerly the deprecated README). It is intended for the upcoming team meeting and covers architecture, current status, core components, developer run instructions, and next steps.

**Overview**:
- **Purpose**: OPREL Notebook is a desktop Notebook IDE (Electron-ready React UI + Node controller) that provides isolated, per-notebook kernels, AI-assisted code generation/fixing, and multi-notebook parallel execution.
- **Product**: Desktop app (React UI packaged with an Electron wrapper in the product roadmap). The UI is implemented in [apps/desktop-ui](apps/desktop-ui).
- **Backends**: Primary controller is Node-based (Fastify webserver in [apps/controller-node](apps/controller-node)). There is also an experimental FastAPI controller present in [apps/controller-fastapi] (not used by default).

**Current Completion & Supported Languages**:
- **Fully supported**: Python notebooks — execution, streaming output, plot capture, variable snapshots, completions, and memory maps.
- **Working / In development**: Julia and Mojo kernel support (both in active development; Julia is integrated, Mojo is progressing).
- **Planned**: R language support (future work).

**Key Product Features**:
- **Isolated Per-Notebook Kernels**: Each notebook gets its own kernel subprocess with isolated memory. Multiple kernels run concurrently without interfering.
- **Multi-Notebook Parallelism**: Run many notebooks simultaneously in the same app instance; KernelManager maps notebookId -> worker process.
- **AI Copilot**: In-app AI assistant that can create notebooks, generate cell code, edit/fix cells, and produce structured notebook operations.
- **Execution Modes**: Standard kernel execution and terminal-style execution for commands prefixed with `!` (handled by TerminalWorker).
- **Streaming & Rich Outputs**: Worker captures stdout/stderr and returns images (matplotlib), streaming events, and structured JSON responses.

**Architecture (High-level)**
- **Controller (apps/controller-node)**: Fastify server exposing HTTP/WebSocket endpoints for kernels, execution, files, models, AI, and memory. Serves as the central orchestrator and the single source of truth for kernel lifecycle. See [apps/controller-node/src/index.ts](apps/controller-node/src/index.ts#L1).
- **Kernel Manager**: Single instance manager that creates/stops kernels and routes code execution. Each kernel is represented by a Worker (PythonWorker, JuliaWorker). See [apps/controller-node/src/core/KernelManager.ts](apps/controller-node/src/core/KernelManager.ts#L1).
- **Kernel Workers**:
  - **PythonWorker**: Spawns the separate Python process using `kernel-python/worker_entry.py`. Communication is JSON-RPC over stdin/stderr. Handles execute, snapshot, completions, resource limits, and graceful shutdown. See [apps/controller-node/src/core/PythonWorker.ts](apps/controller-node/src/core/PythonWorker.ts#L1) and [apps/kernel-python/worker_entry.py](apps/kernel-python/worker_entry.py#L1).
  - **JuliaWorker**: Similar pattern (implemented in controller core). TerminalWorker handles shell-like commands.
- **Desktop UI (apps/desktop-ui)**: React + Vite app using Monaco editor and XTerm for terminal features. It manages notebooks, tabs, cell operations, and integrates the AI right sidebar. Entry React component: [apps/desktop-ui/src/App.tsx](apps/desktop-ui/src/App.tsx#L1).

**Execution Flow (typical)**
1. User runs a cell from the UI.
2. UI calls Controller execution route (via HTTP/WebSocket).
3. `KernelManager` ensures a kernel exists for the notebookId; auto-starts if necessary.
4. Kernel worker process (PythonWorker/JuliaWorker) receives a JSON `EXECUTE` request on stdin.
5. Worker executes code in an isolated namespace, captures stdout/stderr and outputs (images), and writes a JSON result to stderr.
6. Controller forwards results (and streaming events) back to UI for rendering.

**AI Copilot**
- The copilot is integrated into the controller and UI. It can inspect notebook cells, generate structured operations (add/edit/exec cells), and call the execution pipeline directly so generated code can be run immediately. AI endpoints live under [apps/controller-node/src/routes/ai.ts](apps/controller-node/src/routes/ai.ts) (see codebase for details).

**Notable Implementation Details**
- **IPC channel**: Python worker uses stderr for JSON messages to avoid conflicts with stdout capture. The worker sends `status: ready` on startup and structured messages for streams, completions, snapshots, and execution results.
- **Magic commands**: Commands prefixed with `!` are interpreted as terminal commands and executed via `TerminalWorker` or `_magic_run` in the Python worker; pip commands are forwarded to `python -m pip` to keep environment consistency.
- **Completions**: The Python worker uses `jedi` when available, otherwise falls back to namespace-based suggestions.
-- **Memory Snapshot & Visualization**: The worker can produce a memory snapshot (variables, sizes, 2D coordinates) which is visualized by the `MemoryMap` UI component (`apps/desktop-ui/src/components/MemoryMap.tsx`). The visualization supports zoom, pan, hover tooltips, filtering, and quick navigation to variables.
- **Graceful Shutdown**: Controller listens for SIGINT/SIGTERM and stops all kernels, closing the memory store.

**Developer: How to run (dev)**
- Prereqs: Node.js (18+), Python 3.10+, pip, (optional) Julia if using Julia kernel.
- Start controller (Node):

  - Open terminal in `apps/controller-node` and run:

    npm install
    npm run dev (or `node ./src/index.ts` with tsx / build step)

- Start desktop UI (dev):

  - Open terminal in `apps/desktop-ui` and run:

    npm install
    npm run dev

- Python worker dependencies: install inside a Python environment (see `apps/kernel-python/requirements.txt`). Worker will be spawned by the controller when a Python kernel starts.

**Important Files (quick links)**
- Controller entry: [apps/controller-node/src/index.ts](apps/controller-node/src/index.ts#L1)
- Kernel manager: [apps/controller-node/src/core/KernelManager.ts](apps/controller-node/src/core/KernelManager.ts#L1)
- Python worker (Node wrapper): [apps/controller-node/src/core/PythonWorker.ts](apps/controller-node/src/core/PythonWorker.ts#L1)
- Python worker (actual worker): [apps/kernel-python/worker_entry.py](apps/kernel-python/worker_entry.py#L1)
- Desktop UI root: [apps/desktop-ui/src/App.tsx](apps/desktop-ui/src/App.tsx#L1)

**Current Gaps / Known Limitations (for meeting)**
- Electron packaging not included in this repo snapshot — UI is a Vite React app ready to be wrapped.
- R support not implemented yet (planned).
- Some Julia features are marked "working" but may need UX polish and additional error handling for parity with Python.
- GPU runtime support is gated by worker preflight checks (PyTorch). Clear developer instructions and CI for GPU testing are desirable.

**Roadmap & Next Steps**
- Short-term (next sprint):
  - Solidify Julia kernel UX and error cases.
  - Add packaged Electron build and distribution pipeline.
  - Improve AI model management UI and persistence.
- Mid-term:
  - Add R kernel support.
  - Add tests for worker IPC stability and resource limit enforcement.
  - Add automated end-to-end test for multi-notebook parallel execution.

**Meeting Talking Points**
- Demonstrate a Python notebook running with live stdout, image outputs, and memory map snapshot.
- Show how the AI copilot edits a cell and executes generated code.
- Explain per-notebook kernel isolation and how KernelManager handles lifecycle.
- Discuss packaging plan (Electron) and timeline for R support.

If you'd like, I can:
- expand this into a presentation deck (slides), or
- add a developer quickstart `docs/DEVELOPER-SETUP.md` with exact commands and common troubleshooting steps.
