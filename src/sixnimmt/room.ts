import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../types';
import { normalizePlayerName } from '../player-name';
import { deal, lockCard, takeRow, publicView, MIN_PLAYERS, MAX_PLAYERS, type Game } from './engine';

type Seat = { id: string; name: string };
type State = { roomCode: string; seats: Seat[]; hostId: string | null; serial: number; game: Game | null };
const TTL = 30 * 60_000;
const isMember = (id: string) => /^tg_\d+$/.test(id);

export class SixNimmtRoom extends DurableObject {
  private sessions = new Map<WebSocket, Seat>();
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    for (const socket of ctx.getWebSockets()) {
      const seat = socket.deserializeAttachment() as Seat | undefined;
      if (seat) this.sessions.set(socket, seat);
    }
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }
  private live() { return new Set([...this.sessions.values()].map(seat => seat.id)); }
  private host(state: State) {
    const live = this.live();
    return state.hostId && live.has(state.hostId) ? state.hostId : state.seats.find(p => live.has(p.id))?.id ?? state.hostId;
  }
  private send(ws: WebSocket, payload: object) {
    try { ws.send(JSON.stringify(payload)); } catch { /* socket closed */ }
  }
  private view(ws: WebSocket, state: State, id: string) {
    const live = this.live();
    this.send(ws, { type: 'state', you: id, hostId: this.host(state), roomCode: state.roomCode,
      seats: state.seats.map(p => ({ ...p, connected: live.has(p.id) })),
      game: state.game && publicView(state.game, id),
    });
  }
  private broadcast(state: State) {
    for (const [ws, seat] of this.sessions) this.view(ws, state, seat.id);
  }
  async fetch(request: Request): Promise<Response> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const url = new URL(request.url);
      const state = await this.ctx.storage.get<State>('state');
      if (url.pathname === '/create' && request.method === 'POST') {
        if (state) return new Response('Room exists', { status: 409 });
        const { roomCode } = await request.json() as { roomCode: string };
        await this.ctx.storage.put('state', { roomCode, seats: [], hostId: null, serial: 0, game: null } satisfies State);
        await this.ctx.storage.setAlarm(Date.now() + TTL);
        return Response.json({ ok: true });
      }
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Room not found', { status: 404 });
      if (!state) {
        const [client, server] = Object.values(new WebSocketPair());
        server.accept();
        server.close(4404, 'Room not found or expired');
        return new Response(null, { status: 101, webSocket: client });
      }
      const id = url.searchParams.get('playerId');
      if (!id) return new Response('Identity required', { status: 401 });
      const seat = { id, name: normalizePlayerName(url.searchParams.get('name')) || 'Player' };
      const [client, server] = Object.values(new WebSocketPair());
      for (const [ws, old] of this.sessions) {
        if (old.id !== id) continue;
        this.sessions.delete(ws);
        try { ws.close(4409, 'Opened in another tab'); } catch { /* socket closed */ }
      }
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment(seat);
      this.sessions.set(server, seat);
      await this.ctx.storage.deleteAlarm();
      this.broadcast(state);
      return new Response(null, { status: 101, webSocket: client });
    });
  }
  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    const seat = this.sessions.get(ws);
    if (!seat || typeof raw !== 'string' || raw.length > 1024) return;
    let msg: Record<string, unknown>;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return;
    await this.ctx.blockConcurrencyWhile(async () => {
      if (this.sessions.get(ws) !== seat) return;
      const state = await this.ctx.storage.get<State>('state');
      if (!state) return;
      if (msg.type === 'sync') { this.view(ws, state, seat.id); return; }
      const player = state.seats.find(p => p.id === seat.id);
      const host = player && this.host(state) === seat.id;
      const game = state.game;
      try {
        switch (msg.type) {
          case 'join':
            if (!isMember(seat.id)) throw Error('Sign in with Telegram to take a seat.');
            if (player) return;
            if (game || state.seats.length >= MAX_PLAYERS) throw Error('No seats are available right now.');
            state.seats.push(seat);
            state.hostId ??= seat.id;
            break;
          case 'leave':
            if (!player || game) throw Error('You can leave your seat in the lobby.');
            state.seats = state.seats.filter(p => p.id !== seat.id);
            if (state.hostId === seat.id) state.hostId = state.seats[0]?.id ?? null;
            break;
          case 'removeOffline':
            if (!host || game || typeof msg.id !== 'string' || this.live().has(msg.id)) throw Error('The host can remove offline players in the lobby.');
            state.seats = state.seats.filter(p => p.id !== msg.id);
            if (state.hostId === msg.id) state.hostId = seat.id;
            break;
          case 'start':
          case 'next':
            if (!host) throw Error('Only the host can deal.');
            if (msg.type === 'start' ? Boolean(game) : game?.phase !== 'round-end' || game.serial !== msg.serial)
              throw Error('This round cannot be started.');
            if (state.seats.length < MIN_PLAYERS || state.seats.some(p => !this.live().has(p.id))) throw Error('At least two players must be seated and everyone must be connected.');
            state.game = deal(state.seats.map(p => p.id), state.serial + 1, game ?? undefined);
            state.serial++;
            break;
          case 'select':
          case 'take':
            if (!player || !game || msg.serial !== game.serial || msg.turn !== game.turn) throw Error('The turn changed. Please try again.');
            if (msg.type === 'select') lockCard(game, seat.id, msg.card);
            else {
              if (msg.card !== game.queue[0]?.card) throw Error('The card changed. Please try again.');
              takeRow(game, seat.id, msg.row);
            }
            break;
          case 'lobby':
            if (!host || !game || msg.serial !== game.serial) throw Error('Only the host can return this match to the lobby.');
            state.game = null;
            break;
          default: return;
        }
        await this.ctx.storage.put('state', state);
        this.broadcast(state);
      } catch (error) {
        this.send(ws, { type: 'error', message: error instanceof Error ? error.message : 'Action failed.' });
        const saved = await this.ctx.storage.get<State>('state');
        if (saved) this.view(ws, saved, seat.id);
      }
    });
  }
  async webSocketClose(ws: WebSocket) { await this.disconnect(ws); }
  async webSocketError(ws: WebSocket) { await this.disconnect(ws); }
  private async disconnect(ws: WebSocket) {
    await this.ctx.blockConcurrencyWhile(async () => {
      if (!this.sessions.delete(ws)) return;
      const state = await this.ctx.storage.get<State>('state');
      if (state) this.broadcast(state);
      if (!this.sessions.size) await this.ctx.storage.setAlarm(Date.now() + TTL);
    });
  }
  async alarm() {
    await this.ctx.blockConcurrencyWhile(async () => {
      if (!this.sessions.size) await this.ctx.storage.deleteAll();
    });
  }
}
