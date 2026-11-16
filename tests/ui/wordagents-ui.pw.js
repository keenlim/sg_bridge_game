// Browser UI fixtures only; live Worker/game authority is tested separately.
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '../../static');
const initial = () => ({type:'state',roomCode:'ABCD',revision:1,hostId:'me',you:{id:'me',team:'red',role:'operative'},players:[{id:'me',name:'Alex',team:'red',role:'operative',connected:true}],game:{id:'round1',turn:'red',phase:'guess',cards:Array.from({length:25},(_,i)=>({word:`WORD${i}`,revealed:false,color:null})),remaining:{red:9,blue:8},clue:{word:'Ocean',count:2},guessesLeft:3,guessesMade:0,winner:null,log:['Red gave a clue.']}});
async function setup(page) {
  await page.route('**/*',async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/me') return route.fulfill({json:{displayName:'Alex'}});
    if (url.pathname === '/api/config') return route.fulfill({json:{botUsername:'test_bot'}});
    const file = {'/wordagents/':'wordagents/index.html','/wordagents/wordagents.js':'wordagents/wordagents.js','/wordagents/wordagents.css':'wordagents/wordagents.css','/style.css':'style.css','/fc-auth.js':'fc-auth.js','/fc-host.js':'fc-host.js'}[url.pathname];
    if (file) return route.fulfill({body:fs.readFileSync(path.join(root,file)),contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html'});
    return route.abort();
  });
  await page.addInitScript(state => {
    localStorage.setItem('authToken','fixture'); window.framesSent=[];
    class FakeSocket {
      static OPEN=1; static CONNECTING=0;
      constructor(){this.readyState=0;window.fakeSocket=this;setTimeout(()=>{this.readyState=1;this.onopen?.();this.push(state);},20);}
      send(message){window.framesSent.push(message);}
      close(code=1000){this.readyState=3;this.onclose?.({code});}
      push(value){this.onmessage?.({data:typeof value==='string'?value:JSON.stringify(value)});}
    }
    window.WebSocket=FakeSocket;
  }, initial());
  await page.goto('http://127.0.0.1:4184/wordagents/#ABCD');
  await expect(page.locator('.wa-card')).toHaveCount(25);
}
test('operative guesses require confirmation and newer state cancels stale choice', async ({page}) => {
  await setup(page);
  await page.locator('.wa-card').first().click();
  await expect(page.locator('#confirm')).toBeVisible();
  expect(await page.evaluate(()=>framesSent.filter(s=>s.includes('"guess"')))).toHaveLength(0);
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(page.locator('#confirm')).not.toBeVisible();
  await page.locator('.wa-card').first().click();
  const newer=initial();newer.revision=2;
  await page.evaluate(state=>fakeSocket.push(state),newer);
  await expect(page.locator('#confirm')).not.toBeVisible();
  await page.locator('.wa-card').nth(1).click();
  await page.getByRole('button',{name:'Reveal card'}).click();
  expect(await page.evaluate(()=>framesSent.map(s=>{try{return JSON.parse(s);}catch{return{};}}).filter(m=>m.type==='guess'))).toEqual([{type:'guess',index:1,gameId:'round1',revision:2}]);
  await expect(page.locator('.wa-card').first()).toBeDisabled();
});
test('spymaster view labels the secret key and cannot guess', async ({page}) => {
  await setup(page);const state=initial();state.revision=2;state.you.role='spymaster';state.game.phase='clue';state.game.cards[0].color='assassin';
  await page.evaluate(state=>fakeSocket.push(state),state);
  await expect(page.locator('#secret-note')).toBeVisible();
  await expect(page.locator('.wa-card').first()).toHaveAccessibleName('WORD0, Assassin');
  await expect(page.locator('.wa-card').first()).toBeDisabled();
  await expect(page.locator('#clue-form')).toBeVisible();
});
test('mobile board fits and disconnect closes confirmation and pauses input', async ({page}) => {
  await page.setViewportSize({width:390,height:844});await setup(page);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.locator('.wa-card').first().click();
  await page.evaluate(()=>fakeSocket.close(4409));
  await expect(page.locator('#confirm')).not.toBeVisible();
  await expect(page.locator('.wa-card').first()).toBeDisabled();
  await expect(page.locator('#error')).toContainText('another tab');
  await page.getByRole('button',{name:'How to play'}).click();
  await expect(page.locator('#rules')).toBeVisible();await page.keyboard.press('Escape');await expect(page.locator('#rules')).not.toBeVisible();
});

test('signed-in watcher can explicitly join when a running game returns to lobby', async ({page}) => {
  await setup(page);
  const lobby=initial();lobby.revision=2;lobby.game=null;lobby.you={id:'me',team:null,role:null};lobby.hostId='other';lobby.players=[{id:'other',name:'Host',team:'red',role:'spymaster',connected:true}];
  await page.evaluate(state=>fakeSocket.push(state),lobby);
  await expect(page.getByRole('button',{name:'Join this room',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Join operatives'}).first()).toBeDisabled();
  const before=await page.evaluate(()=>framesSent.length);
  await page.getByRole('button',{name:'Join this room',exact:true}).click();
  expect(await page.evaluate(i=>JSON.parse(framesSent[i]),before)).toEqual({type:'join',name:'Alex'});
});
