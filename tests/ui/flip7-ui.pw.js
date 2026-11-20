const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../static');
const initial = () => ({ type:'state',roomCode:'ABCD',revision:2,hostId:'me',minPlayers:3,maxPlayers:12,watchers:0,you:{id:'me',removed:false},players:[{id:'me',name:'Alex',connected:true},{id:'b',name:'Blair',connected:true},{id:'c',name:'Casey',connected:true}],game:{id:'game1',phase:'playing',round:1,dealerId:'c',turnId:'me',deckCount:80,winnerId:null,flippedBy:null,pending:null,players:[{id:'me',total:0,roundScore:7,status:'active',numbers:[2,5],bonuses:[],doubled:false,secondChance:false},{id:'b',total:0,roundScore:9,status:'active',numbers:[9],bonuses:[],doubled:false,secondChance:false},{id:'c',total:0,roundScore:4,status:'stayed',numbers:[4],bonuses:[],doubled:false,secondChance:false}]}});
async function setup(page, state=initial(), { stallFirst = false } = {}) {
 await page.route('**/*', route => {
  const u=new URL(route.request().url());
  if(u.pathname==='/api/me')return route.fulfill({json:{displayName:'Alex'}});
  const f=u.pathname==='/flip7/'?'flip7/index.html':u.pathname.slice(1);
  const full=path.join(root,f);
  if(!full.startsWith(root)||!fs.existsSync(full))return route.fulfill({status:404,body:'Not found'});
  return route.fulfill({body:fs.readFileSync(full),contentType:f.endsWith('.js')?'application/javascript':f.endsWith('.css')?'text/css':'text/html'});
 });
 await page.addInitScript(({ state, stallFirst }) => {
  localStorage.setItem('authToken', 'fixture');
  window.sent = [];
  window.socketAttempts = 0;
  class FakeSocket {
   static OPEN = 1;
   constructor() {
    this.readyState = 0;
    window.sock = this;
    const attempt = ++window.socketAttempts;
    setTimeout(() => {
     if (this.readyState !== 0) return;
     this.readyState = 1;
     this.onopen?.();
     if (attempt !== 1 || !stallFirst) this.push(state);
    }, 10);
   }
   send(message) { window.sent.push(message); }
   close(code = 1000) { this.readyState = 3; this.onclose?.({ code }); }
   push(state) { this.onmessage?.({ data: JSON.stringify(state) }); }
  }
  window.WebSocket = FakeSocket;
 }, { state, stallFirst });
 await page.goto('http://127.0.0.1:4184/flip7/#ABCD');
}
const push=(p,s)=>p.evaluate(s=>sock.push(s),s);
const frames=p=>p.evaluate(()=>sent.filter(x=>x!=='ping').map(x=>JSON.parse(x)));
test('hit sends authoritative revision once and waits for acknowledgement',async({page})=>{await setup(page);await expect(page.getByRole('button',{name:'Hit · draw a card'})).toBeEnabled();await page.getByRole('button',{name:'Hit · draw a card'}).click();expect(await frames(page)).toEqual([{type:'hit',gameId:'game1',revision:2}]);await expect(page.getByRole('button',{name:'Stay · bank 7'})).toBeDisabled();});
test('other turns and disconnected sessions cannot send gameplay',async({page})=>{const s=initial();s.game.turnId='b';await setup(page,s);await expect(page.getByRole('button',{name:'Hit · draw a card'})).toBeDisabled();s.revision++;s.game.turnId='me';await push(page,s);await expect(page.getByRole('button',{name:'Hit · draw a card'})).toBeEnabled();await page.evaluate(()=>sock.close(4409));await expect(page.getByRole('button',{name:'Hit · draw a card'})).toBeDisabled();await expect(page.getByText('This room is open in another tab or device.')).toBeVisible();});
test('only the action actor can choose eligible targets',async({page})=>{const s=initial();s.game.pending={type:'freeze',actorId:'me',targets:['b']};await setup(page,s);await expect(page.getByRole('button',{name:'Choose Blair'})).toBeVisible();await expect(page.getByRole('button',{name:'Choose Casey'})).toHaveCount(0);await page.getByRole('button',{name:'Choose Blair'}).click();expect(await frames(page)).toEqual([{type:'target',playerId:'b',gameId:'game1',revision:2}]);});
test('host sees next round and final results; spectators have no game authority',async({page})=>{const s=initial();s.game.phase='roundEnd';s.game.turnId=null;await setup(page,s);await expect(page.getByRole('button',{name:'Start round 2'})).toBeEnabled();s.revision++;s.game.phase='finished';s.game.winnerId='b';s.game.players[1].total=210;await push(page,s);await expect(page.getByRole('heading',{name:'Blair wins!'})).toBeVisible();s.you.id=null;await push(page,s);await expect(page.getByRole('button',{name:'Back to lobby'})).toHaveCount(0);});
test('mobile board has no horizontal overflow, exposes rules and escapes player names',async({page})=>{await page.setViewportSize({width:390,height:844});const s=initial();s.players[1].name='<img src=x onerror=alert(1)>';await setup(page,s);await expect(page.locator('#players img')).toHaveCount(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.getByRole('button',{name:'How to play'}).click();await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).not.toBeVisible();});
test('lobby enforces minimum connected players and shows authenticated join',async({page})=>{const s=initial();s.game=null;s.players=s.players.slice(0,2);await setup(page,s);await expect(page.getByRole('button',{name:'Start game'})).toBeDisabled();s.you.id='c';await push(page,s);await page.getByRole('button',{name:'Take a seat'}).click();expect(await frames(page)).toEqual([{type:'join'}]);});
test('leaving an active game keeps the server seat and returns home',async({page})=>{await setup(page);page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Leave',exact:true}).click();await expect(page.locator('#home')).toBeVisible();expect(await frames(page)).toEqual([]);});
test('restoring a cached game page reconnects the table', async ({ page }) => {
  await setup(page);
  await expect(page.getByRole('button', { name: 'Hit · draw a card' })).toBeEnabled();
  await page.evaluate(() => {
    window.previousSocket = window.sock;
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
  await expect.poll(() => page.evaluate(() => window.sock !== window.previousSocket)).toBe(true);
  await expect(page.getByRole('button', { name: 'Hit · draw a card' })).toBeEnabled();
});
test('socket that opens without sending state retries and unlocks after syncing', async ({ page }) => {
  await page.clock.install();
  await setup(page, initial(), { stallFirst: true });
  await page.clock.runFor(100);
  await expect(page.locator('#connection')).toHaveText('Connecting…');
  await page.clock.runFor(9600);
  await expect(page.locator('#connection')).toHaveText('● Live');
  await expect(page.getByRole('button', { name: 'Hit · draw a card' })).toBeEnabled();
  expect(await page.evaluate(() => window.socketAttempts)).toBe(2);
});

test('displaced tab will not reclaim a seat after connectivity returns without a click', async ({ page }) => {
  await setup(page);
  await expect(page.locator('#connection')).toHaveText('● Live');
  await page.evaluate(() => {
    window.sock.close(4409);
    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
  await expect(page.getByText('This room is open in another tab or device.')).toBeVisible();
  expect(await page.evaluate(() => window.socketAttempts)).toBe(1);
  await page.getByRole('button', { name: 'Reconnect this tab' }).click();
  await expect(page.locator('#connection')).toHaveText('● Live');
  expect(await page.evaluate(() => window.socketAttempts)).toBe(2);
});

test('offline lobby exit explains that the seat remains reserved', async ({ page }) => {
  const state = initial();
  state.game = null;
  await setup(page, state);
  await expect(page.locator('#connection')).toHaveText('● Live');
  await page.evaluate(() => window.sock.close(1006));
  const dialog = page.waitForEvent('dialog');
  const exit = page.getByRole('button', { name: 'Leave', exact: true }).click();
  const confirmation = await dialog;
  expect(confirmation.message()).toContain('without giving up your seat');
  await confirmation.accept();
  await exit;
  await expect(page.locator('#home')).toBeVisible();
  expect(await frames(page)).toEqual([]);
});
