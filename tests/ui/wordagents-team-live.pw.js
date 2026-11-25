// Local Worker only, using fictional cards and dev-only identities.
const { test, expect } = require('@playwright/test');
const { startWorker } = require('./live-worker.cjs');

const team = ['Team Alice', 'Team Bob', 'Team Cara', 'Team Dan'];
const telegramId = (name) => 900_000_000 + Math.abs([...name].reduce(
  (hash, char) => ((hash << 5) - hash + char.charCodeAt(0)) | 0, 0,
)) % 90_000_000;
const labels = (prefix, count) => Array.from({ length: count }, (_, i) => prefix + ' ' + (i + 1));
let worker;

test.beforeAll(async () => {
  worker = await startWorker(4255, {
    WORDAGENTS_TEAM_IDS: team.map(telegramId).join(','),
    WORDAGENTS_AEO_DECK: JSON.stringify({
      themed: labels('Fictional Mission', 15),
      technology: labels('Demo Circuit', 6),
      wildcards: labels('Imaginary Planet', 4),
    }),
  });
});
test.afterAll(async () => { await worker?.stop(); });

test('team-only room creation and a live four-player Word Agents round', async ({ browser }) => {
  test.setTimeout(90_000);
  const auth = (displayName) => fetch(worker.origin + '/api/auth/dev', {
    method: 'POST', body: JSON.stringify({ displayName }),
  }).then((r) => r.json());
  const notListed = await auth('Unlisted Visitor');
  const create = (token) => fetch(worker.origin + '/api/wordagents/create', {
    method: 'POST', headers: token ? { Authorization: 'Bearer ' + token } : {},
  });
  expect((await create()).status).toBe(401);
  const denied = await create(notListed.token);
  expect(denied.status).toBe(403);
  expect(await denied.json()).not.toHaveProperty('roomCode');

  const contexts = [];
  async function open(token, room = '', mobile = false) {
    const context = await browser.newContext(mobile
      ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : {});
    contexts.push(context);
    const page = await context.newPage();
    await page.route('**/*', (route) => new URL(route.request().url()).origin === worker.origin
      ? route.continue() : route.abort());
    if (token) await page.addInitScript((t) => localStorage.setItem('authToken', t), token);
    await page.goto(worker.origin + '/wordagents/' + (room ? '#' + room : ''));
    return page;
  }
  try {
    const [alice, ...others] = await Promise.all(team.map(auth));
    const host = await open(alice.token);
    await host.locator('#btn-create').click();
    await expect.poll(() => host.evaluate(() => view?.players.length)).toBe(1);
    const room = await host.evaluate(() => view.roomCode);
    for (const token of [null, notListed.token]) {
      const page = await open(token, room);
      await expect(page.locator('#reconnect-message')).toContainText('team-only');
      expect(await page.evaluate(() => !!view)).toBe(false);
    }

    const players = await Promise.all(others.map((p, i) => open(p.token, room, i === 2)));
    await expect.poll(() => host.evaluate(() => view?.players.length)).toBe(4);
    await expect(host.locator('#btn-start')).toBeEnabled();
    for (const player of players) await expect(player.locator('#lobby-pack')).toBeHidden();
    await host.locator('#lobby-pack').selectOption('aeo');
    await host.locator('#btn-start').click();
    for (const player of [host, ...players]) {
      await expect(player.locator('#game-pack-badge')).toBeVisible();
      await expect(player.locator('.wa-card')).toHaveCount(25);
    }
    const board = await host.evaluate(() => view.game.cards.map((card) => card.word));
    expect(new Set(board).size).toBe(25);
    for (const [prefix, count] of [['Fictional Mission', 15], ['Demo Circuit', 6], ['Imaginary Planet', 4]]) {
      expect(board.filter((word) => word.startsWith(prefix))).toHaveLength(count);
    }
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
