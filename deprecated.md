# Deprecated Files Registry

> These files are **retained for historical reference** but are **dead code** — they are not called
> from the active execution path. Do not extend or import from them. They are candidates for
> deletion after a full audit cycle.

---

## Dead Code — Python Side

### `apps/kernel-python/isolated_kernel.py`

**Status**: Dead  
**Evidence**:
- Imported in `apps/kernel-python/__init__.py` and `apps/kernel-python/kernel_manager.py`
- `kernel_manager.py` is **never imported or invoked** from the Node.js controller or any active route
- The active execution path goes: `BridgeProcess.ts` → `kernel_bridge.py` → `jupyter_client.AsyncKernelManager`
- `isolated_kernel.py` defines `TrulyIsolatedKernel`, a custom subprocess executor using raw `exec()` + Unix `resource.setrlimit` — this path is entirely bypassed

**Why kept**: Contains the `resource.setrlimit` approach that may be relevant when implementing Docker/container sandboxing in P2.

---

### `apps/kernel-python/worker_entry.py`

**Status**: Dead  
**Evidence**:
- Referenced only from `isolated_kernel.py` (line 216: `worker_script = Path(__file__).parent / "worker_entry.py"`)
- `isolated_kernel.py` itself is dead (see above)
- The only Node.js file that referenced `worker_entry.py` was `PythonWorker.ts` (line 55–59), which is itself dead (see below)

**Why kept**: Companion to `isolated_kernel.py`.

---

### `apps/kernel-python/kernel_manager.py`

**Status**: Dead  
**Evidence**:
- Never imported from Node.js (`grep -r "kernel_manager" apps/controller-node/src` → no results)
- Was part of the deprecated `controller-fastapi` architecture
- Only imports from within `apps/kernel-python/__init__.py`

**Why kept**: Documents an alternative kernel orchestration design using Python-side process management.

---

## Dead Code — Node.js Side

### `apps/controller-node/src/core/PythonWorker.ts`

**Status**: Dead — superseded by P1-1  
**Evidence**:
- Only imported by `TerminalWorker.ts` (for the `ExecutionResult` type — a type-only import)
- Never imported in any active route
- Spawns `worker_entry.py` (dead Python file) via `execa`
- Was the original non-Jupyter execution engine — superseded by `BridgeProcess.ts` + `kernel_bridge.py`
- **P1-1 (node-pty terminal) has been implemented via `TerminalManager.ts` — this file has no remaining dependency**

**Why kept**: Per user directive — no deletions.

---

### `apps/controller-node/src/core/TerminalWorker.ts`

**Status**: Dead — superseded by P1-1  
**Evidence**:
- Never imported in any route or `index.ts`
- **P1-1 implemented** — `TerminalManager.ts` now owns all node-pty PTY session management
- `TerminalWorker.ts` was the prototype/reference; it is now fully replaced
- The `TerminalWorker.ts` PTY logic was used as the design reference for `TerminalManager.ts`

**Why kept**: Per user directive — no deletions.

---

## Deprecated Apps

### `apps/controller-fastapi/` (entire directory)

**Status**: Deprecated  
**Evidence**:
- A FastAPI-based Python controller, predating the current Fastify/Node.js architecture
- No references from `desktop-ui` or `controller-node` point to it
- Confirmed deprecated in prior architectural audit session

**Why kept**: Per user directive — no deletions. Documents the original Python-backend design.

---

## Summary Table

| File / Directory | Language | Dead Since | Safe to Delete? | Notes |
|---|---|---|---|---|
| `apps/kernel-python/isolated_kernel.py` | Python | Architecture shift to jupyter_client | Yes | Docker sandbox reference |
| `apps/kernel-python/worker_entry.py` | Python | Architecture shift to jupyter_client | Yes | None |
| `apps/kernel-python/kernel_manager.py` | Python | controller-fastapi deprecation | Yes | None |
| `apps/controller-node/src/core/PythonWorker.ts` | TypeScript | Bridge architecture adoption | ✅ Yes | P1-1 done, no more deps |
| `apps/controller-node/src/core/TerminalWorker.ts` | TypeScript | P1-1 implemented | ✅ Yes | Replaced by TerminalManager.ts |
| `apps/controller-fastapi/` | Python | Node.js controller adoption | Yes | None |
