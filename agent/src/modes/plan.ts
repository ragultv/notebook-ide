import { AgentResponse, AgentMode, PlanStep } from '../types/agent.types';
import { StateManager } from '../state/StateManager';
import { ChatMemory } from '../memory/ChatMemory';
import { IntrospectionMemory } from '../memory/IntrospectionMemory';
import { LLMClient } from '../NotebookAgent';

/**
 * PLAN Mode Handler - Generate High-Level Plans WITHOUT Execution
 * 
 * This mode generates detailed plans with code snippets but does NOT execute them.
 * The user can then:
 * - Click "Continue" to confirm execution (switches to AGENTIC mode)
 * - Click "Cancel" to discard the plan
 * 
 * Plans include:
 * - Step-by-step breakdown
 * - Code snippets for each step
 * - Estimated time for each step
 * - Dependencies between steps
 */

/**
 * Handle PLAN mode - Generate plans without execution
 * @param message - The user's goal/task description
 * @param stateManager - State manager for accessing notebook state
 * @param chatMemory - Chat memory for conversation context
 * @param introspectionMemory - Introspection memory for variable tracking
 * @param llmClient - LLM client for generating responses
 * @returns Promise<AgentResponse> - Plan with Continue/Cancel options
 */
export async function handlePlanMode(
  message: string,
  stateManager: StateManager,
  chatMemory: ChatMemory,
  introspectionMemory: IntrospectionMemory,
  llmClient?: LLMClient
): Promise<AgentResponse> {
  try {
    // Parse the user's goal and create a detailed plan
    const goal = message;
    const plan = await createDetailedPlan(goal, stateManager, introspectionMemory);

    if (plan.steps.length === 0) {
      return {
        type: 'answer',
        content: `I couldn't create a plan for your goal: "${goal}".\n\n` +
          `Please provide a clearer description of what you'd like to accomplish.`,
      };
    }

    // Format the plan for display
    const formattedPlan = formatPlan(plan);

    return {
      type: 'plan',
      content: formattedPlan.content,
      metadata: { plan: formattedPlan.plan, suggestions: ['Continue', 'Cancel'] },
    };
  } catch (error) {
    console.error('Error in PLAN mode:', error);
    return {
      type: 'answer',
      content: `Failed to create a plan: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Create a detailed execution plan from the user's goal
 */
async function createDetailedPlan(
  goal: string,
  stateManager: StateManager,
  introspectionMemory: IntrospectionMemory
): Promise<DetailedPlan> {
  // Get current context
  const introspection = await introspectionMemory.getJSON();
  const variables = introspection.variables || [];
  const uiState = stateManager.getUIState();

  // Build comprehensive planning prompt
  const planningPrompt = buildComprehensivePlanningPrompt(goal, variables, uiState);

  // Generate detailed plan using LLM (placeholder implementation)
  const plan = await generateDetailedPlan(planningPrompt, goal, variables);

  return plan;
}

/**
 * Build a comprehensive planning prompt
 */
function buildComprehensivePlanningPrompt(
  goal: string,
  variables: any[],
  uiState: any
): string {
  return `You are OPREL AI, an expert AI assistant and code generator for the OPREL IDE notebook environment.
Your goal is to help users build data science and machine learning workflows efficiently.

You are currently in **PLAN MODE**.

## User Goal
${goal}

## Current Notebook State
${JSON.stringify({
    variables: variables.map(v => ({ name: v.name, type: v.type })),
    cellCount: uiState.cellStates?.size || 0,
    kernelStatus: uiState.kernelStatus,
  }, null, 2)}

## Instructions
- First, carefully understand the user's goal and current notebook state.
- Then produce a clear, structured plan as a numbered list of steps describing what you will change or create.
- After the plan, you may include a single \`\`\`operations\`\`\` block with a JSON array of operations that would implement this plan.
- Keep the plan and operations tightly consistent (each operation should map to one of the steps).
- Keep the tone collaborative: briefly confirm assumptions and highlight important consequences of the plan.

**JSON OPERATIONS FORMAT (CRITICAL):**
- You act by returning a list of operations in a strict JSON format.
- Operations MUST appear in exactly one \`\`\`operations\`\`\` block as a JSON array. No other JSON elsewhere.
- Output exactly this structure. No extra fields. Only these operation types.
- **Content Escaping**: In the "content" field you MUST use literal \\n for newlines (valid JSON).
  - CORRECT: "content": "import pandas as pd\\nimport numpy as np"
  - INCORRECT: using real newlines inside the JSON string.

**STRICT OPERATIONS SCHEMA (use only these):**
- add_cell: {"type": "add_cell", "params": {"type": "code"|"markdown", "content": "string", "notebookName": "string"}}
- edit_cell: {"type": "edit_cell", "params": {"cellIndex": number (1-based), "content": "string", "type": "code|markdown"}}
- delete_cell: {"type": "delete_cell", "params": {"cellIndex": number}}
- create_notebook: {"type": "create_notebook", "params": {"name": "string"}}

Format your plan clearly, followed by the operations block if applicable.`;
}

/**
 * Generate a detailed plan (placeholder - would use LLM)
 */
async function generateDetailedPlan(
  prompt: string,
  goal: string,
  variables: any[]
): Promise<DetailedPlan> {
  // Placeholder implementation - would call LLM to generate plan
  // For now, create a detailed plan based on common patterns

  const steps: DetailedStep[] = [];
  let totalTime = 0;

  const lowerGoal = goal.toLowerCase();

  // Data analysis plan
  if (lowerGoal.includes('analyze') || lowerGoal.includes('analysis') ||
    lowerGoal.includes('explore') || lowerGoal.includes('eda')) {
    steps.push({
      stepNumber: 1,
      description: 'Load and explore the data structure',
      code: `# Step 1: Load and explore data structure
import pandas as pd
import numpy as np

# Load data (adjust filename as needed)
# df = pd.read_csv('your_data.csv')

# Display basic information
print("=" * 50)
print("DATA OVERVIEW")
print("=" * 50)
print(f"Shape: {df.shape}")
print(f"\nColumn Types:\n{df.dtypes}")
print(f"\nFirst 5 rows:\n{df.head()}")
print(f"\nMissing values:\n{df.isnull().sum()}")
print(f"\nBasic Statistics:\n{df.describe()}")`,
      estimatedTime: 3,
      dependencies: [],
      successCriteria: 'Data shape, types, and statistics displayed without errors',
    });

    steps.push({
      stepNumber: 2,
      description: 'Data quality assessment and cleaning',
      code: `# Step 2: Data quality assessment and cleaning
print("=" * 50)
print("DATA QUALITY ASSESSMENT")
print("=" * 50)

# Check for duplicates
duplicates = df.duplicated().sum()
print(f"Duplicate rows: {duplicates}")

# Check data types
print(f"\nData types requiring conversion: {df.select_dtypes(['object']).columns.tolist()}")

# Handle missing values (example strategies)
for col in df.columns:
    if df[col].isnull().sum() > 0:
        null_pct = df[col].isnull().sum() / len(df) * 100
        print(f"Column '{col}': {null_pct:.1f}% missing values")
        if null_pct < 5:
            # Fill numeric with median, categorical with mode
            if df[col].dtype in ['int64', 'float64']:
                df[col].fillna(df[col].median(), inplace=True)
            else:
                df[col].fillna(df[col].mode()[0], inplace=True)

print("\nData cleaning completed.")`,
      estimatedTime: 5,
      dependencies: [1],
      successCriteria: 'Missing values handled, duplicates identified',
    });

    steps.push({
      stepNumber: 3,
      description: 'Statistical analysis and insights',
      code: `# Step 3: Statistical analysis and insights
print("=" * 50)
print("STATISTICAL ANALYSIS")
print("=" * 50)

# Correlation analysis for numeric columns
numeric_df = df.select_dtypes(include=[np.number])
if not numeric_df.empty:
    print("\nCorrelation Matrix (top 10 by absolute value):")
    corr_matrix = numeric_df.corr()
    # Get top correlations
    corr_pairs = []
    for i in range(len(corr_matrix.columns)):
        for j in range(i+1, len(corr_matrix.columns)):
            corr_pairs.append({
                'pair': f"{corr_matrix.columns[i]} x {corr_matrix.columns[j]}",
                'correlation': corr_matrix.iloc[i, j]
            })
    corr_pairs.sort(key=lambda x: abs(x['correlation']), reverse=True)
    for pair in corr_pairs[:10]:
        print(f"  {pair['pair']}: {pair['correlation']:.3f}")

# Distribution analysis
print("\nDistribution Summary:")
for col in numeric_df.columns[:5]:  # First 5 numeric columns
    print(f"  {col}: mean={numeric_df[col].mean():.2f}, std={numeric_df[col].std():.2f}")`,
      estimatedTime: 4,
      dependencies: [2],
      successCriteria: 'Correlation matrix and statistics displayed',
    });

    totalTime = 12;
  }

  // Machine learning plan
  else if (lowerGoal.includes('model') || lowerGoal.includes('predict') ||
    lowerGoal.includes('train') || lowerGoal.includes('classification') ||
    lowerGoal.includes('regression')) {
    steps.push({
      stepNumber: 1,
      description: 'Prepare data for modeling',
      code: `# Step 1: Prepare data for modeling
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler, LabelEncoder
import pandas as pd

print("=" * 50)
print("DATA PREPARATION FOR MODELING")
print("=" * 50)

# Identify target variable (ask user or use common patterns)
# For this example, assume 'target' is the target column
target_col = 'target'  # Change this to your target column

if target_col not in df.columns:
    print(f"Error: Target column '{target_col}' not found.")
    print("Available columns:", df.columns.tolist())
else:
    # Separate features and target
    X = df.drop(columns=[target_col])
    y = df[target_col]
    
    # Handle categorical variables
    categorical_cols = X.select_dtypes(include=['object']).columns
    print(f"Categorical columns to encode: {categorical_cols.tolist()}")
    
    # Encode categorical variables
    le = LabelEncoder()
    for col in categorical_cols:
        X[col] = le.fit_transform(X[col].astype(str))
    
    # Handle missing values
    X = X.fillna(X.median())
    
    # Split data
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y if y.nunique() > 1 else None
    )
    
    # Scale features
    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train)
    X_test_scaled = scaler.transform(X_test)
    
    print(f"Training set: {X_train.shape[0]} samples")
    print(f"Test set: {X_test.shape[0]} samples")
    print("Data preparation completed.")`,
      estimatedTime: 5,
      dependencies: [],
      successCriteria: 'Data split into train/test sets without errors',
    });

    steps.push({
      stepNumber: 2,
      description: 'Train and evaluate baseline model',
      code: `# Step 2: Train and evaluate baseline model
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.linear_model import LogisticRegression, LinearRegression
from sklearn.metrics import accuracy_score, mean_squared_error, classification_report
import numpy as np

print("=" * 50)
print("BASELINE MODEL TRAINING")
print("=" * 50)

# Determine if classification or regression
is_classification = y.nunique() < 20  # Heuristic for classification

if is_classification:
    # Classification
    model = RandomForestClassifier(n_estimators=100, random_state=42, n_jobs=-1)
    model.fit(X_train_scaled, y_train)
    y_pred = model.predict(X_test_scaled)
    
    accuracy = accuracy_score(y_test, y_pred)
    print(f"\nBaseline Model: Random Forest Classifier")
    print(f"Accuracy: {accuracy:.4f} ({accuracy*100:.2f}%)")
    print(f"\nClassification Report:")
    print(classification_report(y_test, y_pred))
else:
    # Regression
    model = RandomForestRegressor(n_estimators=100, random_state=42, n_jobs=-1)
    model.fit(X_train_scaled, y_train)
    y_pred = model.predict(X_test_scaled)
    
    mse = mean_squared_error(y_test, y_pred)
    rmse = np.sqrt(mse)
    print(f"\nBaseline Model: Random Forest Regressor")
    print(f"RMSE: {rmse:.4f}")
    print(f"R² Score: {model.score(X_test_scaled, y_test):.4f}")

print("\nBaseline model training completed.")`,
      estimatedTime: 5,
      dependencies: [1],
      successCriteria: 'Model trained and accuracy/rmse displayed',
    });

    steps.push({
      stepNumber: 3,
      description: 'Feature importance analysis',
      code: `# Step 3: Feature importance analysis
import matplotlib.pyplot as plt

print("=" * 50)
print("FEATURE IMPORTANCE ANALYSIS")
print("=" * 50)

# Get feature importances
feature_importance = pd.DataFrame({
    'feature': X.columns,
    'importance': model.feature_importances_
}).sort_values('importance', ascending=False)

print("\nTop 10 Most Important Features:")
print(feature_importance.head(10).to_string(index=False))

# Plot feature importance
plt.figure(figsize=(10, 6))
plt.barh(feature_importance['feature'][:10], feature_importance['importance'][:10])
plt.xlabel('Importance')
plt.ylabel('Feature')
plt.title('Top 10 Feature Importances')
plt.gca().invert_yaxis()
plt.tight_layout()
plt.show()

print("\nFeature importance analysis completed.")`,
      estimatedTime: 3,
      dependencies: [2],
      successCriteria: 'Feature importance plot displayed',
    });

    totalTime = 13;
  }

  // Visualization plan
  else if (lowerGoal.includes('visualize') || lowerGoal.includes('plot') ||
    lowerGoal.includes('chart') || lowerGoal.includes('graph')) {
    steps.push({
      stepNumber: 1,
      description: 'Create comprehensive visualizations',
      code: `# Step 1: Create comprehensive visualizations
import matplotlib.pyplot as plt
import seaborn as sns
import numpy as np

print("=" * 50)
print("DATA VISUALIZATION")
print("=" * 50)

# Set style
plt.style.use('seaborn-v0_8-whitegrid')
fig, axes = plt.subplots(2, 2, figsize=(14, 10))

# 1. Distribution plots for numeric columns
numeric_cols = df.select_dtypes(include=[np.number]).columns[:4]
for i, col in enumerate(numeric_cols):
    ax = axes[i // 2, i % 2]
    df[col].hist(ax=ax, bins=20, edgecolor='black', alpha=0.7)
    ax.set_title(f'Distribution of {col}')
    ax.set_xlabel(col)
    ax.set_ylabel('Frequency')

plt.suptitle('Distribution Analysis', fontsize=14, fontweight='bold')
plt.tight_layout()
plt.savefig('distributions.png', dpi=150, bbox_inches='tight')
plt.show()

print("Distribution plots saved to 'distributions.png'")`,
      estimatedTime: 4,
      dependencies: [],
      successCriteria: 'Distribution plots displayed and saved',
    });

    steps.push({
      stepNumber: 2,
      description: 'Correlation heatmap and scatter plots',
      code: `# Step 2: Correlation heatmap and scatter plots
fig, axes = plt.subplots(1, 2, figsize=(14, 5))

# Correlation heatmap
numeric_df = df.select_dtypes(include=[np.number])
corr_matrix = numeric_df.corr()
sns.heatmap(corr_matrix, annot=True, cmap='coolwarm', center=0, ax=axes[0], fmt='.2f')
axes[0].set_title('Correlation Heatmap')

# Scatter plot matrix for top correlated variables
# (showing first 4 numeric columns)
if len(numeric_cols) >= 2:
    sns.scatterplot(data=df, x=numeric_cols[0], y=numeric_cols[1], ax=axes[1], alpha=0.6)
    axes[1].set_title(f'{numeric_cols[0]} vs {numeric_cols[1]}')

plt.tight_layout()
plt.savefig('correlations.png', dpi=150, bbox_inches='tight')
plt.show()

print("Correlation plots saved to 'correlations.png'")`,
      estimatedTime: 3,
      dependencies: [1],
      successCriteria: 'Correlation heatmap and scatter plots displayed',
    });

    totalTime = 7;
  }

  // Default plan if no specific pattern matched
  if (steps.length === 0) {
    steps.push({
      stepNumber: 1,
      description: 'Explore current notebook state and variables',
      code: `# Step 1: Explore current notebook state
import sys

print("=" * 50)
print("NOTEBOOK STATE EXPLORATION")
print("=" * 50)

# List all defined variables
print("\nDefined Variables:")
for name, value in list(locals().items()):
    if not name.startswith('_') and name not in ['sys', 'pd', 'np', 'plt', 'sns']:
        try:
            var_type = type(value).__name__
            if hasattr(value, 'shape'):
                print(f"  {name}: {var_type} {value.shape}")
            elif hasattr(value, '__len__'):
                print(f"  {name}: {var_type} (length: {len(value)})")
            else:
                print(f"  {name}: {var_type}")
        except:
            print(f"  {name}: Unknown type")

print("\nNotebook exploration completed.")`,
      estimatedTime: 2,
      dependencies: [],
      successCriteria: 'Variable list displayed',
    });

    totalTime = 2;
  }

  return {
    title: `Plan: ${goal}`,
    description: `A ${totalTime}-step plan to accomplish: ${goal}`,
    steps,
    totalEstimatedTime: totalTime,
    prerequisites: ['Required packages installed (pandas, numpy, scikit-learn, matplotlib, seaborn)'],
    createdAt: Date.now(),
  };
}

/**
 * Format the plan for display to the user
 */
function formatPlan(plan: DetailedPlan): { content: string; plan: DetailedPlan } {
  const stepsText = plan.steps.map(step => {
    return `### Step ${step.stepNumber}: ${step.description}
**Estimated Time:** ${step.estimatedTime} minutes
**Code:**
\`\`\`python
${step.code}
\`\`\`
**Success Criteria:** ${step.successCriteria}
${step.dependencies.length > 0 ? `**Depends on:** Steps ${step.dependencies.join(', ')}` : ''}
`;
  }).join('\n---\n\n');

  const content = `## 📋 Execution Plan: ${plan.title}

${plan.description}

### Prerequisites
${plan.prerequisites.map(p => `- ${p}`).join('\n')}

### Plan Summary
- **Total Steps:** ${plan.steps.length}
- **Estimated Total Time:** ${plan.totalEstimatedTime} minutes

---

${stepsText}

---

### What would you like to do?

- **Continue:** Execute this plan (will switch to AGENTIC mode)
- **Cancel:** Discard this plan

_This plan was generated at ${new Date(plan.createdAt).toLocaleString()}_`;

  return { content, plan };
}

// Type definitions
export interface DetailedPlan {
  title: string;
  description: string;
  steps: DetailedStep[];
  totalEstimatedTime: number;
  prerequisites: string[];
  createdAt: number;
}

export interface DetailedStep {
  stepNumber: number;
  description: string;
  code: string;
  estimatedTime: number;
  dependencies: number[];
  successCriteria: string;
}

export default handlePlanMode;