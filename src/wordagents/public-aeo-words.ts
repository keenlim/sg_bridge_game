import { AEO_MIX, type AeoDeck } from './packs';
import { shuffle } from './engine';

export const PUBLIC_AEO_DECK = {
  themed: [
    'Catalyst', 'Compass', 'Lighthouse', 'Blueprint', 'Milestone',
    'Prototype', 'Sandbox', 'Playbook', 'Workshop', 'Pilot',
    'Sprint', 'Handoff', 'Guardrail', 'Trust', 'Checkpoint',
    'Agent', 'Prompt', 'Decision', 'Review', 'Feedback',
    'Experiment', 'Signal', 'Insight', 'Launch', 'Mission',
    'AI Gateway', 'genCentral', 'appCentral', 'AskNav', 'devCentral',
    'agentCentral', 'MCP Hub', 'Concierge', 'Budget', 'Approval',
    'Model Card', 'Red Team', 'Allowlist', 'Incident', 'Retirement',
    'Exception', 'searchCentral', 'Member-facing', 'Customer-obsessed', 'Agile',
    'Data-smart', 'dataCentral', 'flowCentral', 'Member Journey', 'Service Desk',
    'Queue Ticket', 'Service Recovery', 'Stand-up', 'Backlog', 'Retrospective',
    'Data Story', 'Scorecard', 'Pulse Check',
  ],
  technology: [
    'Gateway', 'Router', 'Cache', 'Token', 'Queue',
    'Pipeline', 'Container', 'Cloud', 'Server', 'Model',
    'Dataset', 'Dashboard', 'Secret', 'Harness', 'MCP',
    'Connector', 'Tool Call', 'Agent Memory', 'Multi-Agent', 'LLM',
    'GPT-6-Luna', 'Foundry', 'Gemini', 'Sonnet', 'Inference',
    'Benchmark', 'Rate Limit', 'Failover', 'Fallback', 'Retry',
    'Alert', 'Bifrost', 'Chatbot', 'Copilot', 'System Prompt',
    'Context Window', 'Multimodal', 'Fine-Tuning', 'RAG', 'Retrieval',
    'Citation', 'Semantic Search', 'Hallucination', 'Source of Truth', 'Agent Loop',
    'A2A', 'Orchestrator', 'Subagent', 'Human in the Loop', 'Computer Use',
    'Temperature', 'Reasoning', 'Distillation', 'Latency', 'Throughput',
    'Eval', 'Prompt Injection', 'Jailbreak', 'Redaction', 'Data Leakage',
    'Kill Switch', 'Shadow AI', 'Heatmap',
  ],
  wildcards: [
    'Lantern', 'Kite', 'Otter', 'Magnet', 'Coral',
    'Anchor', 'Moon', 'Quartz', 'Suitcase', 'Paddle',
    'Bandage', 'Apricot', 'Windmill', 'Glacier', 'Whistle',
    'Passport', 'Toll Booth', 'Baton', 'Receipt', 'Durian',
    'Bubble Tea', 'Karaoke', 'Meat Proxy', 'Rubber Duck', 'Black Box',
    'Autopilot', 'Backseat Driver', 'Magic Button', 'Eight', 'snacCentral',
    'Office', 'WFH', 'Sticky Note', 'Hot Desk', 'Pantry',
    'Town Hall', 'Lunch Buddy', 'Kopi', 'Hawker Centre', 'Caifan',
    'toriQ', 'Jollibee', 'TON Coffee', 'Square2', 'Stuffd',
    'Alchemist', 'Matcha',
  ],
} as const satisfies AeoDeck;

// Keep unusually similar labels apart on public boards, even across buckets.
const CARD_FAMILIES = [
  { limit: 2, words: ['genCentral', 'appCentral', 'devCentral', 'agentCentral', 'searchCentral', 'dataCentral', 'flowCentral', 'snacCentral'] },
  { limit: 1, words: ['Gateway', 'AI Gateway'] },
  { limit: 1, words: ['MCP', 'MCP Hub'] },
  { limit: 1, words: ['Prompt', 'System Prompt', 'Prompt Injection'] },
  { limit: 1, words: ['Agent', 'Agent Loop', 'Agent Memory', 'Multi-Agent', 'Subagent'] },
  { limit: 1, words: ['Model', 'Model Card'] },
];
const familyByWord = new Map(CARD_FAMILIES.flatMap((family) => family.words.map((word) => [word, family] as const)));

/** Choose the public board's words without changing the shared Classic or private-deck draw. */
export function drawPublicAeoDeck(): AeoDeck {
  const counts = new Map<(typeof CARD_FAMILIES)[number], number>();
  const result: Record<keyof AeoDeck, string[]> = { themed: [], technology: [], wildcards: [] };
  for (const bucket of shuffle(Object.keys(AEO_MIX) as (keyof AeoDeck)[])) {
    for (const word of shuffle(PUBLIC_AEO_DECK[bucket])) {
      const family = familyByWord.get(word);
      if (family) {
        const count = counts.get(family) ?? 0;
        if (count >= family.limit) continue;
        counts.set(family, count + 1);
      }
      result[bucket].push(word);
      if (result[bucket].length === AEO_MIX[bucket]) break;
    }
    if (result[bucket].length !== AEO_MIX[bucket]) throw new Error('The public AEO pack cannot fill a board.');
  }
  return result;
}
