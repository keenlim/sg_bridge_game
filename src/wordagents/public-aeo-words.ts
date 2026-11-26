import type { AeoDeck } from './packs';

export const PUBLIC_AEO_DECK = {
  themed: [
    'Catalyst', 'Pathfinder', 'Compass', 'Lighthouse', 'North Star',
    'Blueprint', 'Roadmap', 'Milestone', 'Prototype', 'Sandbox',
    'Playbook', 'Workshop', 'Pilot', 'Sprint', 'Handoff',
    'Guardrail', 'Audit Trail', 'Trust', 'Steward', 'Checkpoint',
    'Agent', 'Navigator', 'Prompt', 'Context', 'Grounding',
    'Knowledge Base', 'Decision', 'Review', 'Feedback', 'Experiment',
    'Signal', 'Insight', 'Momentum', 'Launch', 'Mission',
  ],
  technology: [
    'Gateway', 'Router', 'Cache', 'Token', 'Queue',
    'Pipeline', 'Container', 'Cluster', 'Cloud', 'Server',
    'Model', 'Embedding', 'Vector', 'Dataset', 'Dashboard',
    'Webhook', 'Endpoint', 'Secret', 'Metric', 'Trace',
  ],
  wildcards: [
    'Lantern', 'Kite', 'Otter', 'Magnet', 'Coral',
    'Anchor', 'Moon', 'Quartz', 'Suitcase', 'Paddle',
    'Bandage', 'Apricot', 'Windmill', 'Glacier', 'Whistle',
  ],
} as const satisfies AeoDeck;
