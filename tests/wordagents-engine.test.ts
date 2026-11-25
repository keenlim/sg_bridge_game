import {describe,it,expect} from 'vitest';
import {newGame,giveClue,guess,endTurn,gameView,other,toggleMark,validateClue,WORDS} from '../src/wordagents/engine';
describe('Word Agents rules and secrecy',()=>{
 it('deals 25 unique words with a 9/8/7/1 key and unbiased team assignment',()=>{
  expect(new Set(WORDS).size).toBe(WORDS.length);
  for(let i=0;i<30;i++) { const g=newGame(); expect(new Set(g.cards.map(c=>c.word)).size).toBe(25);
   expect(g.cards.filter(c=>c.color===g.turn)).toHaveLength(9); expect(g.cards.filter(c=>c.color===other(g.turn))).toHaveLength(8);
   expect(g.cards.filter(c=>c.color==='neutral')).toHaveLength(7);expect(g.cards.filter(c=>c.color==='assassin')).toHaveLength(1);
   expect(gameView(g,false).cards.every(c=>c.color===null)).toBe(true);expect(gameView(g,true).cards.every(c=>c.color!==null)).toBe(true);
  }
 });
 it('validates single-word clues, board overlap, number and phases before mutation',()=>{
  const g=newGame();const before=JSON.stringify(g);
  for(const [w,n] of [['two words',2],['good',0],['good',10],['good',1.2],['good','2'],[g.cards[0].word,1],['<script>',2]]) expect(()=>giveClue(g,w,n)).toThrow();
  expect(JSON.stringify(g)).toBe(before); giveClue(g,'Conceptual',2);expect(()=>giveClue(g,'Another',1)).toThrow();
  expect(()=>endTurn(g)).toThrow(); expect(()=>guess(g,-1)).toThrow();expect(()=>guess(g,'2')).toThrow();
 });
 it('allows count+1 correct guesses then switches team',()=>{const g=newGame(),team=g.turn;giveClue(g,'Conceptual',1);
  const indices=g.cards.flatMap((c,i)=>c.color===team?[i]:[]);guess(g,indices[0]);expect(g.phase).toBe('guess');expect(gameView(g,false).cards[indices[0]].color).toBe(team);
  expect(()=>guess(g,indices[0])).toThrow();guess(g,indices[1]);expect(g.turn).toBe(other(team));expect(g.phase).toBe('clue');
 });
 it('neutral and enemy guesses end the turn; enemy last card wins for them',()=>{
  for(const color of ['neutral','enemy']) {const g=newGame(),team=g.turn;giveClue(g,'Conceptual',3);const index=g.cards.findIndex(c=>c.color===(color==='enemy'?other(team):'neutral'));guess(g,index);expect(g.turn).toBe(other(team));expect(g.phase).toBe('clue');}
  const g=newGame(),enemy=other(g.turn);g.remaining[enemy]=1;giveClue(g,'Conceptual',1);guess(g,g.cards.findIndex(c=>c.color===enemy));expect(g.winner).toBe(enemy);expect(g.phase).toBe('finished');
 });
 it('assassin loses immediately and ending a turn voluntarily requires one guess',()=>{let g=newGame();const loser=g.turn;giveClue(g,'Conceptual',1);guess(g,g.cards.findIndex(c=>c.color==='assassin'));expect(g.winner).toBe(other(loser));expect(gameView(g,false).cards.every(c=>c.color!==null)).toBe(true);
  g=newGame();const team=g.turn;giveClue(g,'Conceptual',2);guess(g,g.cards.findIndex(c=>c.color===team));endTurn(g);expect(g.turn).toBe(other(team));
 });
 it('records a public structured history and the end reason',()=>{
  const g=newGame(),team=g.turn;expect(g.history).toEqual([{t:'start',team}]);
  giveClue(g,'Conceptual',2);const own=g.cards.findIndex(c=>c.color===team);guess(g,own);endTurn(g);
  expect(g.history.slice(1)).toEqual([{t:'clue',team,word:'CONCEPTUAL',count:2},{t:'guess',team,index:own,word:g.cards[own].word,color:team},{t:'pass',team}]);
  giveClue(g,'Conceptual',1);guess(g,g.cards.findIndex(c=>c.color==='assassin'));
  expect(g.endReason).toBe('assassin');expect(g.winner).toBe(team);
  const w=newGame();w.remaining[w.turn]=1;giveClue(w,'Conceptual',1);guess(w,w.cards.findIndex(c=>c.color===w.turn));expect(w.endReason).toBe('agents');
  const view=gameView(g,false);view.history.push({t:'pass',team});expect(g.history.at(-1)!.t).toBe('guess');
 });
 it('toggles teammate marks during guessing and clears them on reveal and turn change',()=>{
  const g=newGame(),team=g.turn;expect(()=>toggleMark(g,'a',0)).toThrow();giveClue(g,'Conceptual',2);
  const own=g.cards.flatMap((c,i)=>c.color===team?[i]:[]);
  toggleMark(g,'a',own[0]);toggleMark(g,'b',own[0]);toggleMark(g,'a',own[1]);toggleMark(g,'a',own[1]);
  expect(g.marks).toEqual([{playerId:'a',index:own[0]},{playerId:'b',index:own[0]}]);
  expect(()=>toggleMark(g,'a',25)).toThrow();expect(()=>toggleMark(g,'a','1')).toThrow();
  toggleMark(g,'a',own[1]);guess(g,own[0]);expect(g.marks).toEqual([{playerId:'a',index:own[1]}]);
  expect(()=>toggleMark(g,'a',own[0])).toThrow();
  endTurn(g);expect(g.marks).toEqual([]);
 });
 it('shares clue validation with the client rules',()=>{
  const g={cards:[{word:'PEAR',color:'red' as const,revealed:false},{word:'PEARL',color:'blue' as const,revealed:false},{word:'SUN',color:'neutral' as const,revealed:true}]};
  expect(validateClue(g,' tide ')).toBe('TIDE');
  for(const clue of ['pear','PEARLS','ear','SPEAR']) expect(()=>validateClue(g,clue)).toThrow();
  expect(validateClue(g,'sun')).toBe('SUN');g.cards[0].revealed=true;expect(()=>validateClue(g,'pear')).toThrow();
  g.cards[1].revealed=true;expect(validateClue(g,'pear')).toBe('PEAR');
 });
});

it('draws an approved 15/6/4 word mix and treats compound or cased board labels as one card', () => {
 const themed = Array.from({length: 15}, (_, i) => 'Theme ' + String.fromCharCode(65+i));
 const technology = Array.from({length: 7}, (_, i) => 'Tool ' + String.fromCharCode(65+i));
 const wildcards = Array.from({length: 5}, (_, i) => 'Wild ' + String.fromCharCode(65+i));
 const g = newGame({ themed, technology, wildcards });
 const drawn = g.cards.map(c => c.word);
 expect(new Set(drawn).size).toBe(25);
 expect(drawn.filter(w => themed.includes(w))).toHaveLength(15);
 expect(drawn.filter(w => technology.includes(w))).toHaveLength(6);
 expect(drawn.filter(w => wildcards.includes(w))).toHaveLength(4);
 expect(() => validateClue(g, 'TheMeA')).toThrow(/unrevealed/);
 expect(() => validateClue({cards:[{word:'Ice-Cream',color:'red',revealed:false}]}, 'creamery')).toThrow(/unrevealed/);
});

it('fails closed on missing team settings, invalid labels and duplicate cards', async () => {
 const { readTeamConfig, readDeck } = await import('../src/wordagents/packs');
 const deck = {
  themed: Array.from({length: 15}, (_, i) => 'Theme ' + String.fromCharCode(65+i)),
  technology: ['Puzzle Box', 'Tech B', 'Tech C', 'Tech D', 'Tech E', 'Tech F'],
  wildcards: ['Wild A', 'Wild B', 'Wild C', 'Wild D'],
 };
 const raw = JSON.stringify(deck);
 expect(readDeck(raw)).toEqual(deck);
 expect(readTeamConfig({})).toMatchObject({restricted:false, deck:null});
 expect(readTeamConfig({WORDAGENTS_AEO_DECK:raw})).toMatchObject({restricted:true, members:new Set(), deck:null});
 expect(readTeamConfig({WORDAGENTS_AEO_DECK:raw, WORDAGENTS_TEAM_IDS:'1, tg_2'})).toMatchObject({restricted:true, members:new Set(), deck:null});
 expect(readTeamConfig({WORDAGENTS_AEO_DECK:raw, WORDAGENTS_TEAM_IDS:'1, 2'})).toMatchObject({restricted:true, members:new Set(['tg_1','tg_2']), deck});
 expect(readDeck(JSON.stringify({...deck, wildcards:['PUZZLE-BOX', ...deck.wildcards]}))).toBeNull();
 expect(readDeck(JSON.stringify({...deck, wildcards:['<script>', ...deck.wildcards]}))).toBeNull();
 expect(readDeck(JSON.stringify({...deck, wildcards:[]}))).toBeNull();
});
