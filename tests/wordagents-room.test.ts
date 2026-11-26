import {beforeAll,afterAll,it,expect} from 'vitest';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {build} from 'esbuild';
import {readDeck} from '../src/wordagents/packs';
import {PUBLIC_AEO_DECK} from '../src/wordagents/public-aeo-words';
let mf: Miniflare, room: any, ns: any;
beforeAll(async()=>{
 const {outputFiles}=await build({stdin:{contents:`export {WordAgentsRoom} from './src/wordagents/room'; export default {fetch(){return new Response('test')}}`,resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'neutral',external:['cloudflare:*']});
 mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:outputFiles[0].text,compatibilityDate:'2024-12-01',compatibilityFlags:['nodejs_compat'],durableObjects:{ROOM:{className:'WordAgentsRoom',useSQLite:true}}}));
 await mf.ready;ns=await mf.getDurableObjectNamespace('ROOM');room=ns.get(ns.idFromName('game'));
 await room.fetch('https://test/create',{method:'POST',body:JSON.stringify({roomCode:'ABCD'})});
},30000);
afterAll(async()=>{await mf?.dispose()});
async function connect(id:string,stub:any=room){const r=await stub.fetch(`https://test/?playerId=${id}&name=Player${id}`,{headers:{Upgrade:'websocket'}});const ws=r.webSocket;ws.accept();const frames:any[]=[];ws.addEventListener('message',(e:any)=>frames.push(JSON.parse(e.data)));return {ws,frames,send:(m:unknown)=>ws.send(JSON.stringify(m)),state:()=>frames.filter(f=>f.type==='state').at(-1)};}
function expectAllocation(players: any[], size: number) {
 const sizes = ['red','blue'].map(team => {
  const members = players.filter(p => p.team === team);
  expect(members.filter(p => p.role === 'spymaster')).toHaveLength(1);
  expect(members.filter(p => p.role === 'operative')).toHaveLength(members.length - 1);
  return members.length;
 });
 expect(players).toHaveLength(size);
 expect(new Set(players.map(p => p.id)).size).toBe(size);
 expect(sizes.sort((a,b) => a-b)).toEqual([Math.floor(size/2), Math.ceil(size/2)]);
}
it('enforces membership, roles, secret views, version guards and reconnect authority',async()=>{
 const clients=[];
 for(let i=1;i<=4;i++){
  const c=await connect(`tg_${i}`);clients.push(c);c.send({type:'join'});
  await expect.poll(()=>c.state()?.players.length).toBe(i);
  expect(c.state().you).toMatchObject({team:null,role:null});
  if(i===3){
   clients[0].send({type:'start'});
   await expect.poll(()=>clients[0].frames.some(f=>f.message?.includes('At least four'))).toBe(true);
  }
 }
 const guest=await connect('guest_x');guest.send({type:'join'});await expect.poll(()=>guest.frames.some(f=>f.message?.includes('Sign in'))).toBe(true);
 clients[0].send({type:'start',pack:'unknown'});await expect.poll(()=>clients[0].frames.some(f=>f.message?.includes('Choose a known word pack'))).toBe(true);
 expect(clients[0].state().game).toBeNull();
 clients[0].send({type:'start'});await expect.poll(()=>clients[0].state()?.game?.phase).toBe('clue');
 await expect.poll(()=>clients.every(c=>c.state()?.game?.cards.length===25)).toBe(true);
 await expect.poll(()=>guest.state()?.game?.cards.length).toBe(25);
 const s=clients[0].state();
 expectAllocation(s.players,4);
 for(const c of clients) expect(c.state().game.cards.every((card:any)=>(card.color!==null)===(c.state().you.role==='spymaster'))).toBe(true);
 expect(guest.state().game.cards.every((c:any)=>c.color===null)).toBe(true);
 const master=clients.find(c=>c.state().you.team===s.game.turn&&c.state().you.role==='spymaster')!;
 const op=clients.find(c=>c.state().you.team===s.game.turn&&c.state().you.role==='operative')!;
 op.send({type:'choose',team:s.game.turn,role:'spymaster'});await expect.poll(()=>op.frames.some(f=>f.message?.includes('assigned when a round starts'))).toBe(true);
 expect(op.state().you.role).toBe('operative');
 op.send({type:'clue',word:'Conceptual',count:1,gameId:s.game.id,revision:s.revision});await expect.poll(()=>op.frames.some(f=>f.message?.includes('Only the spymaster'))).toBe(true);
 master.send({type:'clue',word:'Conceptual',count:1,gameId:s.game.id,revision:s.revision});await expect.poll(()=>op.state().game.phase).toBe('guess');
 const t=op.state(),idx=master.state().game.cards.findIndex((c:any)=>c.color===t.game.turn);const action={type:'guess',index:idx,gameId:t.game.id,revision:t.revision};op.send(action);op.send(action);
 await expect.poll(()=>op.state().game.cards.filter((c:any)=>c.revealed).length).toBe(1);await expect.poll(()=>op.frames.some(f=>f.message?.includes('board changed'))).toBe(true);
 const beforeReconnect=op.state().you;
 const re=await connect(beforeReconnect.id);re.send({type:'sync'});await expect.poll(()=>re.state()?.game.cards.filter((c:any)=>c.revealed).length).toBe(1);expect(re.state().you).toEqual(beforeReconnect);
 for(const c of [...clients,guest,re])c.ws.close();
 await new Promise(resolve=>setTimeout(resolve,100));
 const returning=await connect('tg_3'); returning.send({type:'sync'});
 await expect.poll(()=>returning.state()?.hostId).toBe('tg_3');
 // The chosen host gets the room back on reconnect; the stand-in was only temporary.
 const original=await connect('tg_1');original.send({type:'sync'});await expect.poll(()=>returning.state()?.hostId).toBe('tg_1');
 returning.ws.close();original.ws.close();
},30000);

it('keeps rejoins and marks off the board revision, assigns teams at start, blocks removed and late joiners, and reassigns at rematch',async()=>{
 const stub=ns.get(ns.idFromName('second'));await stub.fetch('https://test/create',{method:'POST',body:JSON.stringify({roomCode:'WXYZ'})});
 const c:any[]=[];for(let i=1;i<=6;i++){const x=await connect(`tg_${10+i}`,stub);c.push(x);x.send({type:'join'});await expect.poll(()=>x.state()?.players.length).toBe(i);}
 const host=c[0];const rev=host.state().revision;
 c[1].send({type:'join'});c[1].send({type:'sync'});await expect.poll(()=>c[1].frames.filter((f:any)=>f.type==='state').length).toBeGreaterThan(2);
 expect(c[1].state().revision).toBe(rev);
 const guest=await connect('guest_watch',stub);await expect.poll(()=>host.state()?.watchers).toBe(1);
 c[1].send({type:'start'});await expect.poll(()=>c[1].frames.some((f:any)=>f.message?.includes('Only the host'))).toBe(true);
 host.send({type:'randomize'});await expect.poll(()=>host.frames.some((f:any)=>f.message?.includes('assigned when a round starts'))).toBe(true);
 expect(host.state().players.every((p:any)=>p.team===null&&p.role===null)).toBe(true);
 host.send({type:'kick',playerId:'tg_16'});await expect.poll(()=>host.state().players.length).toBe(5);
 await expect.poll(()=>c[5].state().you.removed).toBe(true);
 c[5].send({type:'join'});await expect.poll(()=>c[5].frames.some((f:any)=>f.message?.includes('removed you'))).toBe(true);
 host.send({type:'start'});await expect.poll(()=>host.state()?.game?.phase).toBe('clue');
 expectAllocation(host.state().players,5);
 const late=await connect('tg_99',stub);late.send({type:'join'});await expect.poll(()=>late.frames.some((f:any)=>f.message?.includes('round is on the board'))).toBe(true);
 const byId=(id:string)=>c[Number(id.slice(3))-11];
 const s=host.state(),turn=s.game.turn,players=s.players.filter((p:any)=>p.team===turn);
 const spy=byId(players.find((p:any)=>p.role==='spymaster').id),op=byId(players.find((p:any)=>p.role==='operative').id);
 spy.send({type:'clue',word:'Conceptual',count:2,gameId:s.game.id,revision:s.revision});await expect.poll(()=>op.state().game.phase).toBe('guess');
 const g=op.state(),key=spy.state().game.cards;
 spy.send({type:'mark',index:0,gameId:g.game.id});await expect.poll(()=>spy.frames.some((f:any)=>f.message?.includes('mark cards'))).toBe(true);
 op.send({type:'mark',index:3,gameId:g.game.id});await expect.poll(()=>guest.state().game.marks).toEqual([{playerId:op.state().you.id,index:3}]);
 expect(op.state().revision).toBe(g.revision);
 op.send({type:'guess',index:key.findIndex((k:any)=>k.color==='assassin'),gameId:g.game.id,revision:g.revision});
 await expect.poll(()=>guest.state().game.phase).toBe('finished');
 expect(guest.state().game.endReason).toBe('assassin');expect(guest.state().game.cards.every((k:any)=>k.color)).toBe(true);
 const finished=host.state();
 // Removing a prior spymaster guarantees a valid rematch cannot reuse assignments,
 // without relying on independent draws returning different roles by chance.
 const outgoing = finished.players.find((p:any)=>p.role==='spymaster'&&p.id!==host.state().you.id);
 byId(outgoing.id).send({type:'leave'});
 await expect.poll(()=>host.state().players.length).toBe(4);
 host.send({type:'start'});
 await expect.poll(()=>host.state().game?.id).not.toBe(finished.game.id);
 expect(host.state().game.phase).toBe('clue');
 expectAllocation(host.state().players,4);
 expect(host.state().players.some((p:any)=>p.id===outgoing.id)).toBe(false);
 expect(finished.players.filter((p:any)=>p.role==='operative').some((p:any)=>host.state().players.find((q:any)=>q.id===p.id)?.role==='spymaster')).toBe(true);
 for(const x of [...c,guest,late])x.ws.close();
},30000);

it('includes every seated player and requires them online for the next mission',async()=>{
 const stub=ns.get(ns.idFromName('third'));await stub.fetch('https://test/create',{method:'POST',body:JSON.stringify({roomCode:'BNCH'})});
 const c:any[]=[];for(let i=1;i<=5;i++){const x=await connect(`tg_${30+i}`,stub);c.push(x);x.send({type:'join'});await expect.poll(()=>x.state()?.players.length).toBe(i);}
 c[0].send({type:'start'});await expect.poll(()=>c[4].state()?.game?.phase).toBe('clue');
 expect(c[4].state().you.team).not.toBeNull();
 expectAllocation(c[4].state().players,5);
 c[3].ws.close();await expect.poll(()=>c[0].state().players.find((p:any)=>p.id==='tg_34').connected).toBe(false);
 c[1].send({type:'abandon'});await expect.poll(()=>c[1].frames.some((f:any)=>f.message?.includes('Only the host can end'))).toBe(true);
 c[0].send({type:'abandon'});await expect.poll(()=>c[0].state().game).toBeNull();
 expect(c[0].state().players.every((p:any)=>p.team===null&&p.role===null)).toBe(true);
 c[0].send({type:'start'});await expect.poll(()=>c[0].frames.some((f:any)=>f.message?.includes('Everyone in the room must be connected'))).toBe(true);
 c[0].send({type:'kick',playerId:'tg_34'});
 await expect.poll(()=>c[0].state().players.length).toBe(4);
 c[0].send({type:'start'});await expect.poll(()=>c[0].state().game?.phase).toBe('clue');
 for(const x of [c[0],c[1],c[2],c[4]])x.ws.close();
},30000);

it('only permits allowlisted sockets and keeps the selected pack on rematch', async () => {
 const {outputFiles}=await build({stdin:{contents:`export {WordAgentsRoom} from './src/wordagents/room'; export default {fetch(){return new Response('test')}}`,resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'neutral',external:['cloudflare:*']});
 const code = outputFiles[0].text;
 const deck = Object.fromEntries([['themed',16],['technology',7],['wildcards',5]].map(([bucket,n])=>[bucket,Array.from({length:Number(n)},(_,i)=>bucket+' '+String.fromCharCode(65+i))]));
 const priv = new Miniflare(convertV4MiniflareOptions({modules:true,script:code,compatibilityDate:'2024-12-01',compatibilityFlags:['nodejs_compat'],durableObjects:{ROOM:{className:'WordAgentsRoom',useSQLite:true}},bindings:{WORDAGENTS_AEO_DECK:JSON.stringify(deck),WORDAGENTS_TEAM_IDS:'1,2,3,4'}}));
 try {
  const space = await priv.getDurableObjectNamespace('ROOM');
  const stub = space.get(space.idFromName('private'));
  await stub.fetch('https://test/create',{method:'POST',body:JSON.stringify({roomCode:'TEAM'})});
  async function reject(id:string) {
   const response=await stub.fetch('https://test/?playerId='+id,{headers:{Upgrade:'websocket'}});
   const ws=response.webSocket!; const frames: unknown[]=[];
   const code = new Promise<number>(resolve=>ws.addEventListener('close', event=>resolve(event.code)));
   ws.addEventListener('message', event=>frames.push(event.data)); ws.accept();
   ws.send('{"type":"sync"}');
   await expect(code).resolves.toBe(4403); expect(frames).toEqual([]);
  }
  const clients=[];
  for (let i=1;i<=4;i++) {
   const c=await connect('tg_'+i,stub);clients.push(c);c.send({type:'join'});
   await expect.poll(()=>c.state()?.players.length).toBe(i);
  }
  const host=clients[0];
  expect(host.state().availablePacks).toEqual(['classic','aeo']);
  await reject('guest_1'); await reject('tg_5');
  clients[1].send({type:'start',pack:'aeo'});
  await expect.poll(()=>clients[1].frames.some(f=>f.message?.includes('Only the host'))).toBe(true);
  host.send({type:'start',pack:'aeo'});
  await expect.poll(()=>host.state()?.game?.cards.length).toBe(25);
  expect(host.state().pack).toBe('aeo');
  expect(host.state().game.cards.filter((c:any)=>c.word.startsWith('themed '))).toHaveLength(15);
  await reject('tg_5');
  const id=host.state().game.id, turn=host.state().game.turn;
  const spy=clients.find(c=>c.state()?.you.role==='spymaster'&&c.state()?.you.team===turn)!;
  const op=clients.find(c=>c.state()?.you.role==='operative'&&c.state()?.you.team===turn)!;
  spy.send({type:'clue',word:'Conceptual',count:1,gameId:id,revision:host.state().revision});
  await expect.poll(()=>op.state()?.game?.phase).toBe('guess');
  op.send({type:'guess',index:spy.state().game.cards.findIndex((x:any)=>x.color==='assassin'),gameId:id,revision:op.state().revision});
  await expect.poll(()=>host.state()?.game?.phase).toBe('finished');
  host.send({type:'start'});
  await expect.poll(()=>host.state()?.game?.id).not.toBe(id);
  expect(host.state().pack).toBe('aeo');
  for(const c of clients)c.ws.close();
 } finally {await priv.dispose();}
},30000);

async function publicPackTestWorker(bindings: Record<string, string> = {}): Promise<Miniflare> {
  const { outputFiles } = await build({
    stdin: {
      contents: `
        import { WordAgentsRoom } from './src/wordagents/room';
        export class PublicPackTestRoom extends WordAgentsRoom {
          async fetch(request) {
            const path = new URL(request.url).pathname;
            if (path === '/seed-legacy-classic' || path === '/seed-legacy-aeo') {
              await this.ctx.storage.put('state', {
                roomCode: 'OLD1', revision: 0, hostId: null, players: [], game: null,
                ...(path === '/seed-legacy-aeo' ? { pack: 'aeo' } : {}),
              });
              return new Response(null, { status: 204 });
            }
            return super.fetch(request);
          }
        }
        export default { fetch() { return new Response('test'); } };
      `,
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
    external: ['cloudflare:*'],
  });
  return new Miniflare(convertV4MiniflareOptions({
    modules: true,
    script: outputFiles[0].text,
    compatibilityDate: '2024-12-01',
    compatibilityFlags: ['nodejs_compat'],
    durableObjects: { ROOM: { className: 'PublicPackTestRoom', useSQLite: true } },
    bindings,
  }));
}

it('bundles the refreshed public AEO bank and leaves challenge cards out', () => {
  const { themed, technology, wildcards } = PUBLIC_AEO_DECK;
  expect([themed.length, technology.length, wildcards.length]).toEqual([58, 63, 47]);
  expect(themed).toEqual(expect.arrayContaining(['genCentral', 'AskNav', 'searchCentral', 'Member-facing']));
  expect(technology).toEqual(expect.arrayContaining(['Harness', 'LLM', 'GPT-6-Luna']));
  expect(wildcards).toEqual(expect.arrayContaining(['Meat Proxy', 'snacCentral', 'Caifan', 'toriQ', 'Jollibee', 'TON Coffee', 'Square2', 'Stuffd', 'Alchemist', 'Matcha']));
  expect([...themed, ...technology, ...wildcards]).not.toEqual(expect.arrayContaining(['Vector']));
});

it('offers built-in public AEO to hosts while keeping legacy AEO rooms private', async () => {
  expect(readDeck(JSON.stringify(PUBLIC_AEO_DECK))).toEqual(PUBLIC_AEO_DECK);
  const worker = await publicPackTestWorker();
  try {
    const namespace = await worker.getDurableObjectNamespace('ROOM');
    const publicRoom = namespace.get(namespace.idFromName('public-aeo'));
    expect((await publicRoom.fetch('https://test/seed-legacy-classic', { method: 'POST' })).status).toBe(204);

    const players = [];
    for (let i = 1; i <= 4; i++) {
      const player = await connect(`tg_${i}`, publicRoom);
      players.push(player);
      player.send({ type: 'join' });
      await expect.poll(() => player.state()?.players.length).toBe(i);
    }
    const [host, teammate] = players;
    const guest = await connect('guest_public', publicRoom);
    await expect.poll(() => guest.state()?.availablePacks).toEqual(['classic', 'aeo']);
    expect(host.state().pack).toBe('classic');
    expect(guest.state().game).toBeNull();
    teammate.send({ type: 'start', pack: 'aeo' });
    await expect.poll(() => teammate.frames.some(frame => frame.message?.includes('Only the host'))).toBe(true);

    host.send({ type: 'start', pack: 'aeo' });
    await expect.poll(() => guest.state()?.game?.cards.length).toBe(25);
    expect(guest.state().pack).toBe('aeo');
    for (const [words, count] of [[PUBLIC_AEO_DECK.themed, 15], [PUBLIC_AEO_DECK.technology, 6], [PUBLIC_AEO_DECK.wildcards, 4]] as const) {
      const bucket = new Set<string>(words);
      expect(guest.state().game.cards.filter((card: { word: string }) => bucket.has(card.word))).toHaveLength(count);
    }
    expect(guest.state().game.cards.every((card: { color: string | null }) => card.color === null)).toBe(true);
    const afterStart = await connect('guest_after_start', publicRoom);
    await expect.poll(() => afterStart.state()?.pack).toBe('aeo');

    const gameId = guest.state().game.id;
    const startingTeam = guest.state().game.turn;
    await expect.poll(() => players.every(player => player.state()?.game?.id === gameId)).toBe(true);
    const spy = players.find(player => player.state().you.role === 'spymaster' && player.state().you.team === startingTeam)!;
    const operative = players.find(player => player.state().you.role === 'operative' && player.state().you.team === startingTeam)!;
    spy.send({ type: 'clue', word: 'Harmony', count: 1, gameId, revision: spy.state().revision });
    await expect.poll(() => operative.state()?.game?.phase).toBe('guess');
    const assassin = spy.state().game.cards.findIndex((card: { color: string }) => card.color === 'assassin');
    operative.send({ type: 'guess', index: assassin, gameId, revision: operative.state().revision });
    await expect.poll(() => host.state()?.game?.phase).toBe('finished');

    host.send({ type: 'start' });
    await expect.poll(() => guest.state()?.game?.id).not.toBe(gameId);
    expect(guest.state().pack).toBe('aeo');
    host.send({ type: 'abandon' });
    await expect.poll(() => host.state()?.game).toBeNull();
    host.send({ type: 'start', pack: 'classic' });
    await expect.poll(() => guest.state()?.pack).toBe('classic');
    expect(guest.state().game.cards).toHaveLength(25);

    const legacy = namespace.get(namespace.idFromName('legacy-aeo'));
    expect((await legacy.fetch('https://test/seed-legacy-aeo', { method: 'POST' })).status).toBe(204);
    for (const id of ['guest_legacy', 'tg_9']) {
      const response = await legacy.fetch(`https://test/?playerId=${id}`, { headers: { Upgrade: 'websocket' } });
      const socket = response.webSocket!;
      const frames: unknown[] = [];
      const closed = new Promise<number>(resolve => socket.addEventListener('close', event => resolve(event.code)));
      socket.addEventListener('message', event => frames.push(event.data));
      socket.accept();
      await expect(closed).resolves.toBe(4403);
      expect(frames).toEqual([]);
    }
    for (const client of [...players, guest, afterStart]) client.ws.close();
  } finally {
    await worker.dispose();
  }
}, 30000);

it('does not fall back to the public deck in a team-only room with no private deck', async () => {
  const worker = await publicPackTestWorker({ WORDAGENTS_TEAM_IDS: '1,2,3,4' });
  try {
    const namespace = await worker.getDurableObjectNamespace('ROOM');
    const room = namespace.get(namespace.idFromName('missing-private-aeo'));
    await room.fetch('https://test/create', { method: 'POST', body: JSON.stringify({ roomCode: 'CLSC' }) });
    const players = [];
    for (let i = 1; i <= 4; i++) {
      const player = await connect(`tg_${i}`, room);
      players.push(player);
      player.send({ type: 'join' });
      await expect.poll(() => player.state()?.players.length).toBe(i);
    }
    const [host] = players;
    expect(host.state().availablePacks ?? []).not.toContain('aeo');
    host.send({ type: 'start', pack: 'aeo' });
    await expect.poll(() => host.frames.some(frame => frame.message?.includes('pack is not available'))).toBe(true);
    expect(host.state().game).toBeNull();
    host.send({ type: 'start', pack: 'classic' });
    await expect.poll(() => host.state()?.game?.cards.length).toBe(25);
    for (const player of players) player.ws.close();
  } finally {
    await worker.dispose();
  }
}, 30000);

it('lets only the host enable chosen teams and keeps player choices across reconnects and rematches', async () => {
 const stub=ns.get(ns.idFromName('choose-teams'));
 await stub.fetch('https://test/create',{method:'POST',body:JSON.stringify({roomCode:'PICK'})});
 const clients=[];
 for(let i=0;i<5;i++){
  const c=await connect('tg_'+(201+i),stub);clients.push(c);c.send({type:'join'});
  await expect.poll(()=>c.state()?.players.length).toBe(i+1);
 }
 const [host,blue]=clients;
 const guest=await connect('guest_choose',stub);
 let returning: Awaited<ReturnType<typeof connect>> | undefined;
 const launch=(pack?:string)=>host.send({type:'start',teamMode:'choose',revision:host.state().revision,gameId:host.state().game?.id,pack});
 const error=async(c:typeof host,message:string)=>await expect.poll(()=>c.frames.some(f=>f.type==='error'&&f.message.includes(message))).toBe(true);
 try {
  expect(host.state().teamMode).toBe('random');
  blue.send({type:'teamMode',mode:'choose'});await error(blue,'Only the host');
  host.send({type:'teamMode',mode:'choose'});await expect.poll(()=>guest.state()?.teamMode).toBe('choose');
  guest.send({type:'pickTeam',team:'red'});await error(guest,'Join the room');
  launch();await error(host,'Everyone must choose');
  for(const [i,c] of clients.entries()){
   const team=i===1?'blue':'red';
   c.send({type:'pickTeam',team,playerId:'tg_999',role:'spymaster'});
   await expect.poll(()=>c.state()?.you.team).toBe(team);
  }
  launch();await error(host,'at least two players');
  clients[4].send({type:'pickTeam',team:'blue'});
  await expect.poll(()=>host.state().players.filter((p:any)=>p.team==='blue')).toHaveLength(2);
  expect(host.state().players.every((p:any)=>p.role===null)).toBe(true);
  returning=await connect('tg_202',stub);await expect.poll(()=>returning?.state()?.you.team).toBe('blue');
  clients[1]=returning;
  const picks=(s:any)=>s.players.map((p:any)=>[p.id,p.team]);
  const oldRevision=host.state().revision;
  clients[2].send({type:'pickTeam',team:'blue'});
  await expect.poll(()=>host.state().players.filter((p:any)=>p.team==='blue')).toHaveLength(3);
  host.send({type:'start',teamMode:'choose',revision:oldRevision,pack:'aeo'});
  await error(host,'Team setup changed');
  expect(host.state().game).toBeNull();
  const chosen=picks(host.state());
  launch('aeo');await expect.poll(()=>guest.state()?.game?.phase).toBe('clue');
  expect(picks(host.state())).toEqual(chosen);
  expectAllocation(host.state().players,5);
  expect(guest.state().game.cards.every((c:any)=>c.color===null)).toBe(true);
  host.send({type:'pickTeam',team:'blue'});await error(host,'only in the lobby');
  const {game,revision}=host.state();
  await expect.poll(()=>clients.every(c=>c.state()?.game?.id===game.id)).toBe(true);
  const spy=clients.find(c=>c.state().you.team===game.turn&&c.state().you.role==='spymaster')!;
  const op=clients.find(c=>c.state().you.team===game.turn&&c.state().you.role==='operative')!;
  spy.send({type:'clue',word:'Conceptual',count:1,gameId:game.id,revision});
  await expect.poll(()=>op.state().game.phase).toBe('guess');
  op.send({type:'guess',index:spy.state().game.cards.findIndex((c:any)=>c.color==='assassin'),gameId:game.id,revision:op.state().revision});
  await expect.poll(()=>host.state().game.phase).toBe('finished');
  launch();await expect.poll(()=>guest.state()?.game?.id).not.toBe(game.id);
  expect(picks(guest.state())).toEqual(chosen);
  expect(guest.state().pack).toBe('aeo');
  host.send({type:'abandon'});await expect.poll(()=>guest.state().game).toBeNull();
  expect(picks(guest.state())).toEqual(chosen);
  host.send({type:'teamMode',mode:'random'});await expect.poll(()=>guest.state().teamMode).toBe('random');
  expect(guest.state().players.every((p:any)=>p.team===null&&p.role===null)).toBe(true);
  host.send({type:'teamMode',mode:'choose'});await expect.poll(()=>guest.state().teamMode).toBe('choose');
  expect(guest.state().players.every((p:any)=>p.team===null)).toBe(true);
 } finally {for(const c of [...clients,guest])c.ws.close();}
},30000);
