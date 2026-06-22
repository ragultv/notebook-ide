import type { Mode } from './types/index.js';

export interface EscalationResult {
  suggest_mode: Mode;
  reason: string;
}

const ASK_EXEC_WORDS  = ['run', 'execute', 'install', 'train', 'fit'];
const ASK_WRITE_WORDS = ['write', 'create', 'modify', 'update', 'change', 'generate code'];
const PLAN_WRITE_WORDS = ['write', 'create file', 'update cell', 'modify'];
const AGENT_EXEC_WORDS = ['run this', 'execute', "let's run", 'to run'];

function hits(text: string, words: string[]): boolean {
  const lower = text.toLowerCase();
  return words.some(w => lower.includes(w));
}

export function checkEscalation(mode: Mode, response: string): EscalationResult | null {
  switch (mode) {
    case 'ASK':
      if (hits(response, ASK_EXEC_WORDS)) {
        return { suggest_mode: 'AGENTIC', reason: 'This task requires code execution' };
      }
      if (hits(response, ASK_WRITE_WORDS)) {
        return { suggest_mode: 'PLAN', reason: 'This task involves planning or writing' };
      }
      return null;

    case 'PLAN':
      if (hits(response, PLAN_WRITE_WORDS)) {
        return { suggest_mode: 'AGENT', reason: 'This task requires writing files' };
      }
      return null;

    case 'AGENT':
      if (hits(response, AGENT_EXEC_WORDS)) {
        return { suggest_mode: 'AGENTIC', reason: 'Code is ready to execute' };
      }
      return null;

    case 'AGENTIC':
      return null;
  }
}
