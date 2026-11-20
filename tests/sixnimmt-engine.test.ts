import { describe, expect, it } from 'vitest';
import { bullheads, deal, lockCard, publicView, takeRow, targetRow } from '../src/sixnimmt/engine';
const order = () => Array.from({length:104}, (_, i) => i+1);
describe('6 nimmt! classic rules', () => {
  it('scores the numbered cards including 55', () => {
    expect([1,5,10,11,55,99,100,104].map(bullheads)).toEqual([1,2,3,5,7,5,3,1]);
  });
  it('deals 10 hands of ten plus four distinct row starters', () => {
    const g = deal(Array.from({length:10}, (_,i)=>'p'+i), 1, undefined, order());
    const cards = [...Object.values(g.hands).flat(),...g.rows.flat()];
    expect(new Set(cards).size).toBe(104);
    expect(g.hands.p9).toHaveLength(10);
    expect(() => deal(['a'], 1)).toThrow();
    expect(() => deal(['a','a'], 1)).toThrow();
  });
  it('uses the closest lower tail and makes a too-low player choose a row', () => {
    expect(targetRow([[1],[80],[38],[47]], 55)).toBe(3);
    const g = deal(['a','b'], 1, undefined, order());
    lockCard(g, 'b', 12);
    expect(publicView(g, 'a')).toMatchObject({locked:['b'], yourPick:null, revealed:[]});
    expect(JSON.stringify(publicView(g,'watcher'))).not.toContain('"card":12');
    expect(publicView(g, 'watcher').hand).toEqual([]);
    expect(() => lockCard(g, 'b', 13)).toThrow();
    expect(() => lockCard(g, 'a', 12)).toThrow();
    lockCard(g, 'a', 1);
    expect(g.phase).toBe('take');
    expect(publicView(g,'b').revealed.map(x=>x.card)).toEqual([1,12]);
    expect(() => takeRow(g,'b',0)).toThrow();
    expect(() => takeRow(g,'a',4)).toThrow();
    takeRow(g,'a',1);
    expect(g.rows[1]).toEqual([1,12]);
    expect(g.scores.a).toBe(5); // removed 22
    expect(g.turn).toBe(2);
  });
  it('takes the five cards, not the sixth, and resolves in ascending order', () => {
    const g=deal(['a','b'],1,undefined,order());
    g.rows=[[1,2,3,4,5],[80],[90],[100]];
    g.hands.a=[6]; g.hands.b=[7];
    lockCard(g,'b',7); lockCard(g,'a',6);
    expect(g.rows[0]).toEqual([6,7]);
    expect(g.scores).toEqual({a:6,b:0});
    expect(g.history.map(x=>x.card)).toEqual([6,7]);
  });
  it('ends at 66 only after the round and preserves totals into a new round', () => {
    const g=deal(['a','b'],1,undefined,order());
    g.scores.a=66;
    lockCard(g,'a',1); lockCard(g,'b',12); takeRow(g,'a',1);
    expect(g.phase).toBe('select');
    g.turn=10;
    lockCard(g,'b',13); lockCard(g,'a',2);
    expect(g.phase).toBe('take');
    takeRow(g,'a',1);
    expect(g.phase).toBe('finished');
    expect(publicView(g,'a').winners).toEqual(['b']);
    expect(() => deal(g.seats,2,g)).toThrow();
    g.phase='round-end'; g.scores.a=5;
    const next=deal(g.seats,2,g,order());
    expect(next.scores).toEqual({a:5,b:0});
    expect(next.roundPoints).toEqual({a:0,b:0});
    expect(next.round).toBe(2);
  });
});
