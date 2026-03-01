# Oprel Notebook IDE - Terminal Subsystem Documentation

The Oprel Notebook IDE seamlessly integrates interactive character-matrix terminal interfaces alongside standard code cell execution. This allows developers and AI models to natively execute long-running server processes, background workers, and rich command-line interfaces (like `oprel serve` or `oprel run`) directly from within a notebook cell.

---

## 1. Types of Executions (Terminals)

Oprel supports two entirely different forms of cell execution. It relies on a specialized prefix `!` to determine how a cell's syntax should be routed in the backend. 

### A. The Python Execution Kernel (Standard)
* **Trigger:** Standard code cells (no prefix).
* **Worker:** Handled by `KernelManager.ts` spinning up `kernel-python/isolated_kernel.py`.
* **Behavior:** Shared memory state, runs python scripts, handles visual `RichOutputs` (images, scatterplots, dataframes).
* **Interactive Mode:** Supports standard synchronous `input()` prompts by sending an `input_request` event over SSE and halting execution until the user submits a string from the HTML UI.
* **Output:** Line-by-line structured arrays, processed and styled in native DOM HTML structures (`OutputItem.tsx`).

### B. The PTY Terminal (Command-Line Mode)
* **Trigger:** Code cells where the string uniquely starts with the `!` prefix (e.g., `!oprel run ...`).
* **Worker:** Handled by `TerminalWorker.ts` which spawns an isolated `node-pty` pseudo-terminal process natively on the host OS.
* **Behavior:** Emulates a real system shell. Retains process lifecycle, captures strict ANSI escape sequences (colors, cursors, loading bars).
* **Interactive Mode:** Fully asynchronous two-way PTY streaming. The user can hit arrow keys, use `/help`, or type real-time characters.
* **Output:** Raw character streams piped directly into a browser-based `xterm.js` canvas display (`TerminalOutput.tsx`). 

---

## 2. PTY Terminal Implementation Breakdown

### Streaming Output Architecture

When a terminal cell is run, the system switches to a real-time streaming model to prevent browser lockups and handle infinite background processes:

1. **Backend Spawn (`TerminalWorker.ts`)**: The backend detects the `!` prefix, parses the command string, and spawns the command via `node-pty`.
2. **SSE Stream Connection**: The `/execution/run_cell_stream` API route is opened. Fastify responds with headers for `text/event-stream` keeping an HTTP connection open.
3. **Data Polling**: As the host process writes out terminal bytes (like a downloading progress bar or AI chat stream), `ptyProcess.onData` receives those chunks.
4. **Transmission**: The backend encapsulates the chunk inside a JSON payload labeled `{ type: "terminal_output", data: "..." }` and flushes it down the SSE pipe.
5. **Frontend Reception**: On the client, `controllerClient.runCellStream` pulls chunks incrementally using `ReadableStreamDefaultReader`, parsing the JSON payloads out of the streaming buffer.
6. **XTerm Pipeline**: `Cell.tsx` acknowledges the `terminal_output` type, immediately mounts the `TerminalOutput` React component, and feeds the stream updates directly into `xtermRef.current.write(chunk)`. `xterm.js` natively decodes the ANSI color codes and paints them realistically to an HTML Canvas element.

### Real-Time Interactive Input Handling (`stdin`)

Unlike standard Python kernels which ask for a password prompt and wait, PTY terminals are "hot" — they listen continuously. 

* The `xterm.js` component binds to user keystrokes via `terminal.onData((data) => { ... })`. 
* When you press a key (like `a`, `ENTER`, `UP_ARROW`, `CTRL+C`), xterm captures the raw control sequence.
* It sends an invisible HTTP POST request to `/execution/input` on the Node controller with `notebookId` and the raw keystroke byte.
* `TerminalWorker.sendInput(data)` writes that byte string raw into the `ptyProcess.write()` buffer of the OS shell. 
* The host OS evaluates it, and conventionally "echoes" the character back through the streaming `stdout` output architecture so it appears on the frontend visually.

### Dynamic Rendering & Terminal Resizing

Because `xterm.js` maps characters to a fixed grid of Columns and Rows (unlike typical HTML `<div>` flows which word-wrap spaces indefinitely), it must align perfectly with the backend OS context:

* We use a `ResizeObserver` bounded around the `TerminalOutput.tsx` layout boundaries. 
* If you expand a sidebar or resize the Notebook window, the observer detects a width layout shift.
* On the frontend: The `FitAddon` recalibrates xterm's internal column/row boundaries based precisely on pixel measurements to prevent text clipping.
* On the backend: The frontend dynamically fires an event to the `/execution/resize` API endpoint with the new `{ cols, rows }`. `TerminalWorker.ts` natively invokes `ptyProcess.resize(cols, rows)`, signaling standard CLI layout engines (like `rich` in python) inside the process to restructure their table spacing for future rows natively.

---

## 3. Auto-Cleanup and Lifecycle

* A terminal stream is only resolved when the OS exits the host background process, sending an HTTP complete message.
* If a process hangs permanently (like `oprel serve`), hitting the Stop Square on the Notebook Cell will manually fire an HTTP request to `/execution/interrupt`. 
* The backend intercepts this through `KernelManager.ts` -> `activeTerminal.stop()` natively dropping a SIGKILL into `node-pty` to instantly reap the process.
* If a cell is re-executed, `TerminalOutput.tsx` traps the stream resetting to chunk `0` and fires `xterm.reset()` locally to flush all historical command history before initiating the new stream.
