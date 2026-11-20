// Real Cloudflare Worker, authenticated WebSockets and two independent browser contexts.
const { test, expect } = require('@playwright/test');
const { startWorker } = require('./live-worker.cjs');
let worker;
test.beforeAll(async () => { worker = await startWorker(4262); });
test.afterAll(async () => { await worker?.stop(); });
const state = p => p.evaluate(() => view);
async function client(browser, displayName, path, mobile = false) {
  const ctx = await browser.newContext(mobile ? { viewport:{width:390,height:844}, isMobile:true, hasTouch:true } : { viewport:{width:1366,height:900} });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', error => errors.push(error.message));
  await p.route('**/*', r => new URL(r.request().url()).origin === worker.origin ? r.continue() : r.abort());
  if (displayName) {
    const auth = await fetch(worker.origin+'/api/auth/dev',{method:'POST',body:JSON.stringify({displayName})});
    expect(auth.status).toBe(200);
    const { token } = await auth.json();
    await p.addInitScript(t => localStorage.setItem('authToken',t),token);
  }
  await p.goto(worker.origin+path);
  return {ctx,p,errors};
}
test('hub, real two-player room, seat authorization, hidden cards, reconnect and round completion', async ({browser}) => {
  test.setTimeout(90000);
  const clients=[];
  try {
    const alice=await client(browser,'Alice Six','/'); clients.push(alice);
    const a=alice.p;
    await a.getByRole('link',{name:/Play 6 nimmt!/}).click();
    await a.getByRole('button',{name:'Create a room'}).click();
    await a.getByRole('button',{name:'Take a seat'}).click();
    const code=(await state(a)).roomCode;
    const bob=await client(browser,'Bob Six','/sixnimmt/#'+code,true); clients.push(bob);
    const guest=await client(browser,null,'/sixnimmt/#'+code,true); clients.push(guest);
    const b=bob.p, w=guest.p;
    await b.getByRole('button',{name:'Take a seat'}).tap();
    await expect(w.getByRole('button',{name:'Take a seat'})).toHaveCount(0);
    await expect(b.getByRole('button',{name:'Deal cards'})).toHaveCount(0);
    await a.getByRole('button',{name:'Deal cards'}).click();
    await expect(b.locator('#hand button')).toHaveCount(10);
    await expect(w.locator('#hand button')).toHaveCount(0);
    await expect(b.locator('#rows .row')).toHaveCount(4);
    await expect(b.locator('#rows .row-total')).toHaveCount(4);
    await expect(b.locator('#seats .six-seat.own')).toContainText('Bob Six');
    const rects = await b.locator('#hand button').evaluateAll(cards =>
      cards.map(card => {const r = card.getBoundingClientRect(); return {y:card.offsetTop,w:r.width,h:r.height};}));
    expect(new Set(rects.map(r => r.y)).size).toBe(2);
    expect(rects.every(r => r.w >= 44 && r.h >= 44)).toBe(true);
    await w.setViewportSize({width:320,height:740});
    expect(await w.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    const aHand=(await state(a)).game.hand;
    const bHand=(await state(b)).game.hand;
    expect(new Set([...aHand,...bHand]).size).toBe(20);
    await a.locator('#hand button').first().click();
    await a.getByRole('button',{name:'Lock card'}).click();
    await expect.poll(async () => (await state(b)).game.locked.length).toBe(1);
    expect((await state(b)).game.yourPick).toBeNull();
    expect((await state(w)).game.revealed).toEqual([]);
    await a.reload();
    await expect(a.locator('#turn-info')).toContainText('Card locked');
    await expect(a.locator('#hand button')).toHaveCount(10);
    expect(await b.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (let turn=1;turn<=10;turn++) {
      await expect(a.locator('#round')).toContainText(`Card ${turn} of 10`);
      if (turn>1) {
        await a.locator('#hand button').first().click(); await a.getByRole('button',{name:'Lock card'}).click();
      }
      await b.locator('#hand button').first().tap(); await b.getByRole('button',{name:'Lock card'}).tap();
      for (let choice=0;choice<3;choice++) {
        await expect.poll(async () => {const g=(await state(a)).game; return g.phase==='take'||g.phase!=='select'||g.turn>turn;}).toBe(true);
        const s=await state(a);
        if (s.game.phase !== 'take') break;
        const picker=s.game.chooser===s.you?a:b;
        await picker.locator('.row.choice .row-action').first().click();
        const card=s.game.revealed[0].card;
        await expect.poll(async () => (await state(a)).game.revealed[0]?.card).not.toBe(card);
      }
    }
    await expect.poll(async () => (await state(a)).game.phase).toMatch(/round-end|finished/);
    expect((await state(a)).game.hand).toEqual([]);
    expect((await state(b)).game.hand).toEqual([]);
    expect(Object.values((await state(a)).game.scores).reduce((s,n)=>s+n,0)).toBeGreaterThan(0);
    if ((await state(a)).game.phase === 'round-end') {
      await a.getByRole('button',{name:'Deal next round'}).click();
      await expect(b.locator('#round')).toContainText('Round 2');
      await expect(b.locator('#hand button')).toHaveCount(10);
    }
    for (const c of clients) expect(c.errors).toEqual([]);
  } finally { await Promise.all(clients.map(c=>c.ctx.close())); }
});
