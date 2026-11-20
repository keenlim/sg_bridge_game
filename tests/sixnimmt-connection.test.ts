// Isolate the connection state machine from the browser's real timing. The
// companion Playwright suite still exercises the real Worker and WebSockets.
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const code = readFileSync(new URL('../static/sixnimmt/game.js', import.meta.url), 'utf8');
type Listener = (e: any) => void;

async function runClient({ online = true, moved = false } = {}) {
  const windowEvents = new Map<string, Listener>();
  const documentEvents = new Map<string, Listener>();
  function node() {
    return {
      textContent: '',
      append() {},
      replaceChildren() {},
      addEventListener() {},
      setAttribute() {},
      classList: { toggle() {} },
    };
  }
  const nodes = new Map<string, ReturnType<typeof node>>();
  const sockets: MockSocket[] = [];
  const navigator = { onLine: online };
  const document = {
    visibilityState: 'visible',
    getElementById(id: string) {
      if (!nodes.has(id)) nodes.set(id, node());
      return nodes.get(id)!;
    },
    createElement: node,
    addEventListener: (type: string, fn: Listener) => documentEvents.set(type, fn),
    dispatchEvent() {},
  };
  class MockSocket {
    static OPEN = 1;
    readyState = 1;
    callbacks = new Map<string, Listener>();
    sent: string[] = [];
    constructor() { sockets.push(this); }
    addEventListener(type: string, fn: Listener) { this.callbacks.set(type, fn); }
    send(data: string) { this.sent.push(data); }
    close(code = 1006) { this.readyState = 3; this.callbacks.get('close')?.({ code }); }
    message(data: string) { this.callbacks.get('message')?.({ data }); }
    state() { this.message(JSON.stringify({ type: 'state', roomCode: 'ABCD', you: 'guest', seats: [], game: null })); }
  }
  const profile = vi.fn(async () => null);
  runInNewContext(code, {
    document, navigator, URLSearchParams, setTimeout, clearTimeout,
    location: { hash: '#ABCD', protocol: 'https:', host: 'example.test' },
    window: { FC_MOVED: moved, addEventListener: (type: string, fn: Listener) => windowEvents.set(type, fn) },
    WebSocket: MockSocket, CustomEvent: class {},
    FunAuth: { token: () => null, profile, mountLogin: async () => {} },
  });
  await Promise.resolve();
  const status = () => nodes.get('status')?.textContent;
  return { sockets, latest: () => sockets.at(-1)!, navigator, document, windowEvents, documentEvents, status, profile };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('retries after a failed first reconnection and times out a silent handshake', async () => {
  const c = await runClient();
  c.latest().state();
  c.latest().close();
  vi.advanceTimersByTime(800);
  expect(c.sockets).toHaveLength(2);
  c.latest().close();
  vi.advanceTimersByTime(1600);
  expect(c.sockets).toHaveLength(3);
  vi.advanceTimersByTime(10_000 + 3200);
  expect(c.sockets).toHaveLength(4);
  c.latest().state();
  expect(c.status()).toBe('');
});

it('resyncs on foreground, ignores a delayed pong, and recovers from a silent sync', async () => {
  const c = await runClient();
  c.latest().state();
  vi.advanceTimersByTime(20_000);
  expect(c.latest().sent).toEqual(['ping']);
  c.documentEvents.get('visibilitychange')?.({});
  expect(c.latest().sent).toEqual(['ping', '{"type":"sync"}']);
  c.latest().message('pong');
  vi.advanceTimersByTime(6000 + 800);
  expect(c.sockets).toHaveLength(2);
  c.latest().state();
  c.documentEvents.get('visibilitychange')?.({});
  c.latest().state();
  vi.advanceTimersByTime(6000);
  expect(c.sockets).toHaveLength(2);
});

it('waits while offline and restores the socket after a history-cache resume', async () => {
  const c = await runClient({ online: false });
  expect(c.status()).toContain('Offline');
  expect(c.sockets).toHaveLength(0);
  c.navigator.onLine = true;
  c.windowEvents.get('online')?.({});
  c.latest().state();
  c.windowEvents.get('pagehide')?.({ persisted: true });
  vi.advanceTimersByTime(50_000);
  expect(c.sockets).toHaveLength(1);
  expect(c.latest().readyState).toBe(3);
  c.windowEvents.get('pageshow')?.({ persisted: true });
  expect(c.sockets).toHaveLength(2);
  c.latest().state();
});

it.each([[4409, 'another tab'], [4404, 'Room not found']] as const)('does not auto-retry terminal close %i', async (closeCode, message) => {
  const c = await runClient();
  c.latest().close(closeCode);
  c.windowEvents.get('online')?.({});
  c.documentEvents.get('visibilitychange')?.({});
  vi.advanceTimersByTime(50_000);
  expect(c.sockets).toHaveLength(1);
  expect(c.status()).toContain(message);
});

it('does not initialize auth or networking on the old hostname redirect', async () => {
  const c = await runClient({ moved: true });
  expect(c.profile).not.toHaveBeenCalled();
  expect(c.sockets).toHaveLength(0);
  expect(c.windowEvents.size).toBe(0);
});

it('stops after six failures until a fresh online signal', async () => {
  const c = await runClient();
  for (const delay of [800, 1600, 3200, 6400, 10_000, 10_000]) {
    c.latest().close();
    vi.advanceTimersByTime(delay);
  }
  c.latest().close();
  vi.advanceTimersByTime(60_000);
  expect(c.status()).toContain('Could not reconnect');
  expect(c.sockets).toHaveLength(7);
  c.windowEvents.get('online')?.({});
  expect(c.sockets).toHaveLength(8);
});
