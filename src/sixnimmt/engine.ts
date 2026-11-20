export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 10;
export const END_SCORE = 66;
export type Phase = 'select' | 'take' | 'round-end' | 'finished';
export interface Game {
  serial: number;
  round: number;
  turn: number;
  phase: Phase;
  seats: string[];
  rows: number[][];
  hands: Record<string, number[]>;
  scores: Record<string, number>;
  roundPoints: Record<string, number>;
  picks: Record<string, number>;
  queue: { id: string; card: number }[];
  history: { id: string; card: number; row: number; points: number }[];
}
export const bullheads = (n: number) => n === 55 ? 7 : n % 11 === 0 ? 5 : n % 10 === 0 ? 3 : n % 5 === 0 ? 2 : 1;
function shuffleDeck(): number[] {
  const cards = Array.from({ length: 104 }, (_, i) => i + 1);
  for (let i = cards.length - 1; i > 0; --i) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}
export function deal(seats: string[], serial: number, previous?: Game, cards = shuffleDeck()): Game {
  if (seats.length < MIN_PLAYERS || seats.length > MAX_PLAYERS || new Set(seats).size !== seats.length) throw Error('2–10 distinct players are required.');
  if (cards.length !== 104 || new Set(cards).size !== 104 || cards.some(n => !Number.isInteger(n) || n < 1 || n > 104)) throw Error('Invalid deck.');
  if (previous && (previous.phase !== 'round-end' || seats.join() !== previous.seats.join())) throw Error('This game cannot start another round.');
  return {
    serial, round: (previous?.round ?? 0) + 1, turn: 1, phase: 'select', seats: [...seats],
    rows: cards.slice(seats.length * 10, seats.length * 10 + 4).map(n => [n]),
    hands: Object.fromEntries(seats.map((id, i) => [id, cards.slice(i * 10, i * 10 + 10).sort((a,b) => a-b)])),
    scores: Object.fromEntries(seats.map(id => [id, previous?.scores[id] ?? 0])),
    roundPoints: Object.fromEntries(seats.map(id => [id, 0])), picks: {}, queue: [], history: [],
  };
}
export function targetRow(rows: number[][], card: number) {
  let chosen = -1, best = -1;
  rows.forEach((r, i) => { const tail = r[r.length - 1]; if (tail < card && tail > best) { best = tail; chosen = i; } });
  return chosen;
}
function place(g: Game, row: number, take: boolean) {
  const move = g.queue.shift()!;
  const points = take ? g.rows[row].reduce((sum, n) => sum + bullheads(n), 0) : 0;
  if (take) g.rows[row] = [move.card]; else g.rows[row].push(move.card);
  g.scores[move.id] += points;
  g.roundPoints[move.id] += points;
  g.history.push({ ...move, row, points });
}
function advance(g: Game) {
  while (g.queue.length) {
    const row = targetRow(g.rows, g.queue[0].card);
    if (row < 0) { g.phase = 'take'; return; }
    place(g, row, g.rows[row].length === 5);
  }
  g.picks = {};
  if (g.turn < 10) { ++g.turn; g.phase = 'select'; }
  else g.phase = g.seats.some(id => g.scores[id] >= END_SCORE) ? 'finished' : 'round-end';
}
export function lockCard(g: Game, id: string, card: unknown) {
  if (g.phase !== 'select' || !g.seats.includes(id) || typeof card !== 'number' || !g.hands[id].includes(card) || Object.hasOwn(g.picks, id)) throw Error('Choose an unlocked card from your hand.');
  g.picks[id] = card;
  if (!g.seats.every(p => Object.hasOwn(g.picks, p))) return;
  g.history = [];
  g.queue = g.seats.map(p => ({ id: p, card: g.picks[p] })).sort((a,b) => a.card-b.card);
  for (const move of g.queue) g.hands[move.id] = g.hands[move.id].filter(n => n !== move.card);
  advance(g);
}
export function takeRow(g: Game, id: string, index: unknown) {
  if (g.phase !== 'take' || g.queue[0]?.id !== id || typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= 4) throw Error('Only the current player can choose a valid row.');
  place(g, index, true);
  advance(g);
}
export function publicView(g: Game, viewer: string) {
  const seated = g.seats.includes(viewer);
  return {
    serial: g.serial, round: g.round, turn: g.turn, phase: g.phase, rows: g.rows, scores: g.scores, roundPoints: g.roundPoints,
    hand: seated ? g.hands[viewer] : [], yourPick: seated && g.phase === 'select' ? g.picks[viewer] ?? null : null,
    locked: g.phase === 'select' ? Object.keys(g.picks) : [], history: g.history,
    revealed: g.phase === 'take' ? g.queue : [], chooser: g.phase === 'take' ? g.queue[0].id : null,
    winners: g.phase === 'finished' ? g.seats.filter(id => g.scores[id] === Math.min(...Object.values(g.scores))) : [],
  };
}
