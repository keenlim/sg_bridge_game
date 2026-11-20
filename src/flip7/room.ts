import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../types';
import { normalizePlayerName } from '../player-name';
import { applyMove, gameView, newGame, type Game } from './engine';

interface Session { id: string; name: string }
interface Player extends Session { connected: boolean }
interface State {
  roomCode: string;
  revision: number;
  hostId: string | null;
  players: Player[];
  removed: string[];
  game: Game | null;
}
interface Command {
  type?: unknown;
  gameId?: unknown;
  revision?: unknown;
  playerId?: unknown;
}

const MIN_PLAYERS = 3;
const MAX_PLAYERS = 12;
const EMPTY_ROOM_TTL_MS = 30 * 60_000;

function effectiveHost(state: State): string | null {
  if (state.players.some(p => p.id === state.hostId && p.connected)) return state.hostId;
  return state.players.find(p => p.connected)?.id ?? state.hostId;
}

function requireHost(host: boolean, message: string): void {
  if (!host) throw new Error(message);
}

function requireCurrent(state: State, command: Command): Game {
  if (!state.game || command.gameId !== state.game.id || command.revision !== state.revision) {
    throw new Error('The game changed. Please try again.');
  }
  return state.game;
}

/** Return false for an idempotent no-op rather than invalidating in-flight moves. */
function execute(state: State, session: Session, msg: Command): boolean {
  const player = state.players.find(p => p.id === session.id);
  const host = effectiveHost(state) === session.id;
  switch (msg.type) {
    case 'join':
      if (!/^tg_\d+$/.test(session.id)) throw new Error('Sign in with Telegram to join.');
      if (player) return false;
      if (state.removed.includes(session.id)) throw new Error('The host removed you from this room. You can still watch.');
      if (state.game) throw new Error('You can take a seat when the host returns to the lobby.');
      if (state.players.length >= MAX_PLAYERS) throw new Error(`Room is full (${MAX_PLAYERS} players).`);
      state.players.push({ ...session, connected: true });
      state.hostId ??= session.id;
      return true;
    case 'leave':
      if (!player) return false;
      if (state.game && state.game.phase !== 'finished') throw new Error('Seats are locked during a game. Close this tab and reconnect later.');
      state.players = state.players.filter(p => p.id !== session.id);
      if (state.hostId === session.id) state.hostId = state.players.find(p => p.connected)?.id ?? state.players[0]?.id ?? null;
      return true;
    case 'kick':
      requireHost(host && !state.game, 'Only the host can remove players in the lobby.');
      if (msg.playerId === session.id) throw new Error('Use Leave instead.');
      if (typeof msg.playerId !== 'string' || !state.players.some(p => p.id === msg.playerId)) return false;
      state.players = state.players.filter(p => p.id !== msg.playerId);
      if (state.hostId === msg.playerId) state.hostId = session.id;
      state.removed = [...new Set([...state.removed, msg.playerId])].slice(-50);
      return true;
    case 'start':
      requireHost(host, 'Only the host can start the game.');
      if (state.game) throw new Error('Return to the lobby before starting another game.');
      if (state.players.length < MIN_PLAYERS) throw new Error('At least three players are needed.');
      if (state.players.some(p => !p.connected)) throw new Error('Wait for everyone to reconnect or remove offline players.');
      state.game = newGame(state.players.map(p => p.id));
      return true;
    case 'hit':
    case 'stay':
    case 'target':
    case 'nextRound': {
      if (!player) throw new Error('You must be seated to play.');
      if (msg.type === 'nextRound') requireHost(host, 'Only the host can start the next round.');
      const game = requireCurrent(state, msg);
      state.game = applyMove(game, session.id, {
        type: msg.type, playerId: typeof msg.playerId === 'string' ? msg.playerId : undefined,
      });
      return true;
    }
    case 'abandon':
      requireHost(host, 'Only the host can end the current game.');
      if (requireCurrent(state, msg).phase === 'finished') throw new Error('Use Return to Lobby for a finished game.');
      state.game = null;
      return true;
    case 'lobby':
      requireHost(host, 'Only the host can return to the lobby.');
      if (!state.game) return false;
      if (state.game.phase !== 'finished') throw new Error('Finish or end the current game first.');
      state.game = null;
      return true;
    default:
      return false;
  }
}

export class Flip7Room extends DurableObject {
  private readonly sessions = new Map<WebSocket, Session>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    for (const socket of ctx.getWebSockets()) {
      const session = socket.deserializeAttachment() as Session | null;
      if (session) this.sessions.set(socket, session);
    }
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(request: Request): Promise<Response> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const url = new URL(request.url);
      const state = await this.ctx.storage.get<State>('state');
      if (url.pathname === '/create' && request.method === 'POST') {
        if (state) return new Response('Exists', { status: 409 });
        const { roomCode } = await request.json() as { roomCode?: string };
        if (typeof roomCode !== 'string' || !/^[A-Z0-9]{4}$/.test(roomCode)) {
          return new Response('Invalid room code', { status: 400 });
        }
        await this.ctx.storage.put<State>('state', { roomCode, revision: 0, hostId: null, players: [], removed: [], game: null });
        await this.ctx.storage.setAlarm(Date.now() + EMPTY_ROOM_TTL_MS);
        return Response.json({ ok: true });
      }
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Not found', { status: 404 });
      if (!state) {
        const [client, server] = Object.values(new WebSocketPair());
        server.accept();
        server.close(4404, 'Room not found');
        return new Response(null, { status: 101, webSocket: client });
      }
      // These identifiers are created by the Worker router, never trusted from an external socket URL.
      const id = url.searchParams.get('playerId');
      if (!id || !/^(?:tg_\d+|guest_[A-Za-z0-9-]{1,64})$/.test(id)) return new Response('Identity required', { status: 401 });
      const [client, server] = Object.values(new WebSocketPair());
      for (const [socket, session] of this.sessions) {
        if (session.id !== id) continue;
        this.sessions.delete(socket);
        try { socket.close(4409, 'Opened in another tab'); } catch { /* already closing */ }
      }
      const session = { id, name: normalizePlayerName(url.searchParams.get('name')) || 'Player' };
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment(session);
      this.sessions.set(server, session);
      this.syncPresence(state);
      await this.ctx.storage.deleteAlarm();
      this.broadcast(state);
      return new Response(null, { status: 101, webSocket: client });
    });
  }

  async webSocketMessage(socket: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const session = this.sessions.get(socket);
    if (!session || typeof raw !== 'string' || raw.length > 2048) return;
    if (raw === 'ping') { socket.send('pong'); return; }
    let command: Command;
    try {
      command = JSON.parse(raw);
      if (!command || typeof command !== 'object' || Array.isArray(command)) return;
    } catch { return; }
    await this.ctx.blockConcurrencyWhile(async () => {
      if (this.sessions.get(socket) !== session) return;
      const state = await this.ctx.storage.get<State>('state');
      if (!state) return;
      this.syncPresence(state);
      if (command.type === 'sync') { this.send(socket, state, session.id); return; }
      try {
        const next = structuredClone(state);
        if (!execute(next, session, command)) return;
        next.revision++;
        await this.ctx.storage.put('state', next);
        this.broadcast(next);
      } catch (error) {
        try { socket.send(JSON.stringify({ type: 'error', message: error instanceof Error ? error.message : 'Action failed.' })); } catch { /* socket closing */ }
        this.send(socket, state, session.id);
      }
    });
  }

  private syncPresence(state: State): void {
    const live = new Set([...this.sessions.values()].map(s => s.id));
    for (const player of state.players) player.connected = live.has(player.id);
  }

  private playerView(state: State, id: string) {
    const seated = new Set(state.players.map(p => p.id));
    const watchers = new Set([...this.sessions.values()].filter(s => !seated.has(s.id)).map(s => s.id)).size;
    return {
      type: 'state', roomCode: state.roomCode, revision: state.revision, hostId: effectiveHost(state),
      players: state.players, watchers, minPlayers: MIN_PLAYERS, maxPlayers: MAX_PLAYERS,
      you: { id, removed: !seated.has(id) && state.removed.includes(id) },
      game: state.game ? gameView(state.game) : null,
    };
  }

  private send(socket: WebSocket, state: State, id: string): void {
    try { socket.send(JSON.stringify(this.playerView(state, id))); } catch { /* socket closing */ }
  }

  private broadcast(state: State): void {
    for (const [socket, session] of this.sessions) this.send(socket, state, session.id);
  }

  async webSocketClose(socket: WebSocket): Promise<void> { await this.disconnect(socket); }
  async webSocketError(socket: WebSocket): Promise<void> { await this.disconnect(socket); }

  private async disconnect(socket: WebSocket): Promise<void> {
    if (!this.sessions.delete(socket)) return;
    await this.ctx.blockConcurrencyWhile(async () => {
      const state = await this.ctx.storage.get<State>('state');
      if (!state) return;
      this.syncPresence(state);
      this.broadcast(state);
      if (!this.sessions.size) await this.ctx.storage.setAlarm(Date.now() + EMPTY_ROOM_TTL_MS);
    });
  }

  async alarm(): Promise<void> {
    await this.ctx.blockConcurrencyWhile(async () => {
      if (!this.ctx.getWebSockets().length) await this.ctx.storage.deleteAll();
    });
  }
}
