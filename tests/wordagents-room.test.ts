import {beforeAll,afterAll,it,expect} from 'vitest';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {build} from 'esbuild';
let mf: Miniflare, room: any, ns: any;
beforeAll(async()=>{
 const {outputFiles}=await build({stdin:{contents:`export {WordAgentsRoom} from './src/wordagents/room'; export default {fetch(){return new Response('test')}}`,resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'neutral',external:['cloudflare:*']});
 mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:outputFiles[0].text,compatibilityDate:'2024-12-01',compatibilityFlags:['nodejs_compat'],durableObjects:{ROOM:{className:'WordAgentsRoom',useSQLite:true}}}));
 await mf.ready;ns=await mf.getDurableObjectNamespace('ROOM');room=ns.get(ns.idFromName('game'));
 await room.fetch('https://test/create',{method:'POST',body:JSON.stringify({roomCode:'ABCD'})});
},30000);
afterAll(async()=>{await mf?.dispose()});
async function connect(id:string,stub:any=room){const r=await stub.fetch(`https://test/?playerId=${id}&name=Player${id}`,{headers:{Upgrade:'websocket'}});const ws=r.webSocket;ws.accept();const frames:any[]=[];ws.addEventListener('message',(e:any)=>frames.push(JSON.parse(e.data)));return {ws,frames,send:(m:unknown)=>ws.send(JSON.stringify(m)),state:()=>frames.filter(f=>f.type==='state').at(-1)};}
it('enforces membership, roles, secret views, version guards and reconnect authority',async()=>{
 const clients=[];for(let i=1;i<=4;i++){const c=await connect(`tg_${i}`);clients.push(c);c.send({type:'join'});await expect.poll(()=>c.state()?.players.length).toBe(i);c.send({type:'choose',team:i<=2?'red':'blue',role:i%2?'spymaster':'operative'});await expect.poll(()=>c.state()?.you.role).toBe(i%2?'spymaster':'operative');}
 const guest=await connect('guest_x');guest.send({type:'join'});await expect.poll(()=>guest.frames.some(f=>f.message?.includes('Sign in'))).toBe(true);
 clients[0].send({type:'start'});await expect.poll(()=>clients[0].state()?.game?.phase).toBe('clue');
 await expect.poll(()=>clients[1].state()?.game?.cards.length).toBe(25);
 expect(clients[0].state().game.cards.every((c:any)=>c.color!==null)).toBe(true);
 expect(clients[1].state().game.cards.every((c:any)=>c.color===null)).toBe(true);expect(guest.state().game.cards.every((c:any)=>c.color===null)).toBe(true);
 const s=clients[0].state(), red=s.game.turn==='red', master=clients[red?0:2],op=clients[red?1:3];
 op.send({type:'choose',team:s.game.turn,role:'spymaster'});await expect.poll(()=>op.frames.some(f=>f.message?.includes('lobby'))).toBe(true);
 op.send({type:'clue',word:'Conceptual',count:1,gameId:s.game.id,revision:s.revision});await expect.poll(()=>op.frames.some(f=>f.message?.includes('Only the spymaster'))).toBe(true);
 master.send({type:'clue',word:'Conceptual',count:1,gameId:s.game.id,revision:s.revision});await expect.poll(()=>op.state().game.phase).toBe('guess');
 const t=op.state(),idx=master.state().game.cards.findIndex((c:any)=>c.color===t.game.turn);const action={type:'guess',index:idx,gameId:t.game.id,revision:t.revision};op.send(action);op.send(action);
 await expect.poll(()=>op.state().game.cards.filter((c:any)=>c.revealed).length).toBe(1);await expect.poll(()=>op.frames.some(f=>f.message?.includes('board changed'))).toBe(true);
 const re=await connect(red?'tg_2':'tg_4');re.send({type:'sync'});await expect.poll(()=>re.state()?.game.cards.filter((c:any)=>c.revealed).length).toBe(1);expect(re.state().you.role).toBe('operative');
 for(const c of [...clients,guest,re])c.ws.close();
 await new Promise(resolve=>setTimeout(resolve,100));
 const returning=await connect('tg_3'); returning.send({type:'sync'});
 await expect.poll(()=>returning.state()?.hostId).toBe('tg_3');
 // The chosen host gets the room back on reconnect; the stand-in was only temporary.
 const original=await connect('tg_1');original.send({type:'sync'});await expect.poll(()=>returning.state()?.hostId).toBe('tg_1');
 returning.ws.close();original.ws.close();
},30000);

it('keeps rejoins and marks off the board revision, shuffles teams, blocks removed and late joiners, and rematches',async()=>{
 const stub=ns.get(ns.idFromName('second'));await stub.fetch('https://test/create',{method:'POST',body:JSON.stringify({roomCode:'WXYZ'})});
 const c:any[]=[];for(let i=1;i<=5;i++){const x=await connect(`tg_${10+i}`,stub);c.push(x);x.send({type:'join'});await expect.poll(()=>x.state()?.players.length).toBe(i);}
 const host=c[0];const rev=host.state().revision;
 c[1].send({type:'join'});c[1].send({type:'sync'});await expect.poll(()=>c[1].frames.filter((f:any)=>f.type==='state').length).toBeGreaterThan(2);
 expect(c[1].state().revision).toBe(rev);
 const guest=await connect('guest_watch',stub);await expect.poll(()=>host.state()?.watchers).toBe(1);
 c[1].send({type:'randomize'});await expect.poll(()=>c[1].frames.some((f:any)=>f.message?.includes('Only the host'))).toBe(true);
 host.send({type:'kick',playerId:'tg_15'});await expect.poll(()=>host.state().players.length).toBe(4);
 await expect.poll(()=>c[4].state().you.removed).toBe(true);
 c[4].send({type:'join'});await expect.poll(()=>c[4].frames.some((f:any)=>f.message?.includes('removed you'))).toBe(true);
 host.send({type:'randomize'});
 await expect.poll(()=>host.state().players.every((p:any)=>p.team&&p.role)).toBe(true);
 for(const team of ['red','blue']){const members=host.state().players.filter((p:any)=>p.team===team);expect(members).toHaveLength(2);expect(members.filter((p:any)=>p.role==='spymaster')).toHaveLength(1);}
 host.send({type:'start'});await expect.poll(()=>host.state()?.game?.phase).toBe('clue');
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
 const finished=host.state();host.send({type:'start'});
 await expect.poll(()=>host.state().game?.id).not.toBe(finished.game.id);
 expect(host.state().game.phase).toBe('clue');expect(host.state().players.map((p:any)=>[p.id,p.team,p.role])).toEqual(finished.players.map((p:any)=>[p.id,p.team,p.role]));
 for(const x of [...c,guest,late])x.ws.close();
},30000);

it('lets bench players watch, rebuilds presence from live sockets, and lets only the host end an abandoned round',async()=>{
 const stub=ns.get(ns.idFromName('third'));await stub.fetch('https://test/create',{method:'POST',body:JSON.stringify({roomCode:'BNCH'})});
 const c:any[]=[];for(let i=1;i<=5;i++){const x=await connect(`tg_${30+i}`,stub);c.push(x);x.send({type:'join'});await expect.poll(()=>x.state()?.players.length).toBe(i);}
 const roles=[['red','spymaster'],['red','operative'],['blue','spymaster'],['blue','operative']];
 for(const [i,[team,role]] of roles.entries()){c[i].send({type:'choose',team,role});await expect.poll(()=>c[i].state().you.role).toBe(role);}
 c[0].send({type:'start'});await expect.poll(()=>c[4].state()?.game?.phase).toBe('clue');
 expect(c[4].state().you.team).toBeNull();expect(c[4].state().game.cards.every((k:any)=>k.color===null)).toBe(true);
 c[3].ws.close();await expect.poll(()=>c[0].state().players.find((p:any)=>p.id==='tg_34').connected).toBe(false);
 c[1].send({type:'abandon'});await expect.poll(()=>c[1].frames.some((f:any)=>f.message?.includes('Only the host can end'))).toBe(true);
 c[0].send({type:'abandon'});await expect.poll(()=>c[0].state().game).toBeNull();
 c[0].send({type:'start'});await expect.poll(()=>c[0].frames.some((f:any)=>f.message?.includes('Each team needs a connected'))).toBe(true);
 c[0].send({type:'kick',playerId:'tg_34'});c[4].send({type:'choose',team:'blue',role:'operative'});
 await expect.poll(()=>c[0].state().players.length).toBe(4);await expect.poll(()=>c[4].state().you.role).toBe('operative');
 c[0].send({type:'start'});await expect.poll(()=>c[0].state().game?.phase).toBe('clue');
 for(const x of [c[0],c[1],c[2],c[4]])x.ws.close();
},30000);
