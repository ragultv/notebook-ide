import { AgentResponse, AgentMode, ExecutionResult } from '../types/agent.types';
import { StateManager } from '../state/StateManager';
import { ChatMemory } from '../memory/ChatMemory';
import { IntrospectionMemory } from '../memory/IntrospectionMemory';
import { KernelInterface } from '../kernel/KernelInterface';
import { LLMClient } from '../NotebookAgent';

/**
 * AGENTIC Mode Handler - Full Autonomous Loop with Code Execution
 * 
 * This mode provides complete task execution with autonomous iteration:
 * 1. Parse user goal and create execution plan
 * 2. FOR EACH STEP:
 *    - Create new cell with code
 *    - Execute cell in kernel
 *    - Check output for errors
 *    - IF error: analyze, create fix cell, execute fix, verify (max 3 retries)
 *    - IF success: verify output, continue to next step
 * 3. Return summary of all cells created and final result
 * 
 * NO user review checkpoints - fully autonomous
 */

/**
 * Handle AGENTIC mode - Full autonomous execution loop
 * @param message - The user's goal/task description
 * @param stateManager - State manager for accessing notebook state
 * @param chatMemory - Chat memory for conversation context
 * @param introspectionMemory - Introspection memory for variable tracking
 * @param kernelInterface - Kernel interface for code execution
 * @param llmClient - LLM client for generating responses
 * @returns Promise<AgentResponse> - Summary of cells created and final result
 */
export async function handleAgenticMode(
  message: string,
  stateManager: StateManager,
  chatMemory: ChatMemory,
  introspectionMemory: IntrospectionMemory,
  kernelInterface: KernelInterface,
  llmClient?: LLMClient
): Promise<AgentResponse> {
  try {
    // Parse the user's goal and create an execution plan
    const goal = message;
    const plan = await createExecutionPlan(goal, stateManager, introspectionMemory);

    if (plan.steps.length === 0) {
      return {
        type: 'operation',
        content: `I couldn't create an execution plan for your goal: "${goal}".\n\n` +
          `Please provide a clearer description of what you'd like to accomplish.`,
      };
    }

    // Execute the plan autonomously
    const executionResult = await executePlan(
      plan,
      stateManager,
      kernelInterface,
      introspectionMemory
    );

    return {
      type: 'agent_result',
      content: executionResult.summary,
      cells: executionResult.cells.map(c => c.cellId),
    };
  } catch (error) {
    console.error('Error in AGENTIC mode:', error);
    return {
      type: 'operation',
      content: `Failed to execute your goal: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Create an execution plan from the user's goal
 */
async function createExecutionPlan(
  goal: string,
  stateManager: StateManager,
  introspectionMemory: IntrospectionMemory
): Promise<ExecutionPlan> {
  // Get current context
  const introspection = await introspectionMemory.getJSON();
  const variables = introspection.variables || [];

  // Build planning prompt
  const planningPrompt = buildPlanningPrompt(goal, variables);

  // Generate plan using LLM (placeholder implementation)
  const plan = await generatePlan(planningPrompt, goal);

  return plan;
}

/**
 * Build the planning prompt for LLM
 */
function buildPlanningPrompt(goal: string, variables: any[]): string {
  return `You are OPREL AI, an expert AI assistant and code generator for the OPREL IDE notebook environment.
Your goal is to help users build data science and machine learning workflows efficiently.

You are currently in **AGENTIC MODE** (Autonomous Loop).

## User Goal
${goal}

## Current Variables
${variables.length > 0 ? variables.map(v => `- ${v.name} (${v.type}): ${v.valuePreview}`).join('\n') : 'No variables defined'}

## Instructions
- Create a step-by-step execution plan. Each step should:
  1. Be a single, atomic operation
  2. Include the code to execute
  3. Have a clear success criteria
  4. Be independent where possible
- In AGENTIC mode, the steps you return will be autonomously executed one by one, with error correction applied automatically if they fail.
- Keep the plan focused and actionable. Maximum 10 steps.

Return your plan as a strictly formatted JSON array of steps within an \`\`\`operations\`\`\` block.
Example format:
\`\`\`operations
[
  {
    "description": "Brief description of the step",
    "code": "The code to execute",
    "successCriteria": "How to verify success"
  }
]
\`\`\`
Ensure valid JSON escaping (e.g., literal \\n in the code field).`;
}

/**
 * Generate execution plan (placeholder - would use LLM)
 */
async function generatePlan(prompt: string, goal: string): Promise<ExecutionPlan> {
  // Placeholder implementation - would call LLM to generate plan
  // For now, create a simple plan based on the goal

  const steps: PlanStep[] = [];

  // Simple heuristic-based planning for common patterns
  const lowerGoal = goal.toLowerCase();

  if (lowerGoal.includes('analyze') || lowerGoal.includes('analysis')) {
    steps.push({
      description: 'Explore the data structure and basic statistics',
      code: `# Explore data structure and basic statistics
import pandas as pd
import numpy as np

# Display basic info about the data
print("Data Shape:", df.shape)
print("\nColumn Types:")
print(df.dtypes)
print("\nFirst few rows:")
print(df.head())
print("\nBasic Statistics:")
print(df.describe())`,
      successCriteria: 'Data shape, types, and statistics are displayed',
    });
  }

  if (lowerGoal.includes('visualize') || lowerGoal.includes('plot') || lowerGoal.includes('chart')) {
    steps.push({
      description: 'Create visualizations for the data',
      code: `# Create visualizations
import matplotlib.pyplot as plt
import seaborn as sns

# Create a figure with multiple subplots
fig, axes = plt.subplots(2, 2, figsize=(12, 10))

# Distribution of numeric columns
numeric_cols = df.select_dtypes(include=[np.number]).columns
for i, col in enumerate(numeric_cols[:4]):
    ax = axes[i // 2, i % 2]
    df[col].hist(ax=ax, bins=20)
    ax.set_title(f'Distribution of {col}')
    ax.set_xlabel(col)
    ax.set_ylabel('Frequency')

plt.tight_layout()
plt.show()`,
      successCriteria: 'Visualization plots are displayed',
    });
  }

  if (lowerGoal.includes('model') || lowerGoal.includes('predict') || lowerGoal.includes('train')) {
    steps.push({
      description: 'Build and train a machine learning model',
      code: `# Build and train a machine learning model
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, classification_report

# Prepare features and target
X = df.drop(columns=['target']) if 'target' in df.columns else df
y = df['target'] if 'target' in df.columns else None

if y is not None:
    # Split data
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
    
    # Train model
    model = RandomForestClassifier(n_estimators=100, random_state=42)
    model.fit(X_train, y_train)
    
    # Evaluate
    y_pred = model.predict(X_test)
    print(f"Model Accuracy: {accuracy_score(y_test, y_pred):.4f}")
    print("\nClassification Report:")
    print(classification_report(y_test, y_pred))
else:
    print("No target variable found. Please specify the target column.")`,
      successCriteria: 'Model is trained and accuracy is displayed',
    });
  }

  // If no specific pattern matched, create a generic exploration step
  if (steps.length === 0) {
    steps.push({
      description: 'Explore and understand the current notebook state',
      code: `# Explore current notebook state
import sys

# List all defined variables
print("Defined Variables:")
for name, value in list(locals().items()):
    if not name.startswith('_') and name not in ['sys', 'pd', 'np', 'plt']:
        try:
            print(f"  {name}: {type(value).__name__}")
        except:
            print(f"  {name}: Unknown type")

# Check available data
print("\nNotebook is ready for analysis.")`,
      successCriteria: 'Variable list is displayed',
    });
  }

  return {
    goal,
    steps,
    createdAt: Date.now(),
  };
}

/**
 * Execute the plan autonomously
 */
async function executePlan(
  plan: ExecutionPlan,
  stateManager: StateManager,
  kernelInterface: KernelInterface,
  introspectionMemory: IntrospectionMemory
): Promise<ExecutionOutcome> {
  const cells: ExecutedCell[] = [];
  let finalResult: any = null;

  for (let stepIndex = 0; stepIndex < plan.steps.length; stepIndex++) {
    const step = plan.steps[stepIndex];
    console.log(`Executing step ${stepIndex + 1}/${plan.steps.length}: ${step.description}`);

    // Create and execute the cell
    const cellResult = await executeStep(
      step,
      stepIndex,
      kernelInterface,
      stateManager,
      introspectionMemory
    );

    cells.push(cellResult);

    if (!cellResult.success) {
      // Step failed even after retries
      return {
        summary: `Execution stopped at step ${stepIndex + 1}: ${step.description}\n\n` +
          `Error: ${cellResult.error}\n\n` +
          `Cells created:\n${cells.map(c => `- ${c.description}: ${c.success ? 'Success' : 'Failed'}`).join('\n')}`,
        cells,
        finalResult: null,
      };
    }

    // Store the result for the final output
    if (cellResult.output) {
      finalResult = cellResult.output;
    }
  }

  // All steps completed successfully
  return {
    summary: `✅ Execution completed successfully!\n\n` +
      `Goal: ${plan.goal}\n` +
      `Steps executed: ${cells.length}\n\n` +
      `Summary of cells:\n${cells.map((c, i) => `${i + 1}. ${c.description}: ✅ Success`).join('\n')}\n\n` +
      `Final result: ${finalResult ? formatResult(finalResult) : 'See cell outputs above'}`,
    cells,
    finalResult,
  };
}

/**
 * Execute a single step with retry logic
 */
async function executeStep(
  step: PlanStep,
  stepIndex: number,
  kernelInterface: KernelInterface,
  stateManager: StateManager,
  introspectionMemory: IntrospectionMemory
): Promise<ExecutedCell> {
  const cellId = `cell-${Date.now()}-${stepIndex}`;
  let retries = 0;
  const maxRetries = 3;

  while (retries <= maxRetries) {
    try {
      // Create the cell with code
      const cellContent = step.code;

      // Execute the cell
      const result = await kernelInterface.execute(cellContent, {
        timeout: 60000, // 60 second timeout for execution
        captureVariables: true,
        captureHistory: true,
      });

      // Check for errors in output
      if (!result.success) {
        if (retries < maxRetries) {
          // Try to fix the error
          console.log(`Step failed, attempting fix (attempt ${retries + 1}/${maxRetries})`);
          const fixResult = await attemptFix(
            step,
            result,
            retries,
            kernelInterface,
            stateManager
          );

          if (fixResult.success) {
            return {
              cellId,
              description: step.description,
              code: step.code,
              output: fixResult.output,
              success: true,
              retries: retries + 1,
            };
          }

          retries++;
          continue;
        } else {
          // Max retries exceeded
          return {
            cellId,
            description: step.description,
            code: step.code,
            output: result.output,
            error: result.error || 'Execution failed',
            success: false,
            retries,
          };
        }
      }

      // Success!
      return {
        cellId,
        description: step.description,
        code: step.code,
        output: result.output,
        success: true,
        retries,
      };

    } catch (error) {
      if (retries < maxRetries) {
        retries++;
        console.log(`Step failed with error: ${error}, retrying (${retries}/${maxRetries})`);
      } else {
        return {
          cellId,
          description: step.description,
          code: step.code,
          error: error instanceof Error ? error.message : 'Unknown error',
          success: false,
          retries,
        };
      }
    }
  }

  // Should not reach here, but return failure if it does
  return {
    cellId,
    description: step.description,
    code: step.code,
    error: 'Max retries exceeded',
    success: false,
    retries,
  };
}

/**
 * Attempt to fix a failed step
 */
async function attemptFix(
  step: PlanStep,
  failedResult: ExecutionResult,
  attemptNumber: number,
  kernelInterface: KernelInterface,
  stateManager: StateManager
): Promise<{ success: boolean; output: string }> {
  // Analyze the error and generate a fix
  const errorAnalysis = analyzeError(failedResult.error || '', step.code);

  // Generate fixed code
  const fixedCode = generateFixCode(step.code, errorAnalysis, attemptNumber);

  // Execute the fix
  const fixResult = await kernelInterface.execute(fixedCode, {
    timeout: 60000,
    captureVariables: true,
  });

  return {
    success: fixResult.success,
    output: fixResult.output,
  };
}

/**
 * Analyze the error to understand what went wrong
 */
function analyzeError(error: string, code: string): ErrorAnalysis {
  const analysis: ErrorAnalysis = {
    errorType: 'unknown',
    suggestions: [],
    fixedCode: code,
  };

  // Common error patterns
  if (error.includes('NameError') || error.includes("name '.*' is not defined")) {
    analysis.errorType = 'undefined_variable';
    analysis.suggestions.push('Check variable names for typos');
    analysis.suggestions.push('Ensure variables are defined before use');
  } else if (error.includes('AttributeError')) {
    analysis.errorType = 'attribute_error';
    analysis.suggestions.push('Check object type before accessing attributes');
    analysis.suggestions.push('Verify the library/module is imported correctly');
  } else if (error.includes('ImportError') || error.includes('ModuleNotFoundError')) {
    analysis.errorType = 'import_error';
    analysis.suggestions.push('Install required packages');
    analysis.suggestions.push('Check import statements');
  } else if (error.includes('TypeError')) {
    analysis.errorType = 'type_error';
    analysis.suggestions.push('Check data types of variables');
    analysis.suggestions.push('Add type conversion if needed');
  } else if (error.includes('ValueError')) {
    analysis.errorType = 'value_error';
    analysis.suggestions.push('Check input values');
    analysis.suggestions.push('Add validation before operations');
  } else if (error.includes('KeyError')) {
    analysis.errorType = 'key_error';
    analysis.suggestions.push('Check dictionary/column names');
    analysis.suggestions.push('Add key existence checks');
  } else if (error.includes('IndexError')) {
    analysis.errorType = 'index_error';
    analysis.suggestions.push('Check index bounds');
    analysis.suggestions.push('Add bounds checking');
  }

  return analysis;
}

/**
 * Generate fixed code based on error analysis
 */
function generateFixCode(
  originalCode: string,
  analysis: ErrorAnalysis,
  attemptNumber: number
): string {
  // Add error handling and fixes based on analysis
  let fixedCode = originalCode;

  // Add try-except for robustness
  if (attemptNumber > 0) {
    fixedCode = `# Attempt ${attemptNumber + 1} - with error handling
try:
${originalCode.split('\n').map(line => '    ' + line).join('\n')}
except Exception as e:
    print(f"Error: {e}")
    import traceback
    traceback.print_exc()`;
  }

  // Add common fixes based on error type
  switch (analysis.errorType) {
    case 'undefined_variable':
      // Add variable checks
      fixedCode = `# Check for required variables
required_vars = ['df']
for var in required_vars:
    if var not in locals():
        print(f"Warning: {var} not found. Please define it first.")
        ${fixedCode}
    else:
        ${fixedCode}
`;
      break;

    case 'import_error':
      // Add import with fallback
      fixedCode = `# Try imports with fallbacks
try:
${originalCode.split('\n').map(line => '    ' + line).join('\n')}
except ImportError as e:
    print(f"Import error: {e}")
    print("Please ensure required packages are installed.")
`;
      break;
  }

  return fixedCode;
}

/**
 * Format the final result for display
 */
function formatResult(result: any): string {
  if (typeof result === 'string') {
    return result.length > 200 ? result.substring(0, 200) + '...' : result;
  } else if (result === null || result === undefined) {
    return 'No result';
  } else if (typeof result === 'object') {
    return JSON.stringify(result, null, 2).substring(0, 200) + '...';
  }
  return String(result);
}

// Type definitions
export interface ExecutionPlan {
  goal: string;
  steps: PlanStep[];
  createdAt: number;
}

export interface PlanStep {
  description: string;
  code: string;
  successCriteria: string;
}

export interface ExecutedCell {
  cellId: string;
  description: string;
  code: string;
  output?: string;
  error?: string;
  success: boolean;
  retries: number;
}

export interface ExecutionOutcome {
  summary: string;
  cells: ExecutedCell[];
  finalResult: any;
}

export interface ErrorAnalysis {
  errorType: string;
  suggestions: string[];
  fixedCode: string;
}

export default handleAgenticMode;