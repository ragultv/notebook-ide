# NOTEBOOK IDE — MASTER PLAN DOCUMENT
### Written for Claude (AI Assistant) to Understand, Reason About, and Operate On

---

## ⚠️ HOW TO READ THIS DOCUMENT (For Claude)

This document is your **single source of truth** for this project.

Before doing anything — writing code, suggesting features, debugging — you must:
1. Read the **Current Architecture** section completely
2. Understand **what exists** vs **what is planned**
3. Know which **mode** the user is operating in before generating any response
4. Follow the **Operation Rules** before modifying anything
5. Never assume — always ask if architecture is unclear

Your job is not just to generate code. Your job is to **understand the system state, reason about consequences, and then act — according to the active mode.**

---

## SECTION 1 — WHAT THIS PRODUCT IS

### One-Line Description
An execution-aware notebook IDE where the AI understands what is **running in memory**, not just what is **written in code**.

### Why This Is Different From Jupyter + Copilot
| Tool | What It Knows |
|------|--------------|
| Jupyter | Code text only |
| Copilot / Cursor | Code text + file structure |
| **This Product** | Code + live variable state + memory + execution order + cell dependencies + failure history |

### Target User
ML/DS engineers who are tired of:
- OOM crashes with no warning
- Forgetting what experiment parameters they used
- Debugging why a pipeline breaks 5 cells later
- Manually setting up MLflow or WandB

---

## SECTION 2 — CURRENT ARCHITECTURE (What Is Already Built)

> Claude: Read this carefully. Do not assume anything beyond what is listed here.

### ✅ What Currently Exists

#### 2.1 Per-Notebook Kernel Isolation
- Every notebook has its own dedicated Python kernel
- Kernels do not share memory or state
- Killing one notebook does not affect others
- **Architecture note:** Each kernel is a separate process. Communication happens via ZMQ or similar IPC.

#### 2.2 Parallel Notebook Execution
- Multiple notebooks can run simultaneously
- Also supports sequential execution mode
- **Architecture note:** Execution queue exists. Scheduler is present.

#### 2.3 AI Code Generation + Debugging
- AI can write code into cells
- AI can identify errors and suggest fixes
- **Current limitation:** AI reads code text only. It does NOT see live variable state yet.
- **Architecture note:** Claude API is used. System prompt currently contains only cell code.

#### 2.4 Memory Visualization
- Visual representation of notebook memory usage
- Shows what objects are consuming memory
- **Architecture note:** This data exists in UI but is NOT yet fed to the AI agent.

### ❌ What Does NOT Exist Yet
- Variable introspection JSON fed to AI
- Cell dependency graph
- Automatic experiment tracking
- Failure state memory
- Pre-execution warnings
- Agent tools (run_cell, get_variable, modify_cell, etc.)

### 🔶 Agent Status: IMMATURE
Current AI integration is a **chat wrapper** only. Sends user message + cell code to Claude API and returns a response. Not yet autonomous.

---

## SECTION 3 — THREE OPERATING MODES

> Claude: This is critical. Before responding to ANY user request, identify which mode is active. Your behavior, tool usage, and response style must match the mode exactly. Never bleed behaviors from one mode into another unless explicitly told.

---

### MODE 1 — ASK (Chat Mode)

**What it is:** A conversational assistant. User asks questions, gets answers. User writes code themselves. AI assists but does not touch the notebook autonomously.

**What Claude should do in this mode:**
- Answer questions about code, data science concepts, debugging
- Suggest code that the user can copy into a cell manually
- Read kernel state JSON if available and answer questions based on it
- Explain what variables mean, what errors indicate, what to try next
- Do NOT call run_cell, modify_cell, or create_cell tools
- Do NOT execute anything autonomously

**Example interactions in ASK mode:**
- "Why is my model overfitting?" → Claude reads kernel state, sees training accuracy 0.99 vs val 0.71, explains overfitting causes
- "What does this error mean?" → Claude explains the traceback
- "How do I normalize this dataframe?" → Claude suggests code, user runs it

**Tone:** Conversational. Teacher-like. Patient. Short responses unless depth is needed.

**Tools available in ASK mode:** `get_variable`, `list_variables`, `compare_experiments`, `get_failure_context` (read-only tools only — no execution, no modification)

---

### MODE 2 — AGENT (Agentic Notebook Mode)

**What it is:** Claude operates as an autonomous agent inside the notebook. It creates cells, writes code into them, executes them, reads results, debugs failures, rewrites, and re-executes until the task is complete.

**What Claude should do in this mode:**
- Break the user's goal into steps before starting
- Create cells with clear comments explaining what each cell does
- Execute cells after writing them
- Read the output and kernel state after each execution
- If a cell fails: read failure context, diagnose, rewrite, re-execute — do not ask user for help unless truly blocked
- Log a short status update to the user after each major step ("Step 2/5 done — data cleaned, 340 nulls dropped")
- Stop and ask user only when: ambiguous requirements, destructive action (deleting data), or after 3 failed attempts at the same cell

**Example interactions in AGENT mode:**
- "Build a baseline classification model on my dataset" → Claude explores data, cleans it, engineers features, trains model, evaluates, logs experiment — all autonomously
- "Debug why my pipeline is failing" → Claude reads failure context, traces dependency graph, identifies root cell, rewrites it, re-executes downstream cells
- "Optimize this model's hyperparameters" → Claude runs multiple experiments, compares results, reports best config

**Tone:** Action-oriented. Brief status updates. Minimal conversation. Show work through actions, not words.

**Tools available in AGENT mode:** ALL tools — `run_cell`, `get_variable`, `list_variables`, `modify_cell`, `create_cell`, `compare_experiments`, `get_failure_context`

**Maximum autonomous iterations before stopping and reporting:** 10 tool calls. After 10, summarize progress and ask user how to proceed.

**Agent Loop Behavior:**
```
User gives task
    → Claude plans steps (internal reasoning, not shown to user)
    → Claude executes step 1 (create cell → run cell → read output)
    → Claude reads kernel state (did state change as expected?)
    → If yes: proceed to step 2
    → If no (error/unexpected): diagnose → fix → retry (max 3 retries per step)
    → After all steps: report summary to user
```

---

### MODE 3 — PLANNER (Planning Only Mode)

**What it is:** Claude reasons and plans but writes ZERO code and touches ZERO cells. Pure strategic thinking. Used when the user wants to think through an approach before committing to it.

**What Claude should do in this mode:**
- Analyze the problem deeply
- Propose a multi-step plan with clear reasoning
- Identify risks, edge cases, and decision points
- Suggest which libraries/approaches to use and why
- Estimate complexity and time for each step
- Present alternatives with tradeoffs
- Do NOT write executable code — pseudocode only if needed for clarity
- Do NOT call any tools except read-only introspection

**Example interactions in PLANNER mode:**
- "I want to build a time series forecasting pipeline — how should I approach it?" → Claude maps out data requirements, preprocessing steps, model options, evaluation strategy, deployment considerations
- "Should I use LSTM or Transformer for this sequence task?" → Claude analyzes tradeoffs given current dataset characteristics visible in kernel state
- "Plan out how to reduce my model's inference time" → Claude identifies bottlenecks and proposes optimization strategies

**Tone:** Thoughtful. Structured. Present options. Ask clarifying questions freely. This mode is for thinking, not doing.

**Tools available in PLANNER mode:** `list_variables`, `get_variable` (read only, for understanding current state to plan around it)

---

### Mode Switching Rules (For Claude)

| Trigger | What to do |
|---------|-----------|
| User says "just tell me" or "explain" | Switch to ASK |
| User says "do it" or "build it" or "fix it" | Switch to AGENT |
| User says "plan" or "how should I" or "what's the best way" | Switch to PLANNER |
| Ambiguous request | Default to ASK, confirm before acting |
| User says "stop" mid-task | Immediately halt AGENT mode, report current state |

---

## SECTION 4 — OPEN SOURCE AGENT FRAMEWORK DECISION

> Claude: This section documents the framework options evaluated and the current decision. Do not suggest switching frameworks unless explicitly asked.

### Frameworks Evaluated

#### OpenCode
- **What it is:** AI coding agent primarily designed for terminal/file-based coding tasks
- **Strengths:** Lean, fast, good at file operations and shell commands
- **Weakness for this project:** Built around file system, not kernel runtime. Does not natively understand notebook cell execution order or live Python object state.
- **Verdict for this project:** Wrong fit. Your differentiation is kernel-awareness, not file-awareness. OpenCode would fight your architecture.

#### Continue
- **What it is:** Open source AI code assistant (VS Code / JetBrains plugin)
- **Strengths:** Good IDE integration, supports custom context providers, supports multiple LLM backends including Claude
- **Weakness for this project:** Designed as an IDE plugin, not an embeddable agent core. The context provider system is useful but you'd be fighting its UI assumptions to embed it in a notebook-specific interface.
- **Verdict for this project:** Borrow ideas from its context provider architecture (how it injects runtime context into prompts). Do not use it as your agent core.

#### Tami (Tammy)
- **What it is:** AI agent framework focused on task automation
- **Strengths:** Task-oriented design
- **Weakness for this project:** Less community support, smaller ecosystem, less documentation for custom tool integration
- **Verdict for this project:** Skip. Not enough documentation to justify the risk at your stage.

#### OpenDevin (now OpenHands)
- **What it is:** Open source autonomous software engineer agent. Runs in a sandboxed environment, can browse web, run code, edit files.
- **Strengths:** Most mature autonomous agent framework. Has sandbox execution, multi-step reasoning, tool use built in. Active development.
- **Weakness for this project:** Designed for general software engineering tasks in a sandbox. Integrating it with your live kernel state requires significant adaptation. Its sandbox model conflicts with your kernel isolation model — you have TWO sandboxing systems that will fight each other.
- **Verdict for this project:** Study its tool design patterns. Do not use it as your core. The kernel conflict alone makes this painful.

#### LangGraph (Prebuilt / LangChain ecosystem)
- **What it is:** Framework for building stateful multi-agent systems as graphs
- **Strengths:** Native Claude integration, stateful graph model is perfect for AGENT mode (EXPLORING → CLEANING → TRAINING → EVALUATING states), large community, `create_react_agent` prebuilt for simple cases
- **Weakness for this project:** Adds dependency weight. Abstraction can hide bugs. Requires learning graph model.
- **Verdict for this project:** Best fit IF you need complex multi-step autonomous workflows. Use `create_react_agent` prebuilt for MODE 2 initially.

---

### FINAL DECISION: Hybrid Approach

```
MODE 1 (ASK)     → Direct Claude API call. No framework needed. Simple.
MODE 2 (AGENT)   → Start with custom loop (50 lines). Migrate to LangGraph if tasks exceed 10 tool calls with branching logic.
MODE 3 (PLANNER) → Direct Claude API call. No framework needed. Simple.
```

**Why custom loop first for AGENT mode:**
- You ship faster
- No framework dependency to debug
- Full control over how kernel state is injected
- Easy to understand and modify
- When you hit its limits (complex branching, parallel tool calls, persistent state across sessions) — THEN migrate to LangGraph

**The custom agent loop (build this in Week 5):**

```python
# agent_loop.py — The core of MODE 2

import json
from anthropic import Anthropic

client = Anthropic()

def run_agent_mode(user_task, kernel_state, tools, tool_handlers, max_iterations=10):
    """
    Core agent loop for MODE 2.
    Runs until Claude stops calling tools or hits max_iterations.
    
    kernel_state: dict — live introspection JSON from kernel poller
    tools: list — tool definitions to give Claude
    tool_handlers: dict — maps tool name to Python function
    """
    
    system = build_system_prompt(kernel_state, mode="AGENT")
    messages = [{"role": "user", "content": user_task}]
    iteration_count = 0
    actions_taken = []
    
    while iteration_count < max_iterations:
        iteration_count += 1
        
        response = client.messages.create(
            model="claude-opus-4-6",
            system=system,
            messages=messages,
            tools=tools,
            max_tokens=4096
        )
        
        # Claude finished — no more tool calls
        if response.stop_reason == "end_turn":
            final_text = extract_text(response)
            return {
                "status": "complete",
                "response": final_text,
                "actions_taken": actions_taken,
                "iterations": iteration_count
            }
        
        # Claude called tools
        if response.stop_reason == "tool_use":
            tool_results = []
            
            for block in response.content:
                if block.type == "tool_use":
                    tool_name = block.name
                    tool_input = block.input
                    
                    # Execute the tool
                    try:
                        result = tool_handlers[tool_name](tool_input)
                        actions_taken.append(f"{tool_name}({tool_input})")
                        tool_results.append({
                            "type": "tool_result",
                            "tool_use_id": block.id,
                            "content": json.dumps(result)
                        })
                    except Exception as e:
                        tool_results.append({
                            "type": "tool_result",
                            "tool_use_id": block.id,
                            "content": json.dumps({"error": str(e)}),
                            "is_error": True
                        })
                    
                    # Refresh kernel state after each tool execution
                    # This is critical — Claude needs fresh state after every action
                    kernel_state = get_live_kernel_state()
                    system = build_system_prompt(kernel_state, mode="AGENT")
            
            # Append assistant response and tool results to conversation
            messages.append({"role": "assistant", "content": response.content})
            messages.append({"role": "user", "content": tool_results})
    
    # Hit max iterations
    return {
        "status": "max_iterations_reached",
        "actions_taken": actions_taken,
        "iterations": iteration_count,
        "response": "Reached maximum steps. Here is what was completed so far."
    }


def build_system_prompt(kernel_state, mode):
    """Builds mode-specific system prompt with live kernel state injected."""
    
    mode_instructions = {
        "ASK": """
You are a conversational AI assistant inside a notebook IDE.
Your role: Answer questions, explain concepts, suggest code. Do NOT execute anything.
Read the kernel state below and use it to give accurate, context-aware answers.
Only use read-only tools (get_variable, list_variables).
""",
        "AGENT": """
You are an autonomous agent inside a notebook IDE.
Your role: Complete the user's task by creating cells, writing code, executing it, reading results, and iterating.
Be action-oriented. Minimize conversation. Log brief status updates between major steps.
If a cell fails: diagnose using failure context, rewrite, retry. Ask user only after 3 failed attempts.
Use all available tools freely.
""",
        "PLANNER": """
You are a strategic planning assistant inside a notebook IDE.
Your role: Think deeply, map out approaches, identify risks, present options with tradeoffs.
Write NO executable code. Use pseudocode only when needed for clarity.
Read kernel state to understand current project context and plan around it.
"""
    }
    
    return f"""
{mode_instructions[mode]}

## CURRENT MODE: {mode}

## LIVE KERNEL STATE
{json.dumps(kernel_state, indent=2)}

## RULES
- The kernel state above is live and accurate as of this message
- Variable shapes, types, null counts are real — use them in your reasoning
- Experiment log shows all past runs — reference it when discussing model performance
- Failure history shows last crash context — use it when debugging
- Never ask the user what variables they have — you can see them above
"""
```

---

## SECTION 5 — TOOL DEFINITIONS

> Claude: These are the tools available to you. Use only the tools appropriate for the active mode. Tool misuse (e.g., calling run_cell in ASK mode) is a violation of mode contract.

```python
TOOLS = [
    {
        "name": "run_cell",
        "description": "Execute a specific notebook cell by ID. Returns stdout, stderr, and execution status. AGENT mode only.",
        "input_schema": {
            "type": "object",
            "properties": {
                "cell_id": {"type": "string", "description": "ID of cell to execute"},
                "reason": {"type": "string", "description": "Why you are running this cell"}
            },
            "required": ["cell_id", "reason"]
        }
    },
    {
        "name": "get_variable",
        "description": "Get detailed information about a specific variable currently in kernel memory. Works in all modes.",
        "input_schema": {
            "type": "object",
            "properties": {
                "variable_name": {"type": "string"}
            },
            "required": ["variable_name"]
        }
    },
    {
        "name": "list_variables",
        "description": "List all variables currently in kernel memory with their types and shapes. Works in all modes.",
        "input_schema": {"type": "object", "properties": {}}
    },
    {
        "name": "modify_cell",
        "description": "Replace the code in an existing cell. AGENT mode only. Always explain reason.",
        "input_schema": {
            "type": "object",
            "properties": {
                "cell_id": {"type": "string"},
                "new_code": {"type": "string"},
                "reason": {"type": "string", "description": "Explain what changed and why"}
            },
            "required": ["cell_id", "new_code", "reason"]
        }
    },
    {
        "name": "create_cell",
        "description": "Create a new code or markdown cell. AGENT mode only.",
        "input_schema": {
            "type": "object",
            "properties": {
                "code": {"type": "string"},
                "after_cell_id": {"type": "string", "description": "Insert after this cell. Omit to append at end."},
                "cell_type": {"type": "string", "enum": ["code", "markdown"], "default": "code"},
                "label": {"type": "string", "description": "Short label for what this cell does"}
            },
            "required": ["code"]
        }
    },
    {
        "name": "compare_experiments",
        "description": "Retrieve all logged experiment runs as a comparison table. Works in all modes.",
        "input_schema": {"type": "object", "properties": {}}
    },
    {
        "name": "get_failure_context",
        "description": "Get full forensic context of the last error — variable state, execution history, traceback. Works in all modes.",
        "input_schema": {"type": "object", "properties": {}}
    },
    {
        "name": "search_memory",
        "description": "Search current kernel variables by type, column name, or value pattern. Useful for exploring unfamiliar notebooks.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Search term — type name, column name, or keyword"}
            },
            "required": ["query"]
        }
    }
]

# Mode-based tool access control
TOOLS_BY_MODE = {
    "ASK":     ["get_variable", "list_variables", "compare_experiments", "get_failure_context", "search_memory"],
    "AGENT":   ["run_cell", "get_variable", "list_variables", "modify_cell", "create_cell", "compare_experiments", "get_failure_context", "search_memory"],
    "PLANNER": ["list_variables", "get_variable", "search_memory"]
}

def get_tools_for_mode(mode):
    allowed = TOOLS_BY_MODE[mode]
    return [t for t in TOOLS if t["name"] in allowed]
```

---

## SECTION 6 — INTROSPECTION JSON (Live Kernel State Schema)

> Claude: When this JSON is present in your context, USE IT. Do not ask the user what variables exist. Reason from this state.

```json
{
  "kernel_id": "notebook_abc123",
  "timestamp": "2026-02-22T10:30:00Z",
  "variables": [
    {
      "name": "df",
      "type": "pandas.DataFrame",
      "shape": [10000, 42],
      "memory_mb": 12.4,
      "null_counts": { "age": 0, "income": 340 },
      "columns": ["age", "income", "target"],
      "created_in_cell": 3,
      "last_modified_cell": 5
    },
    {
      "name": "model",
      "type": "sklearn.ensemble.RandomForestClassifier",
      "memory_mb": 4.2,
      "is_fitted": true,
      "created_in_cell": 7
    }
  ],
  "memory_total_mb": 840,
  "memory_available_mb": 2200,
  "cells_executed_order": [1, 2, 3, 5, 7],
  "cells_with_errors": [],
  "last_error": null,
  "cell_dependency_graph": {
    "cell_3": {
      "produces": ["df"],
      "consumes": ["df_raw"],
      "depends_on_cells": [1, 2]
    },
    "cell_7": {
      "produces": ["model"],
      "consumes": ["df", "X_train", "y_train"],
      "depends_on_cells": [3, 5]
    }
  },
  "experiment_log": [
    {
      "run_id": "run_001",
      "cell_id": 7,
      "timestamp": "2026-02-22T10:28:00Z",
      "hyperparameters": { "n_estimators": 100, "max_depth": 5 },
      "metrics": { "accuracy": 0.87, "f1": 0.84 },
      "dataset_hash": "a3f9c2b1",
      "code_snapshot": "model = RandomForestClassifier(n_estimators=100...)"
    }
  ],
  "failure_history": []
}
```

---

## SECTION 7 — 6-WEEK BUILD PLAN

### Overview
```
Week 1 → Kernel Introspection API  (enables everything else)
Week 2 → Cell Dependency Graph     (enables impact analysis)
Week 3 → Failure Memory + Warnings (enables forensic debugging)
Week 4 → Experiment Tracking       (enables auto logging)
Week 5 → Agent Tools + Mode Wiring (enables MODE 2 fully)
Week 6 → Real User Testing         (zero new features)
```

---

### WEEK 1 — Kernel Introspection API

**Goal:** Claude receives live kernel state on every message in every mode.

**Files to create:**
- `kernel/introspection_poller.py`
- `agent/system_prompt_builder.py`
- `api/claude_client.py` (modify)

```python
# kernel/introspection_poller.py
import sys, json, threading, traceback
from datetime import datetime

def get_kernel_state(globals_dict):
    """
    Polls live kernel globals and returns structured JSON.
    Run this in a background thread every 3 seconds.
    Inject output into every Claude API call via system_prompt_builder.
    """
    variables = []
    
    for name, val in globals_dict.items():
        if name.startswith("_"):
            continue
        try:
            entry = {
                "name": name,
                "type": type(val).__module__ + "." + type(val).__name__,
                "memory_mb": round(sys.getsizeof(val) / 1e6, 3)
            }
            if hasattr(val, "shape"):
                entry["shape"] = list(val.shape)
            if hasattr(val, "columns"):
                entry["columns"] = list(val.columns)
                entry["null_counts"] = val.isnull().sum().to_dict()
            if hasattr(val, "fit") and hasattr(val, "predict"):
                entry["is_fitted"] = hasattr(val, "classes_") or hasattr(val, "coef_")
            variables.append(entry)
        except Exception:
            pass  # never crash the poller
    
    return {
        "kernel_id": get_kernel_id(),
        "timestamp": datetime.utcnow().isoformat(),
        "variables": variables,
        "memory_total_mb": sum(v["memory_mb"] for v in variables),
        "cells_executed_order": get_execution_order(),
        "last_error": get_last_error(),
        "experiment_log": get_experiment_log(),
        "failure_history": get_failure_history()
    }

# Background thread — call this on kernel startup
def start_polling(kernel, interval_seconds=3):
    def poll():
        while True:
            state = get_kernel_state(kernel.globals())
            kernel.set_cached_state(state)
            threading.Event().wait(interval_seconds)
    thread = threading.Thread(target=poll, daemon=True)
    thread.start()
```

**Done when:** You ask Claude "what variables are in my notebook" in ASK mode and it answers correctly without you typing any code.

---

### WEEK 2 — Cell Dependency Graph

**Goal:** Claude knows which cells produce which variables and predicts downstream breakage.

**Files to create:**
- `kernel/dependency_tracker.py`

```python
# kernel/dependency_tracker.py
import ast

def extract_cell_dependencies(cell_id, cell_code, existing_graph):
    """
    Parse cell AST to extract what variables it produces and consumes.
    Updates existing_graph in place.
    Call this every time a cell is executed.
    """
    try:
        tree = ast.parse(cell_code)
    except SyntaxError:
        return existing_graph
    
    produces, consumes = set(), set()
    
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name):
                    produces.add(target.id)
        if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load):
            consumes.add(node.id)
    
    depends_on_cells = []
    for var in consumes - produces:
        for cid, cdata in existing_graph.items():
            if var in cdata.get("produces", []):
                depends_on_cells.append(cid)
    
    existing_graph[cell_id] = {
        "produces": list(produces),
        "consumes": list(consumes - produces),
        "depends_on_cells": list(set(depends_on_cells))
    }
    return existing_graph

def get_downstream_cells(changed_cell_id, graph):
    """
    Returns all cell IDs that will be affected if changed_cell_id is modified.
    Claude uses this before modifying any cell in AGENT mode.
    """
    affected = []
    produced_by_changed = graph.get(changed_cell_id, {}).get("produces", [])
    
    for cell_id, data in graph.items():
        if cell_id == changed_cell_id:
            continue
        if any(var in data.get("consumes", []) for var in produced_by_changed):
            affected.append(cell_id)
    
    return affected
```

**Done when:** Claude says "changing cell 3 will break cells 5, 7, and 9" and it is correct.

---

### WEEK 3 — Failure Memory + Pre-Execution Warnings

**Files to create:**
- `kernel/failure_capture.py`
- `kernel/pre_execution_checker.py`

```python
# kernel/failure_capture.py
import traceback
from datetime import datetime

def capture_failure(cell_id, error, kernel_globals, execution_history):
    """Call this inside every cell execution try/except block."""
    return {
        "cell_id": cell_id,
        "error_type": type(error).__name__,
        "error_message": str(error),
        "traceback": traceback.format_exc(),
        "variable_state_at_crash": get_kernel_state(kernel_globals),
        "last_5_cells_executed": execution_history[-5:],
        "timestamp": datetime.utcnow().isoformat()
    }

# kernel/pre_execution_checker.py
def check_before_execution(cell_code, kernel_state, cell_dependency_graph, cell_id):
    """
    Run before every cell execution.
    Returns list of warnings to show user and pass to Claude.
    """
    warnings = []
    
    # OOM risk
    if kernel_state["memory_available_mb"] < 500:
        warnings.append({
            "type": "OOM_RISK",
            "severity": "HIGH",
            "message": f"Only {kernel_state['memory_available_mb']}MB available. This cell may cause an out-of-memory crash."
        })
    
    # Redefine warning
    from dependency_tracker import extract_cell_dependencies, get_downstream_cells
    temp_graph = dict(cell_dependency_graph)
    extract_cell_dependencies(cell_id, cell_code, temp_graph)
    downstream = get_downstream_cells(cell_id, cell_dependency_graph)
    if downstream:
        warnings.append({
            "type": "REDEFINE_WARNING",
            "severity": "MEDIUM",
            "message": f"This cell redefines variables used in cells: {downstream}. Those cells may produce different results."
        })
    
    # Data quality before training
    if any(pattern in cell_code for pattern in [".fit(", ".train("]):
        for var in kernel_state["variables"]:
            if var.get("null_counts"):
                total_nulls = sum(var["null_counts"].values())
                if total_nulls > 0:
                    warnings.append({
                        "type": "DATA_QUALITY",
                        "severity": "MEDIUM",
                        "message": f"'{var['name']}' has {total_nulls} null values. Handle before training."
                    })
    
    return warnings
```

**Done when:** A cell about to cause OOM shows a warning BEFORE it crashes.

---

### WEEK 4 — Automatic Experiment Tracking

**Files to create:**
- `tracking/experiment_tracker.py`

```python
# tracking/experiment_tracker.py
import hashlib, json
from datetime import datetime

TRAINING_SIGNALS = [".fit(", ".train(", "trainer.train(", "model.compile("]

def should_track(cell_code):
    return any(signal in cell_code for signal in TRAINING_SIGNALS)

def compute_dataset_hash(kernel_globals):
    for name, val in kernel_globals.items():
        if hasattr(val, "shape") and hasattr(val, "columns"):
            try:
                sample = str(val.head(100).values.tolist())
                return hashlib.md5(sample.encode()).hexdigest()[:8]
            except Exception:
                pass
    return "unknown"

def extract_hyperparameters(cell_code, kernel_globals):
    params = {}
    param_keywords = ["lr", "rate", "epoch", "batch", "depth", "estimator", "alpha", "lambda", "n_", "max_", "min_"]
    for name, val in kernel_globals.items():
        if isinstance(val, (int, float, str, bool)) and not name.startswith("_"):
            if any(kw in name.lower() for kw in param_keywords):
                params[name] = val
    return params

def capture_metrics(kernel_globals):
    metrics = {}
    metric_keywords = ["accuracy", "loss", "f1", "precision", "recall", "auc", "score", "mse", "mae", "rmse"]
    for name, val in kernel_globals.items():
        if isinstance(val, float):
            if any(kw in name.lower() for kw in metric_keywords):
                metrics[name] = round(val, 6)
    return metrics

def log_experiment(cell_id, cell_code, kernel_globals):
    """Auto-called after any cell containing a training pattern executes successfully."""
    if not should_track(cell_code):
        return None
    return {
        "run_id": f"run_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}",
        "cell_id": cell_id,
        "timestamp": datetime.utcnow().isoformat(),
        "hyperparameters": extract_hyperparameters(cell_code, kernel_globals),
        "metrics": capture_metrics(kernel_globals),
        "dataset_hash": compute_dataset_hash(kernel_globals),
        "code_snapshot": cell_code.strip()
    }
```

**Done when:** User trains 3 models with different params. All 3 logged in comparison table automatically.

---

### WEEK 5 — Wire All Three Modes + Agent Tools

**Goal:** All three modes (ASK, AGENT, PLANNER) work end to end. Agent can complete a full autonomous task.

**Files to create/modify:**
- `agent/mode_router.py` — detects or accepts active mode, routes to correct handler
- `agent/agent_loop.py` — the custom tool loop from Section 4
- `agent/ask_handler.py` — simple Claude call with read-only tools
- `agent/planner_handler.py` — simple Claude call with no execution tools

**Integration test for AGENT mode:** Say "I have a CSV loaded as df. Build a baseline classification model." Agent should: check df state → detect nulls → clean → split → train → log experiment → report accuracy. All without user touching a cell.

**LangGraph upgrade trigger (evaluate at end of Week 5):**
If your autonomous tasks need more than 10 chained tool calls OR need parallel execution OR need persistent state across notebook sessions → migrate AGENT mode to LangGraph. Otherwise stay custom.

---

### WEEK 6 — Real User Testing (Zero New Code)

**Post in these places:**
- r/MachineLearning, r/datascience
- Hugging Face Discord, fast.ai Discord, MLOps Community Discord
- LinkedIn — search "ML engineer" and DM directly
- Twitter/X

**Post copy:**
> "Built a notebook IDE where the AI sees your live kernel state — not just your code. It knows your df shapes, null counts, which cells depend on what, and warns you before OOM crashes. Looking for 20 ML engineers to use it for free and break it. DM me."

**Session protocol:** Give them a messy dataset. Say nothing. Watch for 20 minutes. Note every confusion point and every moment of delight.

**Exit criteria for Week 6:**
- 10 sessions completed
- 3 direct quotes describing specific value
- Clear answer: which mode do users actually want most?
- At least 5 people say they would pay for it

---

## SECTION 8 — CLAUDE OPERATING RULES

> These rules apply whenever Claude is working on this codebase or inside a live notebook.

**Before writing any code:**
1. Identify the active mode (ASK / AGENT / PLANNER)
2. Confirm which week of the build plan this work belongs to
3. Check if dependencies from prior weeks exist before building on top of them
4. State which files you will modify and why

**When kernel state JSON is present:**
- Use it. Never ask the user what variables they have.
- Check memory_available_mb before suggesting operations on large data
- Check cell_dependency_graph before modifying any cell in AGENT mode
- Reference experiment_log when discussing past model runs

**When kernel state JSON is NOT present:**
- Say explicitly: "Introspection API not yet active — I can't see live kernel state. Build Week 1 first."
- Do not fabricate variable names or shapes

**Code rules:**
- Every new file must have a module docstring explaining its role
- Every function touching the kernel must have try/except — kernel operations fail silently
- Never block the main thread — polling always runs in background threads
- Always refresh kernel state after a tool call in AGENT mode — state changes after every execution

---

## SECTION 9 — YC APPLICATION CHECKLIST

- [ ] 25 users who have used it more than once
- [ ] 3 direct user quotes describing a specific problem solved
- [ ] Demo video: upload dataset → ask agent to build baseline model → complete in under 2 minutes
- [ ] Clear answer to "why can't Cursor add this?" → "They are file-aware. We are runtime-aware. Different architecture, not a feature gap."
- [ ] Week-over-week retention data
- [ ] One sentence: "The first notebook IDE where AI sees live kernel state — not just code."

---

## SECTION 10 — GLOSSARY

| Term | Meaning |
|------|---------|
| ASK mode | Conversational AI — reads state, suggests code, does not execute |
| AGENT mode | Autonomous AI — creates cells, executes, debugs, rewrites autonomously |
| PLANNER mode | Strategic AI — reasons and plans only, no code execution |
| Kernel | Python process running behind a notebook |
| Introspection JSON | Live state snapshot fed to Claude on every message |
| Dependency Graph | DAG of cell → variable → cell relationships |
| Execution-Aware | AI has live runtime state, not just code text |
| Failure Memory | Full system snapshot captured at crash time |
| Experiment Log | Auto-captured record of every training run |
| Tool | Function Claude can call to act on the notebook |
| Agent Loop | While loop calling Claude until it stops using tools |
| OpenCode | File-based coding agent — wrong fit for this project |
| Continue | IDE plugin framework — borrow context provider ideas only |
| OpenDevin/OpenHands | Most mature autonomous agent — sandbox conflicts with kernel isolation |
| LangGraph | Stateful graph agent framework — use only if custom loop hits limits |

---

*Document version: 2.0 — Updated with Three Modes + Agent Framework Decision*
*Week 0 — Pre-build*
*Next milestone: Week 1 — Introspection API live, all three modes receiving kernel state*