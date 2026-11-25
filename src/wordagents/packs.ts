export const AEO_MIX = { themed: 15, technology: 6, wildcards: 4 } as const;
export type Pack = 'classic' | 'aeo';
export type AeoDeck = { [K in keyof typeof AEO_MIX]: readonly string[] };
type Bindings = { WORDAGENTS_AEO_DECK?: string; WORDAGENTS_TEAM_IDS?: string };

export function readTeamConfig(env: Bindings) {
  const { WORDAGENTS_AEO_DECK: raw, WORDAGENTS_TEAM_IDS: ids } = env;
  // Even an empty or invalid binding is a request for private mode, not public fallback.
  const restricted = raw !== undefined || ids !== undefined;
  const entries = (ids ?? '').split(',').map(id => id.trim());
  const members = entries.every(id => /^[1-9]\d{0,19}$/.test(id)) ? new Set(entries.map(id => 'tg_' + id)) : new Set<string>();
  return { restricted, members, deck: members.size ? readDeck(raw) : null };
}

export function readDeck(raw: string | undefined): AeoDeck | null {
  if (!raw || typeof raw !== 'string' || raw.length > 20_000) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const seen = new Set<string>();
    const deck = {} as Record<keyof AeoDeck, string[]>;
    for (const bucket of Object.keys(AEO_MIX) as (keyof AeoDeck)[]) {
      const cards = parsed[bucket];
      if (!Array.isArray(cards) || cards.length < AEO_MIX[bucket] || cards.length > 400) return null;
      deck[bucket] = [];
      for (const card of cards) {
        if (typeof card !== 'string') return null;
        const word = card.trim().replace(/ +/g, ' ');
        // These names are rendered as text, and punctuation is used only inside phrases.
        if (!/^[A-Za-z0-9]+(?:[ /-][A-Za-z0-9]+)*$/.test(word) || word.length > 42 || !/[A-Za-z]/.test(word)) return null;
        const key = word.toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (seen.has(key)) return null;
        seen.add(key);
        deck[bucket].push(word);
      }
    }
    return deck;
  } catch {
    return null;
  }
}
