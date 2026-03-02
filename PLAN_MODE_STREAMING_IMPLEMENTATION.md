# Plan Mode with Streaming & Agentic Execution - Implementation Plan

## Current State ✅

### What's Working:
1. ✅ Agent package (`no-rag-notebook-agent`) builds successfully
2. ✅ Controller-node builds successfully  
3. ✅ NotebookAgentAdapter integrates the agent with controller
4. ✅ AI routes support both streaming (`/assist/stream`) and non-streaming (`/assist`)
5. ✅ Plan mode exists and generates plans
6. ✅ Agentic mode exists for autonomous execution
7. ✅ WebSocket connection for kernel operations

### What's Missing:
1. ❌ Plan mode doesn't stream - generates entire plan at once
2. ❌ No "Continue" button flow from Plan → Agentic execution
3. ❌ No streaming indicators in frontend ("thinking", "generating")
4. ❌ Agentic mode not exposed to frontend
5. ❌ No real-time step-by-step feedback during agentic execution

---

## Implementation Plan

### Phase 1: Backend - Add Streaming to Plan Mode ⚡

**Goal:** Make plan generation stream in real-time so users see progress

#### 1.1 Update Plan Mode Handler
**File:** `agent/src/modes/plan.ts`

Add streaming support:
```typescript
export async function handlePlanMode(
  message: string,
  stateManager: StateManager,
  chatMemory: ChatMemory,
  introspectionMemory: IntrospectionMemory,
  llmClient?: LLMClient,
  callbacks?: StreamingCallbacks  // NEW
): Promise<AgentResponse>
```

- Stream plan steps as they're generated
- Call `callbacks.onChunk()` for each text chunk
- Call `callbacks.onPlanReady()` when operations are ready

#### 1.2 Update NotebookAgent
**File:** `agent/src/NotebookAgent.ts`

Update `processMessageStream` to pass callbacks to plan mode:
```typescript
case 'PLAN':
  response = await handlePlanMode(
    userMessage,
    this.stateManager,
    this.chatMemory,
    this.introspectionMemory,
    this.llmClient || undefined,
    callbacks  // Pass callbacks
  );
  break;
```

#### 1.3 Update LLM Client Wrapper
**File:** `apps/controller-node/src/core/ai/NotebookAgentAdapter.ts`

Add streaming support to `ControllerNodeLLMClient`:
```typescript
class ControllerNodeLLMClient implements LLMClient {
  async generateStream(
    systemPrompt: string,
    userMessage: string,
    callbacks: StreamingCallbacks
  ): Promise<void> {
    const { AIService } = await import('./AIService.js');
    const aiService = new AIService();
    
    await aiService.generateStream(
      userMessage,
      undefined,
      this.provider,
      this.model,
      null,
      {
        onChunk: callbacks.onChunk,
        onComplete: (result) => {
          callbacks.onDone?.({
            type: 'plan',
            content: result.text,
            metadata: { operations: result.operations }
          });
        }
      }
    );
  }
}
```

---

### Phase 2: Backend - Plan → Agentic Flow 🔄

**Goal:** Allow users to click "Continue" on a plan to execute it

#### 2.1 Add Continue Endpoint
**File:** `apps/controller-node/src/routes/ai.ts`

```typescript
fastify.post('/plan/continue', async (request, reply) => {
  const { sessionId, operations } = request.body;
  
  // Switch to AGENTIC mode
  await notebookAgentAdapter.setMode(sessionId, 'AGENTIC');
  
  // Execute the plan operations
  const result = await notebookAgentAdapter.executePlan(
    sessionId,
    operations
  );
  
  return result;
});
```

#### 2.2 Add executePlan Method
**File:** `apps/controller-node/src/core/ai/NotebookAgentAdapter.ts`

```typescript
async executePlan(
  sessionId: string,
  operations: Array<{ type: string; params: Record<string, any> }>
): Promise<AgentResponse> {
  const agent = await this.getOrCreateAgent(sessionId);
  
  // Convert operations to execution message
  const message = `Execute the following plan:\n${JSON.stringify(operations, null, 2)}`;
  
  return agent.processMessage(message);
}
```

#### 2.3 Update Agentic Mode for Plan Execution
**File:** `agent/src/modes/agentic.ts`

Add support for executing pre-generated plans:
- Detect if message contains operations JSON
- Execute operations step-by-step
- Stream progress via callbacks

---

### Phase 3: Frontend - Streaming UI 🎨

**Goal:** Show real-time feedback during AI generation

#### 3.1 Create useAgentStream Hook
**File:** `apps/desktop-ui/src/hooks/useAgentStream.ts`

```typescript
export function useAgentStream() {
  const [isThinking, setIsThinking] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [operations, setOperations] = useState([]);
  
  const sendMessage = async (message: string, mode: string) => {
    const eventSource = new EventSource(
      `/api/ai/assist/stream?prompt=${encodeURIComponent(message)}&mode=${mode}`
    );
    
    eventSource.addEventListener('chunk', (e) => {
      const data = JSON.parse(e.data);
      setStreamingText(prev => prev + data.delta);
    });
    
    eventSource.addEventListener('plan_ready', (e) => {
      const data = JSON.parse(e.data);
      setOperations(data.operations);
    });
    
    eventSource.addEventListener('done', (e) => {
      eventSource.close();
      setIsThinking(false);
    });
  };
  
  return { isThinking, streamingText, operations, sendMessage };
}
```

#### 3.2 Update Chat Component
**File:** `apps/desktop-ui/src/components/Chat/Chat.tsx`

```typescript
const { isThinking, streamingText, operations, sendMessage } = useAgentStream();

// Show thinking indicator
{isThinking && (
  <div className="thinking-indicator">
    <Spinner /> Thinking...
  </div>
)}

// Show streaming text
{streamingText && (
  <div className="streaming-message">
    {streamingText}
  </div>
)}

// Show Continue/Cancel buttons for plans
{operations.length > 0 && (
  <div className="plan-actions">
    <button onClick={handleContinue}>Continue</button>
    <button onClick={handleCancel}>Cancel</button>
  </div>
)}
```

#### 3.3 Add Plan Actions
**File:** `apps/desktop-ui/src/components/Chat/PlanActions.tsx`

```typescript
export function PlanActions({ operations, sessionId }) {
  const handleContinue = async () => {
    const response = await fetch('/api/ai/plan/continue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, operations })
    });
    // Handle execution result
  };
  
  const handleCancel = () => {
    // Clear operations and return to normal mode
  };
  
  return (
    <div className="plan-actions">
      <button onClick={handleContinue}>
        ▶️ Continue with this plan
      </button>
      <button onClick={handleCancel}>
        ❌ Cancel
      </button>
    </div>
  );
}
```

---

### Phase 4: Frontend - Agentic Execution Feedback 📊

**Goal:** Show step-by-step progress during autonomous execution

#### 4.1 Add Step Progress Component
**File:** `apps/desktop-ui/src/components/Chat/AgenticProgress.tsx`

```typescript
export function AgenticProgress({ steps }) {
  return (
    <div className="agentic-progress">
      {steps.map((step, i) => (
        <div key={i} className={`step step-${step.status}`}>
          <div className="step-header">
            {step.status === 'running' && <Spinner />}
            {step.status === 'success' && '✅'}
            {step.status === 'error' && '❌'}
            <span>Step {i + 1}: {step.description}</span>
          </div>
          {step.output && (
            <pre className="step-output">{step.output}</pre>
          )}
        </div>
      ))}
    </div>
  );
}
```

#### 4.2 Update useAgentStream for Agentic Mode
Add event listeners for:
- `step_start` - Show step is starting
- `step_complete` - Show step result
- `step_error` - Show step failed

---

### Phase 5: Testing & Polish ✨

#### 5.1 Test Scenarios
1. **Plan Mode Streaming**
   - User asks: "Load and analyze the iris dataset"
   - Verify: Plan streams in real-time
   - Verify: Continue/Cancel buttons appear

2. **Plan → Agentic Execution**
   - Click "Continue" on a plan
   - Verify: Switches to agentic mode
   - Verify: Steps execute one by one
   - Verify: Progress shown in real-time

3. **Error Handling**
   - Plan with syntax error
   - Verify: Error shown with retry option
   - Verify: User can fix and retry

#### 5.2 UI Polish
- Add loading skeletons
- Add smooth transitions
- Add success/error animations
- Add keyboard shortcuts (Enter to continue, Esc to cancel)

---

## File Summary

### Files to Modify:
1. `agent/src/modes/plan.ts` - Add streaming
2. `agent/src/modes/agentic.ts` - Support plan execution
3. `agent/src/NotebookAgent.ts` - Pass callbacks
4. `apps/controller-node/src/core/ai/NotebookAgentAdapter.ts` - Add streaming & executePlan
5. `apps/controller-node/src/routes/ai.ts` - Add /plan/continue endpoint
6. `apps/desktop-ui/src/hooks/useAgentStream.ts` - NEW streaming hook
7. `apps/desktop-ui/src/components/Chat/Chat.tsx` - Add streaming UI
8. `apps/desktop-ui/src/components/Chat/PlanActions.tsx` - NEW plan actions
9. `apps/desktop-ui/src/components/Chat/AgenticProgress.tsx` - NEW progress display

### Estimated Time:
- Phase 1: 2-3 hours
- Phase 2: 2-3 hours
- Phase 3: 3-4 hours
- Phase 4: 2-3 hours
- Phase 5: 2-3 hours
**Total: 11-16 hours**

---

## Next Steps

Ready to proceed? I can start with Phase 1 (Backend Streaming) and work through each phase systematically.

Just say "continue" and I'll begin implementation! 🚀
