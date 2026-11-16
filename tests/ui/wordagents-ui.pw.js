// Browser UI fixtures only: a fake WebSocket feeds projected views. Live Worker/room
// authority is covered by tests/ui/wordagents-live.pw.js and the Vitest room tests.
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '../../static');
const DECK = fs.readFileSync(path.join(root, '../src/wordagents/engine.ts'), 'utf8').match(/WORDS = `([^`]+)`/)[1].split(' ');
const initial = () => ({
  type: 'state', roomCode: 'ABCD', revision: 1, hostId: 'me', watchers: 0, maxPlayers: 12,
  you: { id: 'me', team: 'red', role: 'operative', removed: false },
  players: [
    { id: 'me', name: 'Alex', team: 'red', role: 'operative', connected: true },
    { id: 'p2', name: 'Robin Red', team: 'red', role: 'spymaster', connected: true },
    { id: 'p3', name: 'Blair', team: 'blue', role: 'spymaster', connected: true },
    { id: 'p4', name: 'Casey', team: 'blue', role: 'operative', connected: true },
  ],
  game: {
    id: 'round1', turn: 'red', phase: 'guess',
    cards: Array.from({ length: 25 }, (_, i) => ({ word: DECK[i], revealed: false, color: null })),
    remaining: { red: 9, blue: 8 }, clue: { word: 'OCEAN', count: 2 }, guessesLeft: 3, guessesMade: 0,
    winner: null, endReason: null, history: [{ t: 'start', team: 'red' }, { t: 'clue', team: 'red', word: 'OCEAN', count: 2 }], marks: [],
  },
});
const frames = (page) => page.evaluate(() => framesSent.map((s) => { try { return JSON.parse(s); } catch { return {}; } }));
const push = (page, state) => page.evaluate((s) => fakeSocket.push(s), state);

async function setup(page, state = initial()) {
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/me') return route.fulfill({ json: { displayName: 'Alex' } });
    if (url.pathname === '/api/config') return route.fulfill({ json: { botUsername: 'test_bot' } });
    const file = { '/wordagents/': 'wordagents/index.html', '/wordagents/wordagents.js': 'wordagents/wordagents.js', '/wordagents/wordagents.css': 'wordagents/wordagents.css', '/style.css': 'style.css', '/fc-auth.js': 'fc-auth.js', '/fc-host.js': 'fc-host.js' }[url.pathname];
    if (file) return route.fulfill({ body: fs.readFileSync(path.join(root, file)), contentType: file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html' });
    return route.abort();
  });
  await page.addInitScript((first) => {
    localStorage.setItem('authToken', 'fixture'); window.framesSent = [];
    class FakeSocket {
      static OPEN = 1; static CONNECTING = 0;
      constructor() { this.readyState = 0; window.fakeSocket = this; setTimeout(() => { this.readyState = 1; this.onopen?.(); this.push(first); }, 20); }
      send(message) { window.framesSent.push(message); }
      close(code = 1000) { this.readyState = 3; this.onclose?.({ code }); }
      push(value) { this.onmessage?.({ data: typeof value === 'string' ? value : JSON.stringify(value) }); }
    }
    window.WebSocket = FakeSocket;
  }, state);
  await page.goto('http://127.0.0.1:4184/wordagents/#ABCD');
}

test('operative selects, reveals with the current revision, and a newer board cancels a stale selection', async ({ page }) => {
  await setup(page);
  await expect(page.locator('.wa-card')).toHaveCount(25);
  const first = page.locator('.wa-card').first();
  await expect(page.locator('#btn-reveal')).toBeDisabled();
  await first.click();
  await expect(first).toHaveClass(/selected/);
  await expect(page.locator('#btn-reveal')).toHaveText(`Reveal ${DECK[0]}`);
  expect((await frames(page)).filter((m) => m.type === 'guess')).toHaveLength(0);
  await first.click();
  await expect(first).not.toHaveClass(/selected/);
  await first.click();
  const newer = initial(); newer.revision = 2;
  await push(page, newer);
  await expect(page.locator('.wa-card.selected')).toHaveCount(0);
  await page.locator('.wa-card').nth(1).click();
  await page.locator('#btn-reveal').click();
  expect((await frames(page)).filter((m) => m.type === 'guess')).toEqual([{ type: 'guess', index: 1, gameId: 'round1', revision: 2 }]);
  await expect(page.locator('#btn-reveal')).toBeDisabled();
});

test('marks are shared on the card, toggle from the dock and never change the revision', async ({ page }) => {
  await setup(page);
  await page.locator('.wa-card').nth(4).click();
  await page.locator('#btn-mark').click();
  expect((await frames(page)).filter((m) => m.type === 'mark')).toEqual([{ type: 'mark', index: 4, gameId: 'round1', revision: 1 }]);
  const marked = initial();
  marked.game.marks = [{ playerId: 'me', index: 4 }, { playerId: 'p2', index: 4 }];
  await push(page, marked);
  const card = page.locator('.wa-card').nth(4);
  await expect(card).toHaveClass(/marked/);
  await expect(card.locator('.wa-marks i')).toHaveText(['AL', 'RR']);
  await expect(card).toHaveAccessibleName(`${DECK[4]}, E1, Unrevealed, marked by you, Robin Red`);
  // Same revision: the selection survives an advisory mark update.
  await expect(card).toHaveClass(/selected/);
  await expect(page.locator('#btn-mark')).toHaveText('Unmark');
});

test('spymaster sees a hideable key, validates clues inline and sends normalised clues', async ({ page }) => {
  const state = initial(); state.you.role = 'spymaster'; state.players[0].role = 'spymaster'; state.players[1].role = 'operative';
  state.game.phase = 'clue'; state.game.clue = null; state.game.history = [{ t: 'start', team: 'red' }];
  state.game.cards = state.game.cards.map((c, i) => ({ ...c, color: i === 0 ? 'assassin' : i < 10 ? 'red' : i < 18 ? 'blue' : 'neutral' }));
  await setup(page, state);
  await expect(page.locator('#secret-bar')).toBeVisible();
  const first = page.locator('.wa-card').first();
  await expect(first).toHaveClass(/key-assassin/);
  await expect(first).toHaveAccessibleName(`${DECK[0]}, A1, Assassin`);
  await expect(first).toHaveAttribute('aria-disabled', 'true');
  await page.locator('#btn-hide-key').click();
  await expect(first).not.toHaveClass(/key-/);
  await expect(page.locator('.wa-card[class*="key-"]')).toHaveCount(0);
  await page.locator('#btn-hide-key').click();
  await expect(page.locator('.wa-card[class*="key-"]')).toHaveCount(25);

  await page.fill('#clue-input', DECK[3].slice(0, 4));
  await expect(page.locator('#clue-error')).toContainText('still on the board');
  await expect(page.locator('#btn-clue')).toBeDisabled();
  await page.fill('#clue-input', 'two words');
  await expect(page.locator('#clue-error')).toHaveText('One word, letters only.');
  await page.fill('#clue-input', 'qzxv');
  await page.locator('#count-up').click();
  await expect(page.locator('#btn-clue')).toHaveText('Send QZXV · 3');
  await page.locator('#btn-clue').click();
  expect((await frames(page)).filter((m) => m.type === 'clue')).toEqual([{ type: 'clue', word: 'QZXV', count: 3, gameId: 'round1', revision: 1 }]);
});

test('disconnects pause input, another tab offers to reconnect here, and rules close with Escape', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('.wa-card').first().click();
  await page.evaluate(() => fakeSocket.close(1006));
  await expect(page.locator('#btn-reveal')).toBeDisabled();
  await expect(page.locator('#dock-hint')).toContainText('Reconnecting');
  await expect(page.locator('#tb-conn')).toHaveClass(/offline/);
  await page.waitForFunction(() => fakeSocket.readyState === 1);
  await page.evaluate(() => fakeSocket.close(4409));
  await expect(page.locator('#overlay-reconnect')).toBeVisible();
  await expect(page.locator('#reconnect-message')).toContainText('another tab');
  await page.locator('#btn-reconnect').click();
  await expect(page.locator('#overlay-reconnect')).toBeHidden();
  await expect(page.locator('#tb-conn')).not.toHaveClass(/offline/);
  await page.getByRole('button', { name: 'How to play' }).click();
  await expect(page.locator('#modal-rules')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#modal-rules')).toBeHidden();
});

test('lobby shows team slots and readiness, and a signed-in watcher auto-joins once', async ({ page }) => {
  const lobby = initial(); lobby.game = null; lobby.you = { id: 'me', team: null, role: null, removed: false }; lobby.hostId = 'p2';
  lobby.players = lobby.players.slice(1);
  await setup(page, lobby);
  await expect(page.locator('#screen-lobby')).toHaveClass(/active/);
  expect((await frames(page)).filter((m) => m.type === 'join')).toEqual([{ type: 'join' }]);
  await expect(page.locator('#lobby-checklist li.ok')).toHaveText(['Red spymaster', 'Blue spymaster', 'Blue operative', 'Teams online']);
  await expect(page.getByRole('button', { name: 'Join red operatives' })).toBeDisabled();
  await expect(page.locator('#btn-take-seat')).toBeVisible();
  const seated = JSON.parse(JSON.stringify(lobby)); seated.revision = 2;
  seated.players.push({ id: 'me', name: 'Alex', team: null, role: null, connected: true });
  await push(page, seated);
  await expect(page.locator('#btn-take-seat')).toBeHidden();
  await page.getByRole('button', { name: 'Join red operatives' }).click();
  expect((await frames(page)).filter((m) => m.type === 'choose')).toEqual([{ type: 'choose', team: 'red', role: 'operative' }]);
  await expect(page.locator('#btn-start')).toBeHidden();
  // Removed players are told so and are not auto-joined again.
  const removed = JSON.parse(JSON.stringify(lobby)); removed.revision = 3; removed.you.removed = true;
  await push(page, removed);
  await expect(page.locator('#lobby-wait')).toContainText('removed you');
  await expect(page.locator('#btn-take-seat')).toBeHidden();
  expect((await frames(page)).filter((m) => m.type === 'join')).toHaveLength(1);
});

test('finished round opens a results dialog with the host rematch and the full key', async ({ page }) => {
  const done = initial(); done.game.phase = 'finished'; done.game.winner = 'blue'; done.game.endReason = 'assassin';
  done.game.cards = done.game.cards.map((c, i) => ({ ...c, color: i === 0 ? 'assassin' : i < 10 ? 'red' : i < 18 ? 'blue' : 'neutral', revealed: i === 0 }));
  done.game.history.push({ t: 'guess', team: 'red', index: 0, word: DECK[0], color: 'assassin' });
  await setup(page, done);
  await expect(page.locator('#modal-over')).toBeVisible();
  await expect(page.locator('#over-title')).toHaveText('● Blue team wins');
  await expect(page.locator('#over-sub')).toHaveText(`Red uncovered the assassin (${DECK[0]}).`);
  await expect(page.locator('.wa-result')).toHaveCount(2);
  await page.locator('#btn-again').click();
  expect((await frames(page)).filter((m) => m.type === 'start')).toHaveLength(1);
  await expect(page.locator('#modal-over')).toBeHidden();
  await expect(page.locator('.wa-card.missed')).toHaveCount(24);
  await expect(page.locator('.wa-card.revealed.c-assassin')).toHaveCount(1);
});

for (const width of [320, 390]) test(`original deck labels keep readable natural breaks in five columns at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 });
  await setup(page);
  expect(DECK).toEqual(expect.arrayContaining(['LIGHTHOUSE', 'STRAWBERRY', 'SUBMARINE', 'MUSHROOM']));
  let revision = 2;
  for (const role of ['operative', 'spymaster']) for (let at = 0; at < DECK.length; at += 25) {
    const batch = Array.from({ length: 25 }, (_, i) => DECK[at + i] || DECK[0]);
    const state = initial(); state.revision = revision++; state.you.role = role; state.players[0].role = role;
    state.game.phase = role === 'spymaster' ? 'clue' : 'guess';
    state.game.cards = batch.map((word) => ({ word, color: role === 'spymaster' ? 'red' : null, revealed: false }));
    await push(page, state);
    const layout = await page.locator('#board').evaluate((board) => ({
      columns: getComputedStyle(board).gridTemplateColumns.split(' ').length,
      overflow: document.documentElement.scrollWidth > innerWidth,
      labels: [...board.querySelectorAll('.wa-card')].map((card) => {
        const label = card.querySelector('.wa-word'), bounds = card.getBoundingClientRect();
        const pieces = [...label.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => {
          const range = document.createRange(); range.selectNodeContents(n); const rects = [...range.getClientRects()];
          return { text: n.textContent, lines: rects.length, fits: rects.every((r) => r.left >= bounds.left && r.right <= bounds.right) };
        });
        return { word: label.textContent, size: parseFloat(getComputedStyle(label).fontSize), weight: Number(getComputedStyle(label).fontWeight), pieces };
      }),
    }));
    expect(layout.columns).toBe(5); expect(layout.overflow).toBe(false);
    expect(layout.labels.map((l) => l.word)).toEqual(batch);
    for (const label of layout.labels) {
      expect(label.size).toBeGreaterThanOrEqual(9.9); expect(label.weight).toBeGreaterThanOrEqual(800);
      for (const piece of label.pieces) { expect(piece.text.length, label.word).toBeGreaterThanOrEqual(2); expect(piece.lines, label.word).toBe(1); expect(piece.fits, label.word).toBe(true); }
    }
  }
});
