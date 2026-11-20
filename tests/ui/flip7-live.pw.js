// The same scenario exercises real HTTP/WS through two transports: a native
// Node client and separate browser contexts. Neither mocks the local Worker.
const { test, expect } = require('@playwright/test');
const { startWorker } = require('./live-worker.cjs');

let worker;
test.beforeAll(async () => { worker = await startWorker(4257); });
test.afterAll(async () => { await worker?.stop(); });

function transportUrl(roomCode, token) {
  const url = new URL('/api/flip7/ws', worker.origin);
  url.protocol = 'ws:';
  url.searchParams.set('room', roomCode);
  if (token) url.searchParams.set('token', token);
  return url.href;
}

function wire(socket) {
  const connection = { socket, state: null, error: null };
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.type === 'state') connection.state = message;
    if (message.type === 'error') connection.error = message.message;
  });
  return connection;
}

function liveNodeClient(token) {
  let connection;
  return {
    connect: (roomCode) => { connection = wire(new WebSocket(transportUrl(roomCode, token))); },
    state: () => connection?.state,
    error: () => connection?.error,
    send: (command) => connection.socket.send(JSON.stringify(command)),
    disconnect: () => connection?.socket.close(),
    dispose: () => connection?.socket.close(),
  };
}

async function liveBrowserClient(browser, token) {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    // Load a real local document so Chromium knows the address space for
    // this page. A fulfilled route has no remote address and may block WS.
    await page.route('**/*', (route) => new URL(route.request().url()).origin === worker.origin ? route.continue() : route.abort());
    await page.goto(worker.origin);
  } catch (error) {
    await context.close();
    throw error;
  }
  return {
    connect: async (roomCode) => {
      await page.evaluate((url) => {
        const socket = new WebSocket(url);
        const connection = { socket, state: null, error: null };
        window.flip7TestConnection = connection;
        socket.addEventListener('message', (event) => {
          const message = JSON.parse(event.data);
          if (message.type === 'state') connection.state = message;
          if (message.type === 'error') connection.error = message.message;
        });
      }, transportUrl(roomCode, token));
    },
    state: () => page.evaluate(() => window.flip7TestConnection?.state ?? null),
    error: () => page.evaluate(() => window.flip7TestConnection?.error ?? null),
    send: (command) => page.evaluate((msg) => window.flip7TestConnection.socket.send(JSON.stringify(msg)), command),
    disconnect: () => page.reload(),
    dispose: () => context.close(),
  };
}

async function runMultiplayer(createClient) {
  const post = (path, options = {}) => fetch(worker.origin + path, { method: 'POST', ...options });
  expect((await post('/api/flip7/create')).status).toBe(401);
  const clients = [];
  async function connect(client, roomCode) {
    await client.connect(roomCode);
    await expect.poll(async () => Boolean(await client.state())).toBe(true);
  }
  async function move(client, type, extra = {}) {
    const { game, revision } = await client.state();
    await client.send({ type, gameId: game?.id, revision, ...extra });
  }
  try {
    const names = ['Alice Flip', 'Bob Flip', 'Cara Flip'];
    const tokens = await Promise.all(names.map(async (displayName) => {
      const res = await post('/api/auth/dev', { body: JSON.stringify({ displayName }) });
      expect(res.ok).toBe(true);
      const { token } = await res.json();
      expect(token).toBeTruthy();
      return token;
    }));
    for (const token of [...tokens, null]) clients.push(await createClient(token));
    const [alice, bob, cara, watcher] = clients;
    const joined = [alice, bob, cara];

    const created = await post('/api/flip7/create', { headers: { Authorization: `Bearer ${tokens[0]}` } });
    expect(created.ok).toBe(true);
    const { roomCode } = await created.json();
    expect(roomCode).toMatch(/^[A-Z0-9]{4}$/);

    for (const [index, client] of joined.entries()) {
      await connect(client, roomCode);
      await move(client, 'join');
      await expect.poll(async () => (await alice.state()).players.length).toBe(index + 1);
    }
    await connect(watcher, roomCode);
    await expect.poll(async () => (await alice.state()).watchers).toBe(1);
    await move(watcher, 'join');
    await expect.poll(() => watcher.error()).toMatch(/sign in/i);
    const lobby = await alice.state();
    expect(lobby.players.map(({ name }) => name)).toEqual(names);
    expect(lobby.hostId).toBe(lobby.you.id);

    const byId = new Map(await Promise.all(joined.map(async (client) => [(await client.state()).you.id, client])));
    await move(alice, 'start');
    await expect.poll(async () => (await watcher.state())?.game?.round).toBe(1);

    // A shuffled opening deal can leave the active player with only a resolved
    // action card. Follow the legal choice/Hit path until someone can actually Stay.
    const canStay = (game) => {
      const active = game.players.find((player) => player.id === game.turnId);
      return active && (active.numbers.length || active.bonuses.length || active.doubled || active.secondChance);
    };
    for (let steps = 0; steps < 30; ++steps) {
      const observed = await watcher.state();
      const game = observed.game;
      const choice = game.pending;
      if (!choice && game.phase === 'playing' && canStay(game)) break;
      const client = choice ? byId.get(choice.actorId) : game.phase === 'playing' ? byId.get(game.turnId) : alice;
      expect(client).toBeDefined();
      await expect.poll(async () => (await client.state()).revision).toBe(observed.revision);
      if (choice) await move(client, 'target', { playerId: choice.targets[0] });
      else if (game.phase === 'playing') await move(client, 'hit');
      else {
        expect(game.phase).toBe('roundEnd');
        await move(client, 'nextRound');
      }
      await expect.poll(async () => (await watcher.state()).revision).toBeGreaterThan(observed.revision);
    }

    const before = await watcher.state();
    expect(before.game.phase).toBe('playing');
    expect(before.game.pending).toBeNull();
    expect(canStay(before.game)).toBeTruthy();
    expect(before.game).not.toHaveProperty('deck');
    expect(before.game).not.toHaveProperty('discard');
    expect(before.game.deckCount).toBeGreaterThan(0);
    expect(before.players).toHaveLength(3);
    const activeId = before.game.turnId;
    const active = byId.get(activeId);
    expect(active).toBeDefined();
    await expect.poll(async () => (await active.state()).revision).toBe(before.revision);
    await move(active, 'stay');
    await expect.poll(async () => (await watcher.state()).game.players.find((p) => p.id === activeId).status).toBe('stayed');

    const after = await watcher.state();
    expect(after.game.turnId).not.toBe(activeId);
    await active.disconnect();
    await connect(active, roomCode);
    const reloaded = await active.state();
    expect(reloaded.you.id).toBe(activeId);
    expect(reloaded.game).toEqual(after.game);
    expect(reloaded.players).toHaveLength(3);
  } finally {
    await Promise.all(clients.map((client) => client.dispose()));
  }
}

test('local Worker: auth, three seats, banking, watching and reconnect over Node WebSockets', async () => {
  test.setTimeout(60000);
  await runMultiplayer(liveNodeClient);
});

test('local Worker: browser WebSockets stay synchronized and a seat survives page reload', async ({ browser }) => {
  test.setTimeout(60000);
  await runMultiplayer((token) => liveBrowserClient(browser, token));
});
