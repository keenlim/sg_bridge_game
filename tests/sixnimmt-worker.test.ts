import { createRequire } from 'node:module';
import { expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);
const { startWorker } = require('./ui/live-worker.cjs');

it('isolates player hands and validates simultaneous turns over the local Worker', async () => {
  const worker = await startWorker(4263);
  const sockets: WebSocket[] = [];
  try {
    const post = (path: string, init: RequestInit = {}) => fetch(worker.origin + path, {method:'POST',...init});
    expect((await post('/api/sixnimmt/create')).status).toBe(401);
    const login = async (displayName: string) => {
      const r = await post('/api/auth/dev',{body:JSON.stringify({displayName})});
      expect(r.ok).toBe(true);
      return (await r.json() as {token:string}).token;
    };
    const aToken = await login('Alice Worker Six'), bToken = await login('Bob Worker Six');
    const created = await post('/api/sixnimmt/create',{headers:{authorization:'Bearer '+aToken}});
    expect(created.ok).toBe(true);
    const {roomCode} = await created.json() as {roomCode:string};
    type View = { type: 'state'; you: string; seats: {id:string; connected:boolean}[]; game: ReturnType<typeof import('../src/sixnimmt/engine').publicView> | null };
    const connect = async (token?: string) => {
      const params = new URLSearchParams({room:roomCode, playerId:'tg_81', name:'Spoofed'});
      if (token) params.set('token',token);
      const ws = new WebSocket(worker.origin.replace('http:','ws:')+'/api/sixnimmt/ws?'+params);
      sockets.push(ws);
      let view: View | null = null;
      const errors: string[] = [];
      ws.addEventListener('message', e => {
        const data = JSON.parse(String(e.data));
        if (data.type==='state') view=data;
        else if (data.type==='error') errors.push(data.message);
      });
      await vi.waitFor(()=>expect(view).not.toBeNull(),{timeout:5000});
      const get = () => view!;
      const send = (type:string, extra: Record<string,unknown> = {}) =>
        ws.send(JSON.stringify({type,serial:view?.game?.serial,turn:view?.game?.turn,...extra}));
      return {ws,get,send,errors};
    };
    const a = await connect(aToken), b = await connect(bToken), w = await connect();
    expect(w.get().you).toMatch(/^guest_/);
    expect(b.get().you).not.toBe(a.get().you);
    w.send('join'); await vi.waitFor(()=>expect(w.errors).toContain('Sign in with Telegram to take a seat.'));
    a.send('join'); await vi.waitFor(()=>expect(a.get().seats).toHaveLength(1));
    b.send('join'); await vi.waitFor(()=>expect(a.get().seats).toHaveLength(2));
    b.send('start'); await vi.waitFor(()=>expect(b.errors).toContain('Only the host can deal.'));
    a.send('start'); await vi.waitFor(()=>expect(b.get().game?.hand).toHaveLength(10));
    await vi.waitFor(()=>expect(w.get().game?.hand).toEqual([]));
    const pick = a.get().game!.hand[0];
    a.send('select',{card:pick,turn:99}); await vi.waitFor(()=>expect(a.errors).toContain('The turn changed. Please try again.'));
    a.send('select',{card:pick});
    await vi.waitFor(()=>expect(b.get().game?.locked).toEqual([a.get().you]));
    expect(b.get().game?.yourPick).toBeNull();
    expect(w.get().game?.revealed).toEqual([]);
    a.ws.close();
    await vi.waitFor(()=>expect(b.get().seats.find(p=>p.id===a.get().you)?.connected).toBe(false));
    const again = await connect(aToken);
    expect(again.get().you).toBe(a.get().you);
    expect(again.get().game?.yourPick).toBe(pick);
    for (let turn=1;turn<=10;turn++) {
      if(turn>1) again.send('select',{card:again.get().game!.hand[0]});
      b.send('select',{card:b.get().game!.hand[0]});
      for(let i=0;i<3;i++) {
        await vi.waitFor(()=>{const g=again.get().game!; expect(g.phase!=='select'||g.turn>turn).toBe(true);});
        const g=again.get().game!;
        if(g.phase!=='take') break;
        const chooser=g.chooser===again.get().you?again:b;
        await vi.waitFor(()=>expect(chooser.get().game?.revealed[0]?.card).toBe(g.revealed[0].card));
        chooser.send('take',{row:0,card:g.revealed[0].card});
        await vi.waitFor(()=>expect(again.get().game?.revealed[0]?.card).not.toBe(g.revealed[0].card));
      }
      await vi.waitFor(()=>expect(b.get().game?.phase).toBe(again.get().game?.phase));
      await vi.waitFor(()=>expect(b.get().game?.turn).toBe(again.get().game?.turn));
    }
    expect(again.get().game?.phase).toMatch(/round-end|finished/);
    expect(again.get().game?.hand).toEqual([]);
    await vi.waitFor(()=>expect(w.get().game?.scores).toEqual(again.get().game?.scores));
  } finally {
    for (const ws of sockets) ws.close();
    await worker.stop();
  }
}, 45000);
