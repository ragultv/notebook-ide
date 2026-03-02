# Implementation Plan: No-RAG Notebook Agent

## Overview

This implementation plan covers the development of a notebook-based AI agent that operates WITHOUT RAG infrastructure—no embeddings, no vector databases, no retrieval pipelines. The agent uses TypeScript and maintains two complementary memory systems: In-Context Memory via introspection JSON and Conversation Memory via rolling summaries.

**All agent components are implemented in the `agent/` folder.**

## Agent Modes (4 Modes)

1. **ASK**: Direct question answering with full context, NO code execution, text response only
2. **AGENT**: Cell operations only (create notebook, edit notebook, create cell, edit cell, update cell, delete cell), NO code execution
3. **AGENTIC**: Full autonomous loop - add cell → execute → check output → if error: fix → repeat until task complete
4. **PLAN**: Generate high-level plans with code snippets WITHOUT execution, user clicks "Continue" or "Cancel"

## Tasks

- [ ] 1. Set up project structure and core types (in agent/ folder)
  - [x] 1.1 Create agent/ directory structure
    - Create agent/src/types, agent/src/state, agent/src/memory, agent/src/kernel, agent/src/modes
    - Set up package.json with TypeScript, Jest, and required dependencies
    - Configure tsconfig.json for strict mode and ES modules
    - _Requirements: C.1, C.4_

  - [x] 1.2 Define core type definitions
    - Create AgentMode type ('ASK' | 'AGENT' | 'AGENTIC' | 'PLAN')
    - Define AgentState interface with compact field names (n, t, s, v, r)
    - Define UIState interface with rich field names
    - Define ChatMessage, ConversationSummary, and rolling summary types
    - Define IntrospectionJSON and related introspection types
    - Define ExecutionResult, VariableInfo, and kernel types
    - Define AgentError types and error categories
    - _Requirements: 1.5, 4.2, 4.3, 2.5, 3.1, 6.1, 9.1_

- [ ] 2. Implement State Manager with dual state and thread safety (agent/src/state)
  - [x] 2.1 Create StateManager class with dual state storage
    - Implement agentState (compact) and uiState (rich) properties
    - Implement getAgentState() and getUIState() methods
    - Add state serialization for system prompt generation
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [x] 2.2 Implement thread-safe state updates with mutex
    - Add mutex locks for agentState and uiState updates
    - Implement atomicUpdate() for coordinated state changes
    - Ensure consistent lock acquisition order to prevent deadlock
    - _Requirements: 5.1, 5.2, 5.4_

  - [x] 2.3 Implement state polling mechanism
    - Create polling loop with configurable interval (default 500ms)
    - Implement detectChanges() to identify state mutations
    - Add startPolling() and stopPolling() methods
    - _Requirements: 4.1, C.4_

  - [x] 2.4 Implement state subscription system
    - Add subscribe() method for state change notifications
    - Implement notifySubscribers() for broadcasting updates
    - Return unsubscribe functions for cleanup
    - _Requirements: 5.3_

  - [ ]* 2.5 Write unit tests for StateManager
    - Test thread-safe concurrent updates
    - Test state serialization and deserialization
    - Test polling and change detection
    - _Requirements: 5.1, 5.2, 5.3_

- [ ] 3. Implement Chat Memory with rolling summaries (agent/src/memory)
  - [x] 3.1 Create ChatMemory class with message storage
    - Implement addMessage() for storing chat messages with metadata
    - Store role, content, timestamp, and token count
    - _Requirements: 3.1_

  - [x] 3.2 Implement rolling summary generation
    - Create generateSummary() method for conversation summarization
    - Extract key topics, decisions, and open questions
    - Implement getRollingSummary() for formatted output
    - _Requirements: 3.2, 3.3_

  - [x] 3.3 Implement context retrieval with token management
    - Create getContext() to return recent messages plus summary
    - Implement truncateToLimit() for token budget enforcement
    - Add estimateTokenCount() for token estimation
    - _Requirements: 3.4, 3.5, 10.1, 10.4, 10.5_

  - [x] 3.4 Implement memory budget enforcement
    - Create MemoryManager for chat history limits
    - Prune messages when token limits are exceeded
    - Preserve rolling summary during truncation
    - _Requirements: S.3, 3.5_

  - [ ]* 3.5 Write unit tests for ChatMemory
    - Test message storage and retrieval
    - Test rolling summary generation
    - Test token-based truncation
    - _Requirements: 3.2, 3.5_

- [ ] 4. Implement Introspection Memory for variable tracking (agent/src/memory)
  - [x] 4.1 Create IntrospectionMemory class
    - Implement refresh() to capture current notebook state
    - Generate compact JSON for system prompt embedding
    - _Requirements: 2.1, 2.3, 2.4_

  - [x] 4.2 Implement variable tracking with dependencies
    - Track variable names, types, shapes, and value previews
    - Record cell of origin and dependencies
    - Maintain referencedBy lists for dependency analysis
    - _Requirements: 2.2, 7.1, 7.2, 7.4_

  - [x] 4.3 Implement experiment management
    - Create startExperiment() and endExperiment() methods
    - Implement logMetric() for tracking experiment metrics
    - Store experiment status, cell associations, and metrics
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

  - [x] 4.4 Implement activity tracking
    - Track executions, edits, and chat events
    - Record timestamps and cell associations
    - _Requirements: 2.5_

  - [ ]* 4.5 Write unit tests for IntrospectionMemory
    - Test variable tracking and dependency updates
    - Test experiment lifecycle management
    - Test JSON generation for system prompts
    - _Requirements: 7.1, 8.1, 2.3_

- [ ] 5. Implement Kernel Interface for code execution (agent/src/kernel)
  - [x] 5.1 Create KernelInterface class with kernel connection
    - Implement execute() for running code in Jupyter kernel
    - Support configurable timeout (default 30s, max 120s) and retry logic
    - Return output, execution time, and captured variables
    - _Requirements: 6.1, 6.2, 6.5_

  - [x] 5.2 Implement variable introspection
    - Create getVariables() to retrieve variable metadata
    - Capture name, type, shape, value preview, and reference count
    - _Requirements: 6.3_

  - [x] 5.3 Implement execution history tracking
    - Create getExecutionHistory() for cell execution records
    - Track execution order and timing
    - _Requirements: 2.5_

  - [x] 5.4 Implement kernel lifecycle management
    - Add interrupt() and restart() methods
    - Handle kernel disconnections and reconnections
    - _Requirements: 6.5_

  - [x] 5.5 Implement error handling for kernel operations
    - Categorize kernel errors (execution, timeout, connection)
    - Return descriptive error messages with stack traces
    - _Requirements: 6.4, 9.2_

  - [ ]* 5.6 Write unit tests for KernelInterface
    - Test code execution with timeout handling
    - Test variable introspection accuracy
    - Test kernel interrupt and restart
    - _Requirements: 6.1, 6.3, 6.5_

- [x] 6. Implement Notebook Agent with mode handling (agent/src/)
  - [x] 6.1 Create NotebookAgent class with configuration
    - Implement constructor with NotebookAgentConfig
    - Add initialize(), start(), and stop() lifecycle methods
    - Set default mode to ASK on initialization
    - _Requirements: 1.5_

  - [x] 6.2 Implement mode switching
    - Create setMode() for changing agent mode via UI click
    - Update processing behavior based on current mode
    - _Requirements: 1.4_

  - [x] 6.3 Implement ASK mode handler (agent/src/modes/ask.ts)
    - Create handleAskMode() for direct question answering
    - Build context with full introspection data
    - Return text response only, NO code execution
    - MAY include code snippets in response for reference
    - _Requirements: 1.1_

  - [x] 6.4 Implement AGENT mode handler - Cell Operations Only (agent/src/modes/agent.ts)
    - Create handleAgentMode() for notebook/cell operations
    - Support: create notebook, edit notebook, create cell, edit cell, update cell, delete cell
    - WHEN creating/editing cells, DO NOT execute code
    - Perform cell operations based on user requests
    - Return confirmation of operations performed
    - NO code execution in AGENT mode
    - _Requirements: 1.2_

  - [x] 6.5 Implement AGENTIC mode handler - Full Autonomous Loop (agent/src/modes/agentic.ts)
    - Create handleAgenticMode() for complete task execution loop
    - Loop: add cell → execute → check output → if error, fix and retry → if success, continue → repeat until task complete
    - Parse user goal and create execution plan
    - FOR EACH STEP in plan:
      - Create new cell with code
      - Execute cell in kernel
      - Check output for errors
      - IF error: analyze, create fix cell, execute fix, verify (max 3 retries per step)
      - IF success: verify output, continue to next step
    - WHEN all steps complete: return summary of all cells created and final result
    - NO user review checkpoints - fully autonomous
    - _Requirements: 1.3_

  - [x] 6.6 Implement PLAN mode handler - Generate Plans (agent/src/modes/plan.ts)
    - Create handlePlanMode() for plan generation
    - Generate high-level plans with code snippets WITHOUT execution
    - Return plan with "Continue" and "Cancel" options
    - WHEN user clicks "Continue": prompt for execution confirmation
    - WHEN user clicks "Cancel": discard the plan
    - Include estimated time and step descriptions in plan
    - NO code execution in PLAN mode
    - _Requirements: 1.4_

  - [x] 6.7 Implement main message processing
    - Create processMessage() as entry point
    - Route to appropriate mode handler based on current mode
    - Return AgentResponse with content
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [ ]* 6.8 Write unit tests for NotebookAgent
    - Test mode switching behavior
    - Test ASK mode text-only responses
    - Test AGENT mode cell operations (no execution)
    - Test AGENTIC mode full execution loop
    - Test PLAN mode plan generation
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 7. Implement Token Optimizer for context management (agent/src/)
  - [x] 7.1 Create TokenOptimizer class
    - Implement optimizeForContext() for token allocation
    - Reserve tokens for LLM response (approximately 30% for introspection)
    - _Requirements: 10.1, 10.2_

  - [x] 7.2 Implement proportional truncation
    - Truncate messages and introspection data proportionally
    - Preserve recent messages and rolling summary
    - _Requirements: 10.3, 10.5_

  - [ ]* 7.3 Write unit tests for TokenOptimizer
    - Test token allocation proportions
    - Test truncation behavior
    - _Requirements: 10.2, 10.3_

- [x] 8. Implement Error Handler for recovery (agent/src/)
  - [x] 8.1 Create AgentErrorHandler class
    - Implement categorize() for error classification
    - Handle execution, state, memory, LLM, and kernel errors
    - _Requirements: 9.1_

  - [x] 8.2 Implement error recovery strategies
    - Create handleKernelError() with kernel restart
    - Create handleExecutionError() with fix suggestions
    - Implement error logging with timestamps
    - _Requirements: 9.2, 9.3, 9.4_

  - [x] 8.3 Implement error budget management
    - Prune older errors when threshold is exceeded
    - Maintain error log with context
    - _Requirements: 9.5_

  - [ ]* 8.4 Write unit tests for AgentErrorHandler
    - Test error categorization
    - Test recovery strategies
    - Test error log management
    - _Requirements: 9.1, 9.2, 9.5_

- [x] 9. Checkpoint - Core Components Validation
  - [x] 9.1 Run all unit tests for core components (StateManager, ChatMemory, IntrospectionMemory, KernelInterface, NotebookAgent, TokenOptimizer, AgentErrorHandler)
  - [x] 9.2 Verify all required interfaces are implemented in agent/ folder
  - [x] 9.3 Validate thread-safe operations
  - [x] 9.4 Test token budget enforcement
  - [x] 9.5 Report any issues to user before proceeding

- [x] 10. Integrate with WebSocket server
  - [x] 10.1 Create WebSocket message handlers in agent/
    - Implement message parsing for agent commands
    - Handle mode changes, message sending, and state requests
    - _Requirements: C.4_

  - [x] 10.2 Implement real-time state broadcasting
    - Send state updates to connected clients
    - Handle client connections and disconnections
    - _Requirements: C.4_

  - [x] 10.3 Connect StateManager subscriptions to WebSocket
    - Broadcast state changes via WebSocket
    - Ensure message ordering and delivery
    - _Requirements: 5.3, C.4_

- [x] 11. Integrate with frontend UI components
  - [x] 11.1 Create UI state adapters in agent/
    - Transform AgentState to UIState format
    - Handle variable display with dependencies
    - _Requirements: 4.3, 7.3_

  - [x] 11.2 Implement experiment display data
    - Format experiments with metrics for UI
    - Support experiment comparison view
    - _Requirements: 8.5_

  - [x] 11.3 Create chat history display adapter
    - Format messages for frontend rendering
    - Include timestamps and role indicators
    - _Requirements: 3.1_

- [x] 12. Final checkpoint - Full Integration Validation
  - [x] 12.1 Run all unit tests
  - [x] 12.2 Test WebSocket integration end-to-end
  - [x] 12.3 Test UI state adapters with real data
  - [x] 12.4 Verify all acceptance criteria are met
  - [x] 12.5 Report final status to user

## Directory Structure (agent/ folder)

```
agent/
├── src/
│   ├── types/
│   │   ├── agent.types.ts      # Core type definitions
│   │   ├── state.types.ts      # State types
│   │   ├── memory.types.ts     # Memory types
│   │   ├── kernel.types.ts     # Kernel types
│   │   └── error.types.ts      # Error types
│   ├── state/
│   │   ├── StateManager.ts     # Dual state management
│   │   └── state.types.ts
│   ├── memory/
│   │   ├── ChatMemory.ts       # Conversation memory
│   │   ├── IntrospectionMemory.ts  # Variable tracking
│   │   └── memory.types.ts
│   ├── kernel/
│   │   ├── KernelInterface.ts  # Kernel operations
│   │   └── kernel.types.ts
│   ├── modes/
│   │   ├── ask.ts              # ASK mode handler (text only, no execution)
│   │   ├── agent.ts            # AGENT mode handler (cell ops, no execution)
│   │   ├── agentic.ts          # AGENTIC mode handler (full autonomous loop)
│   │   └── plan.ts             # PLAN mode handler (generate plans, user executes)
│   ├── NotebookAgent.ts        # Main agent class
│   ├── TokenOptimizer.ts       # Context optimization
│   └── AgentErrorHandler.ts    # Error handling
├── package.json
└── tsconfig.json
```

## Four Agent Modes

### ASK Mode
- Direct question answering with full context
- NO code execution
- Text response only
- MAY include code snippets in response for reference

### AGENT Mode
- Cell operations only: create notebook, edit notebook, create cell, edit cell, update cell, delete cell
- NO code execution
- Perform operations and return confirmation

### AGENTIC Mode - Full Autonomous Loop
```
1. Parse user goal
2. Create execution plan (sequence of cells)
3. FOR EACH STEP in plan:
   a. Create new cell with code
   b. Execute cell in kernel
   c. Check output for errors
   d. IF error:
      - Analyze error message
      - Create fix cell with corrected code
      - Execute fix cell
      - Verify fix succeeded
      - IF fix failed, retry with different approach (max 3 retries)
   e. IF success:
      - Verify output meets expectations
      - Continue to next step
4. WHEN all steps complete:
   - Return summary of all cells created
   - Return final output/result
   - Mark task as complete
```

### PLAN Mode
- Generate high-level plans with code snippets
- NO code execution
- Return plan with "Continue" and "Cancel" options
- User reviews and decides to execute or cancel

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- The implementation uses TypeScript in the agent/ folder
- All components are designed for thread-safe concurrent access
- Token optimization ensures operation within LLM context limits
- NO RAG - no embeddings, no vector DB, no retrieval pipeline

## Four Agent Modes Summary

| Mode | Code Execution | Cell Operations | User Interaction | Use Case |
|------|---------------|-----------------|------------------|----------|
| ASK | ❌ No | ❌ No | Text response only | Quick questions |
| AGENT | ❌ No | ✅ Yes (create/edit/update/delete) | Confirm operations | Prepare notebook structure |
| AGENTIC | ✅ Yes (full loop) | ✅ Yes (create cells) | None (fully autonomous) | Complete tasks automatically |
| PLAN | ❌ No | ❌ No | "Continue" or "Cancel" | Review before execution |