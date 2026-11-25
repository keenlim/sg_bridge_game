import { AEO_MIX, type AeoDeck } from './packs';

/** Original word list and implementation. No publisher assets or word deck. */
export const WORDS = `ACORN ALARM ANCHOR APRON ARROW ATLAS AURORA BADGE BALCONY BAMBOO BASKET BEACON BEETLE BELL BERRY BICYCLE BLANKET BOAT BOULDER BREEZE BRIDGE BRUSH BUBBLE BUTTON CABIN CACTUS CAMERA CANDLE CANYON CARPET CASTLE CAVE CELLO CHALK CHERRY CHESS CHIMNEY CIRCLE CLIFF CLOUD COAST COMET COMPASS CORAL CROWN CRYSTAL DAISY DANCER DESERT DIAMOND DRAGON DRUM EAGLE ECHO ENGINE ENVELOPE FEATHER FENCE FERN FESTIVAL FIELD FIREFLY FLAG FLAME FLUTE FOREST FOSSIL FOUNTAIN FOX FROG GALAXY GARDEN GATE GEYSER GLACIER GLOBE GLOVE GOLD GONG GRAPE GRASS GUITAR HAMMER HARBOR HARP HAT HAWK HELMET HILL HONEY HORIZON HORSE ICE IGLOO INK ISLAND IVORY JACKET JAGUAR JAR JELLY JET JEWEL JUNGLE KETTLE KEY KITE KIWI LADDER LAKE LAMP LANTERN LEAF LEMON LIBRARY LIGHTHOUSE LILY LION LIZARD LOCK LOTUS MAGNET MAP MARBLE MASK MEADOW MELON MIRROR MOON MOSAIC MOUNTAIN MUSHROOM NEEDLE NEST NET NIGHT NINJA NOTEBOOK OASIS OCEAN OLIVE ORANGE ORBIT ORCHID OTTER OWL PALACE PANDA PAPER PARROT PEAR PEARL PEBBLE PENGUIN PIANO PILLOW PINE PIRATE PLANET PLUME POCKET POND PUMPKIN PUZZLE QUARTZ QUEEN QUILL RABBIT RADAR RAINBOW RAVEN REEF RIBBON RING RIVER ROBOT ROCKET ROSE SADDLE SAIL SAND SATELLITE SCARF SCHOOL SEED SHADOW SHELL SHIELD SHIP SHOE SHORE SHOVEL SILK SKATE SNOW SOAP SPARROW SPIDER SPOON SPRING SQUARE STAR STONE STORM STRAWBERRY STREAM SUBMARINE SUN SWORD TABLE TENT THISTLE THUNDER TIGER TORCH TOWER TRAIN TREE TRIANGLE TRUMPET TUNNEL TURTLE UMBRELLA VALLEY VASE VELVET VIOLIN VOLCANO WAGON WALNUT WATERFALL WAVE WEB WHALE WHEEL WHISTLE WILLOW WIND WINDOW WING WOLF WOOD YACHT YARN ZEBRA ZIPPER`.split(' ');

export type Team = 'red' | 'blue';
export type Color = Team | 'neutral' | 'assassin';
export type EndReason = 'agents' | 'assassin';

/** Public, structured history. Guess colours are public once revealed. */
export type GameEvent =
  | { t: 'start'; team: Team }
  | { t: 'clue'; team: Team; word: string; count: number }
  | { t: 'guess'; team: Team; index: number; word: string; color: Color }
  | { t: 'pass'; team: Team };

/** An operative's tentative pick, shared with everyone so a remote team can discuss before revealing. */
export interface Mark { playerId: string; index: number }

export interface Game {
  id: string;
  turn: Team;
  phase: 'clue' | 'guess' | 'finished';
  cards: { word: string; color: Color; revealed: boolean }[];
  remaining: Record<Team, number>;
  clue: { word: string; count: number } | null;
  guessesLeft: number;
  guessesMade: number;
  winner: Team | null;
  endReason: EndReason | null;
  history: GameEvent[];
  marks: Mark[];
}

export const BOARD_SIZE = 25;
export const MAX_HISTORY = 120;
export const other = (team: Team): Team => team === 'red' ? 'blue' : 'red';

function randomBelow(bound: number): number {
  // Rejection sampling avoids modulo bias.
  const limit = Math.floor(0x100000000 / bound) * bound;
  let n: number;
  do { n = crypto.getRandomValues(new Uint32Array(1))[0]; } while (n >= limit);
  return n % bound;
}

export function shuffle<T>(values: readonly T[]): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomBelow(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function record(game: Game, event: GameEvent): void {
  game.history.push(event);
  if (game.history.length > MAX_HISTORY) game.history.splice(0, game.history.length - MAX_HISTORY);
}

export function newGame(deck?: AeoDeck): Game {
  const words = deck ? shuffle([
    ...shuffle(deck.themed).slice(0, AEO_MIX.themed),
    ...shuffle(deck.technology).slice(0, AEO_MIX.technology),
    ...shuffle(deck.wildcards).slice(0, AEO_MIX.wildcards),
  ]) : shuffle(WORDS).slice(0, BOARD_SIZE);
  const turn: Team = randomBelow(2) ? 'red' : 'blue';
  const colors = shuffle<Color>([
    ...Array<Color>(9).fill(turn), ...Array<Color>(8).fill(other(turn)),
    ...Array<Color>(7).fill('neutral'), 'assassin',
  ]);
  return {
    id: crypto.randomUUID(), turn, phase: 'clue',
    cards: words.map((word, i) => ({ word, color: colors[i], revealed: false })),
    remaining: { red: turn === 'red' ? 9 : 8, blue: turn === 'blue' ? 9 : 8 },
    clue: null, guessesLeft: 0, guessesMade: 0, winner: null, endReason: null,
    history: [{ t: 'start', team: turn }], marks: [],
  };
}

function overlapsClue(label: string, clue: string): boolean {
  const parts = label.toUpperCase().match(/[A-Z]+/g) ?? [];
  const term = parts.join('');
  const candidates = [term, ...parts.filter(part => part.length >= 3)];
  return candidates.some(word => word && (word.includes(clue) || clue.includes(word)));
}

/** Shared clue check (the client mirrors it for inline feedback). Returns the normalised clue. */
export function validateClue(game: Pick<Game, 'cards'>, word: unknown): string {
  if (typeof word !== 'string' || !/^[A-Za-z]{1,30}$/.test(word.trim())) throw new Error('Use one word, letters only (up to 30).');
  const clue = word.trim().toUpperCase();
  if (game.cards.some(c => !c.revealed && overlapsClue(c.word, clue))) {
    throw new Error('Your clue cannot contain an unrevealed board word, or part of one.');
  }
  return clue;
}

export function giveClue(game: Game, word: unknown, count: unknown): void {
  if (game.phase !== 'clue') throw new Error('Wait for the next clue phase.');
  if (!Number.isInteger(count) || (count as number) < 1 || (count as number) > 9) throw new Error('Choose a number from 1 to 9.');
  const clue = validateClue(game, word);
  game.clue = { word: clue, count: count as number };
  game.guessesLeft = (count as number) + 1;
  game.guessesMade = 0;
  game.phase = 'guess';
  record(game, { t: 'clue', team: game.turn, word: clue, count: count as number });
}

function switchTurn(game: Game): void {
  game.turn = other(game.turn);
  game.phase = 'clue';
  game.clue = null;
  game.guessesLeft = 0;
  game.guessesMade = 0;
  game.marks = [];
}

export function endTurn(game: Game): void {
  if (game.phase !== 'guess' || game.guessesMade < 1) throw new Error('Make at least one guess before ending the turn.');
  record(game, { t: 'pass', team: game.turn });
  switchTurn(game);
}

function finish(game: Game, winner: Team, reason: EndReason): void {
  game.winner = winner;
  game.endReason = reason;
  game.phase = 'finished';
  game.marks = [];
}

export function guess(game: Game, index: unknown): void {
  if (game.phase !== 'guess') throw new Error('Wait for your spymaster’s clue.');
  if (!Number.isInteger(index) || (index as number) < 0 || (index as number) >= BOARD_SIZE) throw new Error('Choose a card on the board.');
  const card = game.cards[index as number];
  if (card.revealed) throw new Error('That card is already revealed.');
  card.revealed = true;
  game.guessesMade++;
  game.guessesLeft--;
  game.marks = (game.marks ?? []).filter(m => m.index !== index);
  record(game, { t: 'guess', team: game.turn, index: index as number, word: card.word, color: card.color });
  if (card.color === 'assassin') { finish(game, other(game.turn), 'assassin'); return; }
  if (card.color === 'red' || card.color === 'blue') {
    game.remaining[card.color]--;
    if (game.remaining[card.color] === 0) { finish(game, card.color, 'agents'); return; }
  }
  if (card.color !== game.turn || game.guessesLeft === 0) switchTurn(game);
}

/** Toggle an operative's tentative pick. The caller checks the player's team and role. */
export function toggleMark(game: Game, playerId: string, index: unknown): void {
  if (game.phase !== 'guess') throw new Error('Marks are for the guessing phase.');
  if (!Number.isInteger(index) || (index as number) < 0 || (index as number) >= BOARD_SIZE) throw new Error('Choose a card on the board.');
  if (game.cards[index as number].revealed) throw new Error('That card is already revealed.');
  game.marks ??= [];
  const at = game.marks.findIndex(m => m.playerId === playerId && m.index === index);
  if (at >= 0) game.marks.splice(at, 1);
  else game.marks.push({ playerId, index: index as number });
}

/** Build a fresh allow-listed payload; unrevealed identities never reach operatives/spectators. */
export function gameView(game: Game, spymaster: boolean) {
  const open = spymaster || game.phase === 'finished';
  return {
    id: game.id, turn: game.turn, phase: game.phase,
    cards: game.cards.map(c => ({ word: c.word, revealed: c.revealed, color: open || c.revealed ? c.color : null })),
    remaining: { ...game.remaining }, clue: game.clue ? { ...game.clue } : null,
    guessesLeft: game.guessesLeft, guessesMade: game.guessesMade,
    winner: game.winner, endReason: game.endReason ?? null,
    history: (game.history ?? []).map(e => ({ ...e })),
    marks: (game.marks ?? []).map(m => ({ ...m })),
  };
}
