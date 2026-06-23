import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';
import type { ToolEntry, ToolExecutionContext, ToolResult, Plan } from '../types/index.js';
import { OctomlStore } from '../store/octoml-store.js';

function planToMarkdown(plan: Plan): string {
  const header = `# Plan: ${plan.goal}\n\nCreated: ${plan.created_at}\n\n## Tasks\n\n`;
  const tasks = plan.tasks.map((t, i) => `- [ ] **${i + 1}. ${t.description}**`).join('\n');
  return header + tasks + '\n';
}

export const createPlanEntry: ToolEntry = {
  definition: {
    name: 'createPlan',
    description: 'Create a structured plan with a goal and tasks. Saves to .octoml/plan.md and becomes the active plan.',
    inputSchema: z.object({
      goal: z.string(),
      tasks: z.array(z.string()).describe('List of task descriptions to create the plan'),
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

    // Write human-readable plan.md to .octoml/
    const planMdPath = path.join(ctx.project_path, '.octoml', 'plan.md');
    await fs.mkdir(path.dirname(planMdPath), { recursive: true });
    await fs.writeFile(planMdPath, planToMarkdown(plan), 'utf-8');

    ctx.emit({
      type: 'plan_created',
      plan_id: plan.id,
      plan_path: '.octoml/plan.md',
      goal: plan.goal,
      tasks: plan.tasks,
    });

    return { success: true, data: { plan_id: plan.id, plan_path: '.octoml/plan.md' } };
  },
};

export const updatePlanEntry: ToolEntry = {
  definition: {
    name: 'updatePlan',
    description: 'Update a task status within the active plan.',
    inputSchema: z.object({
      plan_id: z.string(),
      task_id: z.string(),
      status: z.string().describe('Must be exactly "pending", "in_progress", "done", or "failed"'),
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

    // Keep plan.md in sync with task status
    const planMdPath = path.join(ctx.project_path, '.octoml', 'plan.md');
    const statusIcon: Record<string, string> = { done: 'x', in_progress: '~', failed: '!', pending: ' ' };
    const md = `# Plan: ${plan.goal}\n\nUpdated: ${plan.updated_at}\n\n## Tasks\n\n` +
      plan.tasks.map((t, i) => `- [${statusIcon[t.status] ?? ' '}] **${i + 1}. ${t.description}** _(${t.status})_`).join('\n') + '\n';
    await fs.writeFile(planMdPath, md, 'utf-8').catch(() => undefined);

    return { success: true, data: { plan_id: plan.id, task_id: task.id, status: task.status } };
  },
};
