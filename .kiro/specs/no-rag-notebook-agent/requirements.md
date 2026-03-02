# Requirements Document: No-RAG Notebook Agent

## Introduction

A notebook-based AI agent that operates without traditional RAG infrastructure—no embeddings, no vector databases, no retrieval pipelines. The agent maintains two complementary memory systems: In-Context Memory via introspection JSON embedded directly in the system prompt, and Conversation Memory via rolling summaries for long-running interactions. The agent operates in three modes (ASK, AGENT, PLANNER) and maintains thread-safe state with efficient memory usage suitable for production deployment.

## Glossary

- **NotebookAgent**: The core agent class that processes user messages and manages the notebook interaction
- **KernelInterface**: Interface to the Jupyter kernel for code execution and variable introspection
- **StateManager**: Manages dual state structures (compact agent state + rich UI state) with thread safety
- **ChatMemory**: Maintains conversation history with rolling summaries for long-running interactions
- **IntrospectionMemory**: Generates JSON introspection data embedded in the system prompt
- **AgentMode**: Operating mode of the agent (ASK, AGENT, or PLANNER)
- **IntrospectionJSON**: Compact JSON representation of notebook state for LLM context
- **RollingSummary**: Dynamic summary of conversation history with key topics, decisions, and open questions
- **CompactVariable**: Minimized variable representation for agent state (name, type, shape, preview, references)
- **RichVariable**: Full variable representation for UI display with dependencies and metadata

## Functional Requirements

### Requirement 1: Agent Mode Operations

**User Story:** As a user, I want the agent to operate in different modes so that I can get the appropriate level of assistance for my task.

#### Acceptance Criteria

1. WHEN a user sends a message in ASK mode, THE NotebookAgent SHALL provide direct question answering with full context access
2. WHEN a user sends a message in AGENT mode, THE NotebookAgent SHALL autonomously execute code and iterate on solutions with user review checkpoints
3. WHEN a user sends a message in PLANNER mode, THE NotebookAgent SHALL generate high-level plans with code snippets without executing them
4. WHEN a user changes the agent mode, THE NotebookAgent SHALL update its processing behavior accordingly
5. THE NotebookAgent SHALL default to ASK mode on initialization

### Requirement 2: In-Context Memory via Introspection JSON

**User Story:** As a developer, I want the agent to have access to notebook state through introspection JSON so that it can understand variables, execution history, and experiments without external retrieval.

#### Acceptance Criteria

1. WHEN the kernel executes code, THE IntrospectionMemory SHALL capture variable names, types, shapes, and value previews
2. WHEN variables are defined or modified, THE IntrospectionMemory SHALL track their cell of origin and dependencies
3. WHEN introspection data is requested, THE IntrospectionMemory SHALL generate a compact JSON representation suitable for embedding in system prompts
4. WHEN the system prompt is built, THE NotebookAgent SHALL embed the introspection JSON directly without vector database retrieval
5. THE IntrospectionJSON SHALL include notebook ID, cell count, execution order, variables, experiments, execution context, and recent activity

### Requirement 3: Conversation Memory via Rolling Summaries

**User Story:** As a user, I want the agent to maintain conversation context across long interactions so that I don't have to repeat information.

#### Acceptance Criteria

1. WHEN messages are exchanged, THE ChatMemory SHALL store them with role, content, timestamp, and token count
2. WHEN the message count exceeds the summary threshold, THE ChatMemory SHALL generate a rolling summary
3. THE RollingSummary SHALL include conversation summary, key topics, decisions made, and open questions
4. WHEN context is requested, THE ChatMemory SHALL provide recent messages plus the rolling summary
5. WHEN token limits are approached, THE ChatMemory SHALL truncate older messages while preserving the summary

### Requirement 4: Dual State Management

**User Story:** As a system architect, I want separate compact and rich state representations so that the LLM receives minimal context while the UI receives full details.

#### Acceptance Criteria

1. WHEN state changes occur, THE StateManager SHALL maintain both AgentState (compact JSON) and UIState (rich objects)
2. THE AgentState SHALL use abbreviated field names (n for name, t for type, s for shape, v for value, r for references) to minimize token usage
3. THE UIState SHALL include full variable objects with dependencies, referencedBy, createdAt, and updatedAt timestamps
4. WHEN the system prompt is generated, THE StateManager SHALL serialize only the AgentState
5. WHEN the frontend requests state, THE StateManager SHALL provide the full UIState

### Requirement 5: Thread-Safe State Updates

**User Story:** As a system developer, I want thread-safe state management so that concurrent updates don't cause race conditions or data corruption.

#### Acceptance Criteria

1. WHEN multiple threads attempt to update state simultaneously, THE StateManager SHALL use mutex locks to prevent concurrent modifications
2. WHEN acquiring locks, THE StateManager SHALL always acquire locks in a consistent order to prevent deadlock
3. WHEN state is updated, THE StateManager SHALL notify all subscribers of the changes
4. THE StateManager SHALL support atomic updates across both agent and UI state when needed

### Requirement 6: Kernel Interface Operations

**User Story:** As a data scientist, I want the agent to execute code in the notebook kernel so that I can run analyses and experiments.

#### Acceptance Criteria

1. WHEN code execution is requested, THE KernelInterface SHALL execute it in the Jupyter kernel with configurable timeout
2. WHEN execution completes, THE KernelInterface SHALL return output, execution time, and captured variables
3. WHEN variables are requested, THE KernelInterface SHALL return name, type, shape, value preview, and reference count
4. WHEN kernel errors occur, THE KernelInterface SHALL return descriptive error messages with stack traces
5. THE KernelInterface SHALL support kernel interruption and restart operations

### Requirement 7: Variable Tracking and Dependencies

**User Story:** As a notebook user, I want the agent to understand variable relationships so that it can provide intelligent suggestions and avoid breaking dependencies.

#### Acceptance Criteria

1. WHEN a variable is defined in a cell, THE IntrospectionMemory SHALL record the cell ID and track it as a dependency
2. WHEN a cell referencing a variable is executed, THE IntrospectionMemory SHALL update the variable's referencedBy list
3. WHEN variable information is displayed, THE UIState SHALL show dependencies and referencing cells
4. THE CompactVariable SHALL include reference count to help the agent understand variable usage patterns

### Requirement 8: Experiment Management

**User Story:** As a researcher, I want to track experiments with metrics so that I can compare different approaches.

#### Acceptance Criteria

1. WHEN an experiment is started, THE IntrospectionMemory SHALL create an experiment entry with ID, name, description, and associated cells
2. WHEN metrics are logged, THE IntrospectionMemory SHALL record them with timestamps
3. WHEN an experiment ends, THE IntrospectionMemory SHALL update its status to completed or failed
4. THE ExperimentEntry SHALL include status, cell associations, and recorded metrics
5. THE UIState SHALL display experiments with their metrics for comparison

### Requirement 9: Error Handling and Recovery

**User Story:** As a user, I want the agent to handle errors gracefully so that I can recover from failures without losing context.

#### Acceptance Criteria

1. WHEN execution errors occur, THE AgentErrorHandler SHALL categorize them (execution, state, memory, LLM, kernel)
2. WHEN kernel errors occur, THE AgentErrorHandler SHALL attempt kernel restart as recovery
3. WHEN execution errors occur, THE AgentErrorHandler SHALL suggest fixes based on error type
4. THE AgentErrorHandler SHALL maintain an error log with timestamps and context
5. WHEN errors exceed the threshold, THE AgentErrorHandler SHALL prune older errors

### Requirement 10: Token Budget Management

**User Story:** As a system architect, I want token usage optimized so that the agent can operate within LLM context limits.

#### Acceptance Criteria

1. WHEN building context, THE TokenOptimizer SHALL reserve tokens for the LLM response
2. THE TokenOptimizer SHALL allocate approximately 30% of available tokens for introspection data
3. WHEN token limits are exceeded, THE TokenOptimizer SHALL truncate messages and introspection data proportionally
4. THE TokenOptimizer SHALL estimate token counts for both messages and JSON structures
5. WHEN truncation is needed, THE TokenOptimizer SHALL preserve recent messages and the rolling summary

## Non-Functional Requirements

### Performance Requirements

1. THE NotebookAgent SHALL process user messages and return responses within 5 seconds for standard queries
2. THE StateManager SHALL complete state updates within 100ms
3. THE IntrospectionMemory SHALL generate introspection JSON within 200ms
4. THE KernelInterface SHALL execute code with configurable timeout (default 30 seconds)
5. THE TokenOptimizer SHALL complete context optimization within 50ms

### Scalability Requirements

1. THE StateManager SHALL support at least 1000 variables in the notebook
2. THE ChatMemory SHALL maintain at least 1000 messages before requiring truncation
3. THE MemoryManager SHALL enforce memory budgets for agent state, chat history, variable cache, and output buffer
4. THE NotebookAgent SHALL support concurrent message processing with proper locking

### Security Requirements

1. THE NotebookAgent SHALL validate and sanitize all introspection data before embedding in system prompts
2. THE NotebookAgent SHALL implement variable access control based on user permissions
3. THE KernelInterface SHALL sandbox code execution with timeout limits
4. THE StateManager SHALL ensure agent state isolation per notebook and user
5. THE NotebookAgent SHALL prevent system prompt injection attacks

### Reliability Requirements

1. THE NotebookAgent SHALL maintain conversation context across agent restarts
2. THE StateManager SHALL persist state to enable recovery after failures
3. THE KernelInterface SHALL handle kernel disconnections and reconnections
4. THE AgentErrorHandler SHALL log all errors with sufficient context for debugging
5. THE NotebookAgent SHALL gracefully degrade when token limits are exceeded

## User Stories

### User Story 1: Quick Question Answering

As a data analyst, I want to ask quick questions about my notebook data so that I can get answers without writing code.

**Scenario:** The analyst has a DataFrame loaded and wants to know its shape and column types.

**Acceptance:**
- User switches to ASK mode
- User asks: "What variables are defined and what are their types?"
- Agent responds with variable information from introspection JSON
- No code execution occurs

### User Story 2: Autonomous Data Analysis

As a data scientist, I want the agent to autonomously run analyses so that I can focus on interpretation.

**Scenario:** The scientist wants to perform exploratory data analysis on a dataset.

**Acceptance:**
- User switches to AGENT mode
- User provides a goal: "Perform EDA on the dataset and identify missing values"
- Agent creates a plan and executes steps autonomously
- Agent pauses for review after each major step
- User can approve or reject each step

### User Story 3: Planning Analysis Workflow

As a machine learning engineer, I want the agent to create a detailed plan so that I can review the approach before implementation.

**Scenario:** The engineer wants to build a classification model but wants to see the plan first.

**Acceptance:**
- User switches to PLANNER mode
- User provides a goal: "Build a classification model to predict customer churn"
- Agent generates a plan with steps, code snippets, and estimated time
- No code is executed
- User can copy code snippets to implement the plan

### User Story 4: Long-Running Conversation Context

As a researcher, I want the agent to maintain context across many interactions so that I can have extended conversations about my work.

**Scenario:** The researcher has been working with the agent for an hour, asking multiple questions.

**Acceptance:**
- User asks a question that references something discussed 30 messages ago
- Agent retrieves the rolling summary and recent messages
- Agent provides a response that demonstrates understanding of the conversation history
- Context window remains within limits due to rolling summary

### User Story 5: Variable Dependency Awareness

As a developer, I want the agent to understand variable dependencies so that it doesn't suggest changes that break downstream code.

**Scenario:** The developer asks the agent to modify a DataFrame.

**Acceptance:**
- Agent checks the introspection JSON for variables referencing the DataFrame
- Agent warns about cells that will be affected by the change
- Agent suggests a safe approach that maintains dependencies

### User Story 6: Experiment Tracking

As a researcher, I want to track experiments with metrics so that I can compare different approaches.

**Scenario:** The researcher wants to compare two feature engineering approaches.

**Acceptance:**
- User starts experiment A with cells X and Y
- Agent logs metrics for experiment A
- User starts experiment B with cells X and Z
- Agent logs metrics for experiment B
- UI displays both experiments with their metrics for comparison

## Constraints

### Technical Constraints

1. THE NotebookAgent SHALL NOT use embeddings, vector databases, or retrieval pipelines
2. THE NotebookAgent SHALL operate without external RAG infrastructure
3. THE NotebookAgent SHALL be compatible with Jupyter kernels (IPython or compatible)
4. THE NotebookAgent SHALL communicate via WebSocket for real-time updates
5. THE NotebookAgent SHALL require an LLM API client (OpenAI or Anthropic compatible)

### Performance Constraints

1. THE AgentState JSON SHALL NOT exceed 4KB to minimize system prompt size
2. THE IntrospectionJSON SHALL NOT exceed 2KB when embedded in system prompts
3. THE RollingSummary SHALL NOT exceed 500 tokens
4. THE ChatMemory SHALL truncate to a maximum of 50 messages when token limits are approached
5. THE KernelInterface execution timeout SHALL NOT exceed 120 seconds

### State Management Constraints

1. THE StateManager SHALL maintain exactly one AgentState and one UIState per notebook
2. THE AgentState SHALL use abbreviated field names (n, t, s, v, r) for compactness
3. THE UIState SHALL include full field names for frontend display
4. THE StateManager SHALL synchronize state from the kernel at least every 500ms during active sessions
5. THE StateManager SHALL notify subscribers within 50ms of state changes

### Security Constraints

1. THE NotebookAgent SHALL NOT execute arbitrary code from untrusted sources without user confirmation
2. THE NotebookAgent SHALL NOT expose sensitive variables in introspection data without authorization
3. THE NotebookAgent SHALL sanitize all user input before embedding in prompts
4. THE NotebookAgent SHALL isolate state between different users and notebooks
5. THE KernelInterface SHALL enforce resource limits (memory, CPU, execution time)

### Compatibility Constraints

1. THE NotebookAgent SHALL be compatible with Python 3.8+ notebooks
2. THE NotebookAgent SHALL support standard Jupyter message protocol
3. THE NotebookAgent SHALL work with any LLM API following OpenAI or Anthropic format
4. THE NotebookAgent SHALL require a WebSocket server for frontend communication
5. THE NotebookAgent SHALL be deployable in containerized environments

## Dependencies

- Jupyter Kernel (IPython or compatible)
- WebSocket server for real-time communication
- LLM API client (OpenAI/Anthropic compatible)
- Mutex library for thread safety
- Token counting library
- JSON serialization library

## Assumptions

1. The Jupyter kernel is already running and accessible
2. The LLM API is available and properly configured
3. Users have appropriate permissions for code execution
4. Network connectivity is available for LLM API calls
5. The notebook environment supports variable introspection

## Out of Scope

1. Notebook cell editing and creation (handled by UI)
2. File system operations beyond notebook context
3. Multi-notebook agent coordination
4. Persistent storage of notebooks (handled by notebook server)
5. User authentication and authorization (handled by notebook server)