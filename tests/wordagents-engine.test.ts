import {describe,it,expect} from 'vitest';
import {newGame,giveClue,guess,endTurn,gameView,other,WORDS} from '../src/wordagents/engine';
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
});
