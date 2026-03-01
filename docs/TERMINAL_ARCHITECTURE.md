# Terminal Architecture Migration

## Overview

This document describes the new terminal execution architecture that has been migrated from the legacy direct-process execution to a robust stdio-based Python Bridge architecture using `jupyter_client`.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│  Browser (Electron + React)                                  │
│  xterm.js | CodeMirror | Rich Output Panel                   │
└──────────────────────┬──────────────────────────────────────┘
                       │ WebSocket (one per notebook)
                       │ JSON messages only
┌──────────────────────▼──────────────────────────────────────┐
│  Node.js Server                                              │
│  ONLY does:                                                  │
│  • WebSocket server                                          │
│  • spawn/kill Python Bridge per notebook                     │
│  • pipe Browser WS ↔ Bridge stdio                           │
│  NEVER does:                                                 │
│  • ZMQ, HMAC, frame parsing, protocol logic                  │
└──────────────────────┬──────────────────────────────────────┘
                       │ stdio (stdin/stdout)
                       │ newline-delimited JSON
                       │ child_process.spawn — NOT WebSocket
┌──────────────────────▼──────────────────────────────────────┐
│  Python Bridge (one process per notebook)                    │
│  • owns jupyter_client entirely                              │
│  • AsyncKernelManager + AsyncKernelClient                    │
│  • listens IOPub → formats → writes to stdout               │
│  • handles interrupt, shutdown, input(), heartbeat           │
│  • runs silent introspection for AI agent                    │
│  • writes connection file to disk (crash recovery)           │
└──────────────────────┬──────────────────────────────────────┘
                       │ ZMQ (5 channels — internal to Python)
                       │ Node never sees this
┌──────────────────────▼──────────────────────────────────────┐
│  IPython Kernel (one process per notebook)                   │
│  • isolated globals namespace                                │
│  • full IPython execution semantics                          │
│  • execution_count, rich output, input(), interrupt          │
└─────────────────────────────────────────────────────────────┘
```

## Key Design Decisions

### Why stdio instead of Internal WebSocket

**WebSocket is designed for browser-to-server over a network.** Using it between two processes on the same machine means:
- Full TCP stack roundtrip on localhost for every single message
- Port assignment required per notebook (5 notebooks = 5 ports to manage)
- WebSocket HTTP upgrade handshake on every bridge start
- One more failure point — port conflicts, bind failures

**stdio is the correct IPC for parent→child processes.** Node spawns the Python Bridge via `child_process.spawn`. They share pipes by default. This means:
- Zero network stack — kernel-level pipe, sub-millisecond latency
- No port management — pipes are file descriptors, auto-assigned
- No handshake — pipes are ready the moment the process starts
- Works identically on Windows, macOS, Linux
- If the bridge dies, Node knows immediately via process `exit` event

### Guiding Principle

> Node routes JSON. Python owns execution. Browser renders output. Nothing else.

Every architectural decision follows from this principle. If Node is doing anything except routing JSON, it is an anti-pattern.

## File Structure

### Backend (controller-node)

```
src/core/
├── BridgeProcess.ts      # Manages Python Bridge child process per notebook
├── KernelManager.ts      # Registry of all active bridges, lifecycle management
└── KernelPool.ts         # Pre-warmed kernel pool for instant startup

src/routes/
└── websocket.ts          # WebSocket server for browser communication
```

### Python Bridge (kernel-python)

```
bridge/
├── __init__.py
└── kernel_bridge.py      # Python Bridge using jupyter_client
```

### Frontend (desktop-ui)

```
src/hooks/
└── useNotebookWebSocket.ts   # WebSocket hook for notebook communication

src/components/
└── CellOutputTerminal.tsx    # xterm.js-based cell output component
```

## Message Schema

### Browser → Node → Bridge → Kernel

```typescript
// Execute a cell
{
  type: "execute",
  notebook_id: "abc123",
  cell_id: "cell_007",
  code: "print('hello')",
  execution_id: "uuid-generated-by-node"
}

// Interrupt running cell
{
  type: "interrupt",
  notebook_id: "abc123"
}

// Restart kernel (wipes all variables)
{
  type: "restart",
  notebook_id: "abc123"
}

// Reply to input() prompt
{
  type: "stdin_reply",
  notebook_id: "abc123",
  execution_id: "uuid-of-the-execution-that-asked",
  value: "user typed this"
}

// Get variable state for AI agent
{
  type: "get_variables",
  notebook_id: "abc123"
}

// Shutdown kernel cleanly
{
  type: "shutdown",
  notebook_id: "abc123"
}
```

### Bridge → Node → Browser

```typescript
// Execution started
{
  type: "status",
  notebook_id: "abc123",
  execution_id: "uuid",
  state: "busy"
}

// stdout or stderr from print()
{
  type: "stream",
  notebook_id: "abc123",
  execution_id: "uuid",
  name: "stdout",
  text: "hello\n"
}

// Return value of last expression (e.g. df.head())
{
  type: "result",
  notebook_id: "abc123",
  execution_id: "uuid",
  execution_count: 4,
  data: {
    "text/plain": "   col1  col2\n0     1     2",
    "text/html": "<table>...</table>"
  }
}

// Plot or image (matplotlib, seaborn, etc.)
{
  type: "display",
  notebook_id: "abc123",
  execution_id: "uuid",
  data: {
    "image/png": "base64encodedstring...",
    "text/plain": "<Figure size 800x600>"
  }
}

// Exception
{
  type: "error",
  notebook_id: "abc123",
  execution_id: "uuid",
  ename: "ZeroDivisionError",
  evalue: "division by zero",
  traceback: "full ANSI colored traceback string"
}

// Execution complete
{
  type: "status",
  notebook_id: "abc123",
  execution_id: "uuid",
  state: "idle",
  execution_count: 4
}

// Kernel is asking for input()
{
  type: "input_request",
  notebook_id: "abc123",
  execution_id: "uuid",
  prompt: "Enter your name: ",
  password: false
}

// Variable state for AI agent
{
  type: "variables",
  notebook_id: "abc123",
  data: [
    {
      name: "df",
      type: "DataFrame",
      shape: [1000, 12],
      columns: ["age", "income"],
      null_counts: {"age": 0, "income": 45},
      memory_mb: 0.96
    }
  ]
}

// Kernel heartbeat died
{
  type: "kernel_dead",
  notebook_id: "abc123"
}

// Bridge is ready (sent once on startup)
{
  type: "ready",
  notebook_id: "abc123"
}
```

## Crash Recovery

### Bridge Crash

1. Node detects via process 'exit' event
2. Waits 1 second
3. Spawns new bridge with --reconnect path/to/connection_file.json
4. New bridge connects to still-running IPython kernel
5. User's variables are 100% preserved
6. User sees a brief "reconnecting..." message

### IPython Kernel Crash

1. Bridge detects via heartbeat failure
2. Bridge sends {"type": "kernel_dead"} to Node → Browser
3. Browser shows "Kernel died — restart?" prompt
4. User clicks restart → fresh kernel, variables lost (expected behavior)

### Node Crash

1. All WebSocket connections drop
2. All bridges keep running (they're child processes but survive parent death)
3. IPython kernels keep running (they're child processes of bridges)
4. When Node restarts, it reconnects to all existing bridges via connection files

## Pre-Warmed Kernel Pool

To eliminate cold-start latency (IPython kernel start = 2-4 seconds), a pool of pre-warmed kernels is maintained:

```typescript
// On server startup
await initPool();  // Starts 2 kernels ready to go

// When notebook opens
const bridge = await claimFromPool(notebookId);  // Instant!

// Pool immediately warms a replacement kernel
```

## Migration from Legacy Architecture

### What Changed

| Component | Old | New |
|-----------|-----|-----|
| Process Model | Single Python process with exec() | One IPython kernel per notebook via jupyter_client |
| Communication | HTTP REST + SSE | WebSocket + stdio JSON |
| Output Capture | stdout/stderr redirection | IOPub ZMQ socket |
| Rich Output | Manual matplotlib capture | Native Jupyter display_data |
| Interrupt | Limited (process kill) | Proper kernel interrupt |
| input() | Not supported | Full support via stdin channel |
| Crash Recovery | None | Automatic reconnection |

### Backwards Compatibility

The HTTP REST API is preserved for non-execution endpoints (file system, AI, etc.). Execution endpoints now proxy to the WebSocket/Bridge architecture internally.

## Testing

To verify the architecture:

1. Start the controller-node server
2. Open a notebook in the desktop-ui
3. Execute code cells — should see instant startup (from pool)
4. Test rich output: matplotlib plots, pandas DataFrames
5. Test input(): `name = input("Enter name: ")`
6. Test interrupt: Run `while True: pass` then click interrupt
7. Test crash recovery: Kill the bridge process, should auto-reconnect

## Dependencies

### Backend
- `jupyter_client` - IPython kernel management
- `ws` - WebSocket server
- `uuid` - Execution ID generation

### Python Bridge
- `jupyter_client` - AsyncKernelManager/Client
- `ipykernel` - IPython kernel

### Frontend
- `@xterm/xterm` - Terminal output rendering
- `@xterm/addon-fit` - Terminal auto-resize
