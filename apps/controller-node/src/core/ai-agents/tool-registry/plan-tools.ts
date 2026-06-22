import { z } from 'zod';
import type { ToolEntry, ToolExecutionContext, ToolResult, Plan } from '../types/index.js';
import { OctomlStore } from '../store/octoml-store.js';

export const createPlanEntry: ToolEntry = {
  definition: {
    name: 'createPlan',
    description: 'Create a structured plan with a goal and tasks. Becomes the active plan.',
    inputSchema: z.object({
      goal: z.string(),
      tasks: z.array(z.string()).min(1).max(10),
    }),
    permittedModes: ['PLAN', 'AGENT', 'AGENTIC'],
  },
  execute: async (input: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> => {
    const store = new OctomlStore(ctx.project_path);
    const tasks = input['tasks'] as string[];

    const plan: Plan = {
      id: `plan-${Date.now()}`,
      goal: input['goal'] as string,
      tasks: tasks.map((desc, i) => ({
        id: `t${i + 1}`,
        description: desc,
        status: 'pending' as const,
      })),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    await store.savePlan(plan);
    await store.setState({ active_plan_id: plan.id });
    return { success: true, data: { plan_id: plan.id, plan } };
  },
};

export const updatePlanEntry: ToolEntry = {
  definition: {
    name: 'updatePlan',
    description: 'Update a task status within the active plan.',
    inputSchema: z.object({
      plan_id: z.string(),
      task_id: z.string(),
      status: z.enum(['pending', 'in_progress', 'done', 'failed']),
    }),
    permittedModes: ['PLAN', 'AGENT', 'AGENTIC'],
  },
  execute: async (input: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> => {
    const store = new OctomlStore(ctx.project_path);
    const plan = await store.getPlan(input['plan_id'] as string);
    if (!plan) return { success: false, error: `Plan not found: ${input['plan_id']}` };

    const task = plan.tasks.find(t => t.id === (input['task_id'] as string));
    if (!task) return { success: false, error: `Task not found: ${input['task_id']}` };

    task.status = input['status'] as 'pending' | 'in_progress' | 'done' | 'failed';
    plan.updated_at = new Date().toISOString();
    await store.savePlan(plan);

    return { success: true, data: { plan_id: plan.id, task_id: task.id, status: task.status } };
  },
};
