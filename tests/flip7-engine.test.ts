import { describe, expect, it } from 'vitest';
import { applyMove, buildDeck, gameView, newGame, type Card } from '../src/flip7/engine';

const n = (value: number): Card => ({ type: 'number', value });
const m = (value: number): Card => ({ type: 'bonus', value });
const a = (type: 'freeze' | 'flipThree' | 'secondChance' | 'double'): Card => ({ type });
const make = (...cards: Card[]) => newGame(['a', 'b', 'c'], cards, 2);
const play = (g: ReturnType<typeof make>, actor: string, type: 'hit' | 'stay' | 'target' | 'nextRound', playerId?: string) =>
  applyMove(g, actor, { type, playerId });

describe('Flip 7 rules and public state', () => {
  it('builds the original 94-card deck with the correct number frequencies', () => {
    const cards = buildDeck();
    expect(cards).toHaveLength(94);
    for (let i = 0; i <= 12; i++) expect(cards.filter(c => c.type === 'number' && c.value === i)).toHaveLength(Math.max(i, 1));
    for (const type of ['freeze', 'flipThree', 'secondChance']) expect(cards.filter(c => c.type === type)).toHaveLength(3);
    expect(cards.filter(c => c.type === 'bonus').map(c => c.value)).toEqual([2, 4, 6, 8, 10]);
    expect(cards.filter(c => c.type === 'double')).toHaveLength(1);
  });

  it('initially deals in seat order without exposing future cards or allowing out-of-turn moves', () => {
    const g = make(n(1), n(2), n(3), n(12));
    const view = gameView(g);
    expect(view.players.map(p => p.numbers)).toEqual([[1], [2], [3]]);
    expect(view.turnId).toBe('a');
    expect(view.deckCount).toBe(1);
    expect(view).not.toHaveProperty('deck');
    expect(JSON.stringify(view)).not.toContain('"value":12');
    expect(() => play(g, 'b', 'hit')).toThrow(/turn/i);
    expect(gameView(g)).toEqual(view);
  });

  it('pauses an initial deal to resolve a freeze, then skips the frozen seat', () => {
    let g = make(a('freeze'), n(4), n(5), n(6));
    expect(gameView(g)).toMatchObject({ phase: 'dealing', pending: { type: 'freeze', actorId: 'a' } });
    expect(() => play(g, 'b', 'target', 'c')).toThrow();
    g = play(g, 'a', 'target', 'b');
    expect(gameView(g).players.map(p => [p.status, p.numbers])).toEqual([['active', []], ['frozen', []], ['active', [4]]]);
    expect(() => play(g, 'a', 'stay')).toThrow(/card/i);
    g = play(g, 'a', 'hit');
    expect(gameView(g).turnId).toBe('c');
  });

  it('uses one Second Chance on a duplicate without giving a replacement draw', () => {
    let g = make(n(5), n(1), n(2), a('secondChance'), n(5), n(5));
    g = play(g, 'a', 'hit');
    g = play(g, 'b', 'stay');
    g = play(g, 'c', 'stay');
    g = play(g, 'a', 'hit');
    expect(gameView(g).players[0]).toMatchObject({ numbers: [5], secondChance: false, status: 'active', roundScore: 5 });
    expect(gameView(g).deckCount).toBe(1);
    g = play(g, 'a', 'hit');
    expect(gameView(g)).toMatchObject({ phase: 'roundEnd', players: [{ status: 'busted', total: 0 }, { total: 1 }, { total: 2 }] });
  });

  it('lets a player pass an excess Second Chance only to eligible players', () => {
    let g = make(a('secondChance'), n(9), n(4), a('secondChance'));
    expect(gameView(g).players[0].secondChance).toBe(true);
    g = play(g, 'a', 'hit');
    expect(gameView(g).pending).toMatchObject({ targets: ['b', 'c'], actorId: 'a', type: 'secondChance' });
    expect(() => play(g, 'a', 'target', 'a')).toThrow();
    g = play(g, 'a', 'target', 'b');
    expect(gameView(g).players[1].secondChance).toBe(true);
    expect(gameView(g).turnId).toBe('b');
  });

  it('queues Flip Three follow-up choices until the forced cards finish', () => {
    let g = make(n(1), n(2), n(3), a('flipThree'), a('freeze'), n(4), n(5));
    g = play(g, 'a', 'hit');
    g = play(g, 'a', 'target', 'b');
    expect(gameView(g)).toMatchObject({
      pending: { actorId: 'b', type: 'freeze' },
      players: [{ numbers: [1] }, { numbers: [2, 4, 5] }, { numbers: [3] }],
    });
    g = play(g, 'b', 'target', 'c');
    expect(gameView(g).players[2]).toMatchObject({ status: 'frozen', roundScore: 3 });
    expect(gameView(g).turnId).toBe('b');
  });

  it('resolves a deferred action earned before a self-freeze if an active target remains', () => {
    let g = make(n(1), n(2), n(3), a('flipThree'), a('freeze'), a('flipThree'), n(4));
    g = play(g, 'a', 'hit');
    g = play(g, 'a', 'target', 'b');
    g = play(g, 'b', 'target', 'b');
    expect(gameView(g)).toMatchObject({
      pending: { actorId: 'b', type: 'flipThree', targets: ['a', 'c'] },
      players: [{ status: 'active' }, { status: 'frozen' }, { status: 'active' }],
    });
  });

  it('loses a queued action when the forced player busts, leaving another player active', () => {
    let g = make(n(1), n(2), n(3), a('flipThree'), a('freeze'), n(2), n(7));
    g = play(g, 'a', 'hit');
    g = play(g, 'a', 'target', 'b');
    expect(gameView(g)).toMatchObject({ pending: null, deckCount: 1, turnId: 'c', players: [{ status: 'active' }, { status: 'busted' }, { status: 'active' }] });
  });

  it('ends the round on seven unique numbers and adds the multiplier and bonuses in order', () => {
    let g = make(n(0), n(8), n(9), a('double'), m(10), n(1), n(2), n(3), n(4), n(5), n(6), n(7));
    g = play(g, 'a', 'hit');
    g = play(g, 'b', 'stay');
    g = play(g, 'c', 'stay');
    for (let i = 0; i < 7; i++) g = play(g, 'a', 'hit');
    expect(gameView(g)).toMatchObject({ phase: 'roundEnd', deckCount: 1, flippedBy: 'a', players: [{ total: 67, roundScore: 67 }, { total: 8 }, { total: 9 }] });
  });

  it('carries scores and leftover deck cards to the next round and rotates the dealer', () => {
    let g = make(n(1), n(2), n(3), n(4), n(5), n(6));
    for (const p of ['a', 'b', 'c']) g = play(g, p, 'stay');
    g = play(g, 'a', 'nextRound');
    expect(gameView(g)).toMatchObject({ dealerId: 'a', turnId: 'b', round: 2, deckCount: 0, players: [{ total: 1, numbers: [6] }, { total: 2, numbers: [4] }, { total: 3, numbers: [5] }] });
    g = play(g, 'b', 'hit');
    expect(gameView(g).players[1].numbers).toHaveLength(2);
  });

  it('keeps playing through a tie at the winning threshold, then chooses a unique leader', () => {
    let g = make(n(10), n(10), n(2), n(3), n(4), n(5));
    g.players[0].total = 190;
    g.players[1].total = 190;
    for (const p of ['a', 'b', 'c']) g = play(g, p, 'stay');
    expect(gameView(g)).toMatchObject({ phase: 'roundEnd', winnerId: null });
    g = play(g, 'a', 'nextRound');
    for (const p of ['b', 'c', 'a']) g = play(g, p, 'stay');
    expect(gameView(g)).toMatchObject({ phase: 'finished', winnerId: 'a' });
    expect(() => play(g, 'a', 'nextRound')).toThrow();
  });
});
