import {beforeAll,afterAll,it,expect} from 'vitest';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {build} from 'esbuild';
let mf: Miniflare, room: any;
beforeAll(async()=>{
 const {outputFiles}=await build({stdin:{contents:`export {WordAgentsRoom} from './src/wordagents/room'; export default {fetch(){return new Response('test')}}`,resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'neutral',external:['cloudflare:*']});
 mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:outputFiles[0].text,compatibilityDate:'2024-12-01',compatibilityFlags:['nodejs_compat'],durableObjects:{ROOM:{className:'WordAgentsRoom',useSQLite:true}}}));
 await mf.ready;const ns=await mf.getDurableObjectNamespace('ROOM');room=ns.get(ns.idFromName('game'));
 await room.fetch('https://test/create',{method:'POST',body:JSON.stringify({roomCode:'ABCD'})});
},30000);
afterAll(async()=>{await mf?.dispose()});
async function connect(id:string){const r=await room.fetch(`https://test/?playerId=${id}&name=Player${id}`,{headers:{Upgrade:'websocket'}});const ws=r.webSocket;ws.accept();const frames:any[]=[];ws.addEventListener('message',(e:any)=>frames.push(JSON.parse(e.data)));return {ws,frames,send:(m:unknown)=>ws.send(JSON.stringify(m)),state:()=>frames.filter(f=>f.type==='state').at(-1)};}
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
 await expect.poll(()=>returning.state()?.hostId).toBe('tg_3');returning.ws.close();
},30000);
