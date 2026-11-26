// Real local Worker, WordAgentsRoom Durable Object and browser WebSockets. Four dev-login
// players (one on touch mobile) and a signed-out watcher play real rounds through the UI.
const { test, expect } = require('@playwright/test');
const { startWorker } = require('./live-worker.cjs');
const { PUBLIC_AEO_DECK } = require('../../src/wordagents/public-aeo-words.ts');
let worker;
test.beforeAll(async () => { worker = await startWorker(4250); });
test.afterAll(async () => { await worker?.stop(); });

const state = (page) => page.evaluate(() => view);
async function client(browser, name, room, mobile = false) {
  const context = await browser.newContext(mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', (route) => new URL(route.request().url()).origin === worker.origin ? route.continue() : route.abort());
  if (name) {
    const auth = await fetch(`${worker.origin}/api/auth/dev`, { method: 'POST', body: JSON.stringify({ displayName: name }) }).then((r) => r.json());
    await page.addInitScript((token) => localStorage.setItem('authToken', token), auth.token);
  }
  await page.goto(`${worker.origin}/wordagents/${room ? `#${room}` : ''}`);
  return { context, page, errors, mobile, name };
}
const press = (c, locator) => (c.mobile ? locator.tap() : locator.click());

test('four players start without picking roles, reconnect and rematch while a guest watches', async ({ browser }) => {
  test.setTimeout(120000);
  const alice = await client(browser, 'Alice Agent');
  await alice.page.locator('#btn-create').click();
  await expect.poll(async () => (await state(alice.page))?.players.length).toBe(1);
  const room = (await state(alice.page)).roomCode;
  const others = [await client(browser, 'Bob Agent', room), await client(browser, 'Cara Agent', room), await client(browser, 'Dan Agent', room, true)];
  const all = [alice, ...others];
  const guest = await client(browser, null, room, true);
  try {
    await expect.poll(async () => (await state(alice.page)).players.length).toBe(4);
    await expect(alice.page.locator('#tb-watchers')).toHaveText('👁 1');
    await expect(guest.page.locator('#lobby-wait')).toContainText('Sign in');
    await expect(others[0].page.locator('#btn-start')).toBeHidden();
    await expect(alice.page.locator('#btn-start')).toBeEnabled();
    await expect(alice.page.locator('#lobby-roster .wa-member')).toHaveCount(4);
    await expect(alice.page.locator('.wa-lobby-note')).toContainText('assigned randomly');
    await expect(alice.page.getByRole('button', { name: /spymaster|operatives|shuffle teams/i })).toHaveCount(0);
    expect((await state(alice.page)).players.every((p) => p.team === null && p.role === null)).toBe(true);
    await expect(alice.page.locator('#lobby-checklist li:not(.ok)')).toHaveCount(0);
    await alice.page.locator('#btn-start').click();
    for (const c of [...all, guest]) await expect(c.page.locator('#screen-game')).toHaveClass(/active/);

    const roleOf = async (c) => (await state(c.page)).you;
    const roles = await Promise.all(all.map(roleOf));
    const by = (team, role) => all[roles.findIndex((r) => r.team === team && r.role === role)];
    const first = (await state(alice.page)).game.turn, second = first === 'red' ? 'blue' : 'red';
    const spy = by(first, 'spymaster'), op = by(first, 'operative'), otherSpy = by(second, 'spymaster'), otherOp = by(second, 'operative');

    // Only spymasters receive the key.
    await expect(spy.page.locator('.wa-card[class*="key-"]')).toHaveCount(25);
    for (const c of [op, otherOp, guest]) await expect(c.page.locator('.wa-card[class*="key-"]')).toHaveCount(0);
    expect((await state(guest.page)).game.cards.every((c) => c.color === null)).toBe(true);
    await expect(op.page.locator('#clue-form')).toBeHidden();
    await expect(otherSpy.page.locator('#clue-form')).toBeHidden();

    await spy.page.fill('#clue-input', 'Qzxv');
    await press(spy, spy.page.locator('#btn-clue'));
    for (const c of [op, guest]) await expect(c.page.locator('#clue-word')).toHaveText('QZXV');
    const key = (await state(spy.page)).game.cards;
    const own = key.flatMap((card, i) => (card.color === first ? [i] : []));

    // Mark: advisory, visible to everyone, and it does not change the board revision.
    const revision = (await state(op.page)).revision;
    await press(op, op.page.locator(`.wa-card[data-index="${own[0]}"]`));
    await press(op, op.page.locator('#btn-mark'));
    for (const c of [spy, guest]) await expect(c.page.locator(`.wa-card[data-index="${own[0]}"] .wa-marks i`)).toHaveCount(1);
    expect((await state(op.page)).revision).toBe(revision);

    await press(op, op.page.locator('#btn-reveal'));
    for (const c of [...all, guest]) await expect(c.page.locator(`.wa-card[data-index="${own[0]}"]`)).toHaveClass(new RegExp(`revealed c-${first}`));
    await expect(guest.page.locator(`.wa-card[data-index="${own[0]}"] .wa-marks`)).toHaveCount(0);
    await expect(guest.page.locator('.wa-turn-entry').first()).toContainText('QZXV');

    // Reload mid-round: the role and board survive, and the operative can keep guessing.
    await op.page.reload();
    await expect.poll(async () => { const current = await state(op.page); return current?.you; }).toMatchObject({ team: first, role: 'operative' });
    await expect(op.page.locator(`.wa-card[data-index="${own[0]}"]`)).toHaveClass(/revealed/);
    if (op.mobile) expect(await op.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    // The assassin ends the round for the guessing team.
    const assassin = key.findIndex((card) => card.color === 'assassin');
    await press(op, op.page.locator(`.wa-card[data-index="${assassin}"]`));
    await press(op, op.page.locator('#btn-reveal'));
    for (const c of [...all, guest]) await expect(c.page.locator('#modal-over')).toBeVisible({ timeout: 5000 });
    await expect(otherOp.page.locator('#over-title')).toHaveText('🏆 Your team wins!');
    await expect(guest.page.locator('#over-sub')).toContainText('uncovered the assassin');
    expect((await state(guest.page)).game.cards.every((c) => c.color !== null)).toBe(true);
    await expect(others.find((c) => c !== alice).page.locator('#btn-again')).toBeHidden();

    const finished = await state(alice.page);
    await alice.page.locator('#btn-again').click();
    await expect.poll(async () => (await state(guest.page)).game?.id).not.toBe(finished.game.id);
    for (const c of all) await expect(c.page.locator('#modal-over')).toBeHidden();
    const rematch = await state(alice.page);
    expect(rematch.players.map((p) => p.id).sort()).toEqual(finished.players.map((p) => p.id).sort());
    for (const team of ['red', 'blue']) {
      const members = rematch.players.filter((p) => p.team === team);
      expect(members.map((p) => p.role).sort()).toEqual(['operative', 'spymaster']);
    }
    expect((await state(guest.page)).game.cards.every((c) => c.color === null)).toBe(true);
    expect((await state(alice.page)).game.phase).toBe('clue');
    for (const c of [...all, guest]) expect(c.errors).toEqual([]);
  } finally {
    for (const c of [...all, guest]) await c.context.close();
  }
});

test('a second tab takes over the seat and the first tab can reclaim it', async ({ browser }) => {
  const a = await client(browser, 'Tab Agent');
  await a.page.locator('#btn-create').click();
  await expect.poll(async () => (await state(a.page))?.players.length).toBe(1);
  const room = (await state(a.page)).roomCode;
  const b = await a.context.newPage();
  await b.goto(`${worker.origin}/wordagents/#${room}`);
  await expect.poll(async () => (await b.evaluate(() => view))?.players.length).toBe(1);
  await expect(a.page.locator('#overlay-reconnect')).toBeVisible();
  await expect(a.page.locator('#reconnect-message')).toContainText('another tab');
  await a.page.locator('#btn-reconnect').click();
  await expect(a.page.locator('#overlay-reconnect')).toBeHidden();
  await expect(b.locator('#overlay-reconnect')).toBeVisible();
  await b.locator('#btn-reconnect-home').click();
  await expect(b.locator('#screen-home')).toHaveClass(/active/);
  expect(a.errors).toEqual([]);
  await a.context.close();
});


test('public AEO picker works for a touch host and the board survives reload', async ({ browser }) => {
  test.setTimeout(90000);
  const clients = [];
  try {
    const host = await client(browser, 'Theme Host', '', true);
    clients.push(host);
    await press(host, host.page.locator('#btn-create'));
    await expect.poll(async () => (await state(host.page))?.players.length).toBe(1);
    const room = (await state(host.page)).roomCode;
    for (const name of ['Theme Bob', 'Theme Cara', 'Theme Dan', null]) {
      clients.push(await client(browser, name, room, name === null));
    }
    const guest = clients.at(-1);
    await expect.poll(async () => (await state(host.page))?.players.length).toBe(4);
    await expect(host.page.locator('#lobby-pack')).toHaveValue('classic');
    for (const c of clients.slice(1)) await expect(c.page.locator('#lobby-pack')).toBeHidden();
    await host.page.locator('#lobby-pack').selectOption('aeo');
    await press(host, host.page.locator('#btn-start'));
    for (const c of clients) {
      await expect(c.page.locator('#game-pack-badge')).toBeVisible();
      await expect(c.page.locator('.wa-card')).toHaveCount(25);
    }
    const board = (await state(guest.page)).game;
    const words = board.cards.map((card) => card.word);
    expect(new Set(words).size).toBe(25);
    for (const [key, count] of [['themed', 15], ['technology', 6], ['wildcards', 4]]) {
      expect(words.filter((word) => PUBLIC_AEO_DECK[key].includes(word))).toHaveLength(count);
    }
    expect(board.cards.every((card) => card.color === null)).toBe(true);
    await host.page.reload();
    await expect(host.page.locator('#game-pack-badge')).toBeVisible();
    expect((await state(host.page)).game.id).toBe(board.id);
    expect((await state(host.page)).game.cards.map((card) => card.word)).toEqual(words);
    for (const c of clients) expect(c.errors).toEqual([]);
  } finally {
    await Promise.all(clients.map((c) => c.context.close()));
  }
});

test('host combines Choose teams with public AEO and players keep their sides', async ({ browser }) => {
  test.setTimeout(90000);
  const clients = [];
  try {
    const host = await client(browser, 'Pick Host', '', true);
    clients.push(host);
    await press(host, host.page.locator('#btn-create'));
    await expect.poll(async () => (await state(host.page))?.players.length).toBe(1);
    const room = (await state(host.page)).roomCode;
    for (const name of ['Pick Bob', 'Pick Cara', 'Pick Dan', null]) clients.push(await client(browser, name, room));
    const [alice, bob, cara, dan, guest] = clients;
    const mode = host.page.getByLabel('Team setup', { exact: true });
    await expect(mode).toHaveValue('random');
    await expect(guest.page.getByLabel('Team setup', { exact: true })).toBeHidden();
    await mode.selectOption('choose');
    await expect(guest.page.locator('.wa-lobby-note')).toContainText('choose Red or Blue');
    await expect(guest.page.getByRole('button', { name: 'Join Red' })).toBeHidden();
    await expect(host.page.locator('#btn-start')).toBeDisabled();
    for (const [c, side] of [[alice, 'Red'], [bob, 'Blue'], [cara, 'Red'], [dan, 'Blue']]) {
      const pick = c.page.getByRole('button', { name: 'Join ' + side });
      await press(c, pick);
      await expect(pick).toHaveAttribute('aria-pressed', 'true');
    }
    await expect(host.page.locator('#lobby-roster')).toContainText('Red team · 2');
    await expect(host.page.locator('#lobby-roster')).toContainText('Blue team · 2');
    await bob.page.reload();
    await expect(bob.page.getByRole('button', { name: 'Join Blue' })).toHaveAttribute('aria-pressed', 'true');
    await expect(host.page.locator('#btn-start')).toBeEnabled();
    await host.page.locator('#lobby-pack').selectOption('aeo');
    await press(host, host.page.locator('#btn-start'));
    await expect(guest.page.locator('#screen-game')).toHaveClass(/active/);
    const launched = await state(host.page);
    expect(launched.pack).toBe('aeo');
    const words = launched.game.cards.map((card) => card.word);
    expect(new Set(words).size).toBe(25);
    for (const [key, count] of [['themed', 15], ['technology', 6], ['wildcards', 4]]) {
      expect(words.filter((word) => PUBLIC_AEO_DECK[key].includes(word))).toHaveLength(count);
    }
    expect(launched.players.map((p) => [p.name, p.team])).toEqual([
      ['Pick Host', 'red'], ['Pick Bob', 'blue'], ['Pick Cara', 'red'], ['Pick Dan', 'blue'],
    ]);
    for (const c of clients) expect(c.errors).toEqual([]);
  } finally {
    for (const c of clients) await c.context.close();
  }
});
