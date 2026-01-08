# OPREL Studio — Notebook IDE

A modern, lightweight notebook editor for Python with AI-powered code generation, real-time syntax checking, and true process isolation.

![OPREL Studio](https://img.shields.io/badge/OPREL-Studio-red?style=for-the-badge)
![Python](https://img.shields.io/badge/Python-3.12+-blue?style=flat-square)
![React](https://img.shields.io/badge/React-18+-61DAFB?style=flat-square)
![FastAPI](https://img.shields.io/badge/FastAPI-0.100+-009688?style=flat-square)

---

## ⚡ What is OPREL Studio?

OPREL Studio is a monolithic, single-user Notebook IDE designed for **lightning-fast local development**. 

Unlike Jupyter, which spins up heavy kernels and servers for every instance, OPREL Studio runs on a single **Controller Architecture**. It provides the same interactive experience but with tighter integration between the UI, the Execution Engine, and the AI Assistant.

---

## 🏗️ Architecture: The "True" Design

The core philosophy of OPREL Studio is **Process-Level Isolation managed by a Monolith**.

### 1. The Controller (Monolith)
The FastApi backend acts as the central brain. It manages the HTTP server, the WebSocket connections, and the AI services in a single process. This ensures **zero-latency** state management and instant startup.

### 2. Truly Isolated Kernels
To prevent one notebook from crashing another, OPREL Studio uses **Process Isolation**:
*   **Notebook A** runs in `Worker Process 101` (PID: 1234).
*   **Notebook B** runs in `Worker Process 102` (PID: 5678).

### 3. Isolated Namespaces
Because they run in different processes, they have completely separate memory spaces.
*   Defining `x = 10` in Notebook A writes to Process A's memory.
*   Notebook B cannot see `x` at all.
*   A "Shared Registry" exists in the Controller to explicitly teleport variables between them if needed.

---

## 🔄 Workflow: The Tale of Two Notebooks

Here is exactly how the system handles two active notebooks concurrently:

```mermaid
graph TD
    User([User])
    
    subgraph "Controller (Main Process)"
        Queue[Global Execution Queue]
        Manager[Kernel Manager]
        AI[AI Service]
    end
    
    subgraph "Worker Processes (Truly Isolated)"
        ProcessA[Process A\n(Notebook 1)]
        ProcessB[Process B\n(Notebook 2)]
    end
    
    User --"Run Cell in NB1"--> Queue
    User --"Run Cell in NB2"--> Queue
    User --"Ask AI"--> AI
    
    AI --"Generate Code"--> Queue
    
    Queue --"Serialize"--> Manager
    Manager --"Dispatch"--> ProcessA
    Manager --"Dispatch"--> ProcessB
    
    ProcessA --"Stdout/Stderr"--> Manager
    ProcessB --"Stdout/Stderr"--> Manager
```

### Execution Flow Step-by-Step
1.  **Request**: You click "Run" in **Notebook 1**.
2.  **Queue**: The request enters the `Global Execution Queue` in the Controller.
3.  **Dispatch**: The `Kernel Manager` sees the request belongs to `notebook_id="nb1"`.
4.  **Routing**: It forwards the code to **Process A**.
5.  **Execution**: Process A runs the code, captures `stdout`, and streams it back via SSE.
6.  **Safety**: If Process A enters an infinite loop or crashes (SegFault), **Process B** remains completely unaffected.

---

## 🤖 AI Architecture

The AI is not an plugin—it is a core part of the Controller.

1.  **Context Injection**: When you ask the AI a question, it reads the *current state* of your active notebook cells.
2.  **Operations Generation**: The AI doesn't just return text. It generates structured **JSON Operations** (`add_cell`, `edit_cell`, `exec_cell`).
3.  **Direct Execution**: These operations are fed directly into the `Global Execution Queue`, allowing the AI to write and run code exactly like a human user.

### Comparison to Other Tools

| Feature | Jupyter / Colab | OPREL Studio |
| :--- | :--- | :--- |
| **Isolation** | Hard (Separate Kernels) | **Native** (Managed Processes) |
| **State** | Filesystem Based | **Memory Based** (Shared Registry) |
| **AI Access** | Extension / Plugin | **System Level** (Control Loop) |
| **Crash Safety** | High | **High** (Per-Notebook Process) |

---

## 📝 License
MIT License
