const { test, expect } = require('@playwright/test');
const { startWorker } = require('./live-worker.cjs');
let worker;
test.beforeAll(async()=>{ worker=await startWorker(4264); });
test.afterAll(async()=>{ await worker?.stop(); });
async function preview(page) {
  await page.route('**/*',r=>new URL(r.request().url()).origin===worker.origin?r.continue():r.abort());
  await page.addInitScript(()=>{
    window.playCount=0;
    const original=AudioScheduledSourceNode.prototype.start;
    AudioScheduledSourceNode.prototype.start=function(...args){window.playCount++;return original.apply(this,args);};
    const animate=Element.prototype.animate;
    window.motionCount=0;
    Element.prototype.animate=function(...args){window.motionCount++;return animate.apply(this,args);};
  });
  await page.goto(worker.origin+'/sixnimmt/');
}
async function publish(page,kind) {
  await page.evaluate(kind=>{
    const base={serial:1,phase:'select',turn:1,history:[],revealed:[]};
    const point=kind==='take'?5:0, next={...base,turn:2,history:[{id:'p1',card:55,row:0,points:point},{id:'p2',card:58,row:0,points:0}]};
    const make=game=>({roomCode:'TEST',game,seats:[{id:'p1',name:'Alice'},{id:'p2',name:'Bob'}]});
    document.querySelector('#rows').replaceChildren(document.createElement('div'));
    document.dispatchEvent(new CustomEvent('sixnimmt:state',{detail:{previous:make(base),state:make(next)}}));
  },kind);
}
test('sound defaults off, can be toggled, and remembers the choice', async({page})=>{
  await preview(page);
  const toggle=page.getByRole('button',{name:'Sound off'});
  await expect(toggle).toHaveAttribute('aria-pressed','false');
  await publish(page,'reveal');
  expect(await page.evaluate(()=>window.playCount)).toBe(0);
  await toggle.click();
  await expect(page.getByRole('button',{name:'Sound on'})).toHaveAttribute('aria-pressed','true');
  await expect.poll(()=>page.evaluate(()=>window.playCount)).toBeGreaterThan(0);
  const before=await page.evaluate(()=>window.playCount);
  await publish(page,'take');
  await expect(page.locator('#reveal-strip')).toContainText('Row picked up!');
  await expect(page.locator('.reveal-chip').first()).toContainText('Alice · 55 (+5)');
  await expect.poll(()=>page.evaluate(()=>window.playCount)).toBeGreaterThan(before);
  await expect.poll(()=>page.evaluate(()=>window.motionCount)).toBeGreaterThan(0);
  await page.reload();
  await expect(page.getByRole('button',{name:'Sound on'})).toBeVisible();
  await page.getByRole('button',{name:'Sound on'}).click();
  const muted=await page.evaluate(()=>window.playCount);
  await publish(page,'reveal');
  expect(await page.evaluate(()=>window.playCount)).toBe(muted);
});
test('reduce motion keeps the reveal but skips animation', async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});
  await preview(page);
  await publish(page,'reveal');
  await expect(page.locator('#reveal-strip')).toContainText('Cards revealed!');
  expect(await page.locator('.reveal-chip').first().evaluate(x=>getComputedStyle(x).animationName)).toBe('none');
  expect(await page.evaluate(()=>window.motionCount)).toBe(0);
});
