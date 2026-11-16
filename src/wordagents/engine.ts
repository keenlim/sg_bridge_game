/** Original word list and implementation. No publisher assets or word deck. */
export const WORDS = `ACORN ALARM ANCHOR APRON ARROW ATLAS AURORA BADGE BALCONY BAMBOO BASKET BEACON BEETLE BELL BERRY BICYCLE BLANKET BOAT BOULDER BREEZE BRIDGE BRUSH BUBBLE BUTTON CABIN CACTUS CAMERA CANDLE CANYON CARPET CASTLE CAVE CELLO CHALK CHERRY CHESS CHIMNEY CIRCLE CLIFF CLOUD COAST COMET COMPASS CORAL CROWN CRYSTAL DAISY DANCER DESERT DIAMOND DRAGON DRUM EAGLE ECHO ENGINE ENVELOPE FEATHER FENCE FERN FESTIVAL FIELD FIREFLY FLAG FLAME FLUTE FOREST FOSSIL FOUNTAIN FOX FROG GALAXY GARDEN GATE GEYSER GLACIER GLOBE GLOVE GOLD GONG GRAPE GRASS GUITAR HAMMER HARBOR HARP HAT HAWK HELMET HILL HONEY HORIZON HORSE ICE IGLOO INK ISLAND IVORY JACKET JAGUAR JAR JELLY JET JEWEL JUNGLE KETTLE KEY KITE KIWI LADDER LAKE LAMP LANTERN LEAF LEMON LIBRARY LIGHTHOUSE LILY LION LIZARD LOCK LOTUS MAGNET MAP MARBLE MASK MEADOW MELON MIRROR MOON MOSAIC MOUNTAIN MUSHROOM NEEDLE NEST NET NIGHT NINJA NOTEBOOK OASIS OCEAN OLIVE ORANGE ORBIT ORCHID OTTER OWL PALACE PANDA PAPER PARROT PEAR PEARL PEBBLE PENGUIN PIANO PILLOW PINE PIRATE PLANET PLUME POCKET POND PUMPKIN PUZZLE QUARTZ QUEEN QUILL RABBIT RADAR RAINBOW RAVEN REEF RIBBON RING RIVER ROBOT ROCKET ROSE SADDLE SAIL SAND SATELLITE SCARF SCHOOL SEED SHADOW SHELL SHIELD SHIP SHOE SHORE SHOVEL SILK SKATE SNOW SOAP SPARROW SPIDER SPOON SPRING SQUARE STAR STONE STORM STRAWBERRY STREAM SUBMARINE SUN SWORD TABLE TENT THISTLE THUNDER TIGER TORCH TOWER TRAIN TREE TRIANGLE TRUMPET TUNNEL TURTLE UMBRELLA VALLEY VASE VELVET VIOLIN VOLCANO WAGON WALNUT WATERFALL WAVE WEB WHALE WHEEL WHISTLE WILLOW WIND WINDOW WING WOLF WOOD YACHT YARN ZEBRA ZIPPER`.split(' ');
export type Team = 'red' | 'blue';
export type Color = Team | 'neutral' | 'assassin';
export interface Game {
  id: string; turn: Team; phase: 'clue' | 'guess' | 'finished';
  cards: { word: string; color: Color; revealed: boolean }[];
  remaining: Record<Team, number>; clue: { word: string; count: number } | null;
  guessesLeft: number; guessesMade: number; winner: Team | null; log: string[];
}
export const other = (team: Team): Team => team === 'red' ? 'blue' : 'red';
function shuffle<T>(values: T[]): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    // Rejection sampling avoids modulo bias.
    const bound = Math.floor(0x100000000 / (i + 1)) * (i + 1);
    let n: number; do { n = crypto.getRandomValues(new Uint32Array(1))[0]; } while (n >= bound);
    const j = n % (i + 1); [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
export function newGame(): Game {
  const turn: Team = crypto.getRandomValues(new Uint8Array(1))[0] % 2 ? 'red' : 'blue';
  const colors = shuffle<Color>([...Array<Color>(9).fill(turn), ...Array<Color>(8).fill(other(turn)), ...Array<Color>(7).fill('neutral'), 'assassin']);
  return { id: crypto.randomUUID(), turn, phase: 'clue', cards: shuffle(WORDS).slice(0, 25).map((word, i) => ({word, color: colors[i], revealed: false})), remaining: {red: turn === 'red' ? 9 : 8, blue: turn === 'blue' ? 9 : 8}, clue: null, guessesLeft: 0, guessesMade: 0, winner: null, log: [`${turn} team starts.`] };
}
export function giveClue(game: Game, word: unknown, count: unknown): void {
  if (game.phase !== 'clue') throw new Error('Wait for the next clue phase.');
  if (typeof word !== 'string' || !/^[A-Za-z]{1,30}$/.test(word.trim())) throw new Error('Use one word, letters only (up to 30).');
  if (!Number.isInteger(count) || (count as number) < 1 || (count as number) > 9) throw new Error('Choose a number from 1 to 9.');
  const clue = word.trim().toUpperCase();
  if (game.cards.some(c => !c.revealed && (c.word.includes(clue) || clue.includes(c.word)))) throw new Error('Your clue cannot contain an unrevealed board word, or part of one.');
  game.clue = {word: clue, count: count as number}; game.guessesLeft = (count as number) + 1; game.guessesMade = 0; game.phase = 'guess';
  game.log.push(`${game.turn}: ${clue} · ${count}`);
}
export function endTurn(game: Game): void {
  if (game.phase !== 'guess' || game.guessesMade < 1) throw new Error('Make at least one guess before ending the turn.');
  game.turn = other(game.turn); game.phase = 'clue'; game.clue = null; game.guessesLeft = 0; game.guessesMade = 0;
}
export function guess(game: Game, index: unknown): void {
  if (game.phase !== 'guess') throw new Error('Wait for your spymaster’s clue.');
  if (!Number.isInteger(index) || (index as number) < 0 || (index as number) >= 25) throw new Error('Choose a card on the board.');
  const card = game.cards[index as number];
  if (card.revealed) throw new Error('That card is already revealed.');
  card.revealed = true; game.guessesMade++; game.guessesLeft--;
  game.log.push(`${game.turn} revealed ${card.word}: ${card.color}.`);
  if (card.color === 'assassin') { game.winner = other(game.turn); game.phase = 'finished'; return; }
  if (card.color === 'red' || card.color === 'blue') {
    game.remaining[card.color]--;
    if (game.remaining[card.color] === 0) { game.winner = card.color; game.phase = 'finished'; return; }
  }
  if (card.color !== game.turn || game.guessesLeft === 0) endTurn(game);
}
/** Build a fresh allow-listed payload; unrevealed identities never reach operatives/spectators. */
export function gameView(game: Game, spymaster: boolean) {
  return { id: game.id, turn: game.turn, phase: game.phase,
    cards: game.cards.map(c => ({word: c.word, revealed: c.revealed, color: spymaster || c.revealed || game.phase === 'finished' ? c.color : null})),
    remaining: {...game.remaining}, clue: game.clue, guessesLeft: game.guessesLeft, guessesMade: game.guessesMade, winner: game.winner, log: game.log.slice(-50) };
}
