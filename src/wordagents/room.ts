import { DurableObject } from 'cloudflare:workers';
import type { Env } from "../types";
import { normalizePlayerName } from '../player-name';
import { newGame, giveClue, guess, endTurn, gameView, type Game, type Team } from './engine';
interface Player { id: string; name: string; team: Team | null; role: 'spymaster' | 'operative' | null; connected: boolean }
interface State { roomCode: string; revision: number; hostId: string | null; players: Player[]; game: Game | null }
interface Session { id: string; name: string }
export class WordAgentsRoom extends DurableObject {
  private sessions = new Map<WebSocket, Session>();
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    for (const ws of ctx.getWebSockets()) { const s = ws.deserializeAttachment() as Session; if (s) this.sessions.set(ws, s); }
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }
  async fetch(request: Request): Promise<Response> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const url = new URL(request.url);
      let state = await this.ctx.storage.get<State>('state');
      if (url.pathname === '/create' && request.method === 'POST') {
        if (state) return new Response('Exists', {status: 409});
        const {roomCode} = await request.json() as {roomCode: string};
        state = {roomCode, revision: 0, hostId: null, players: [], game: null};
        await this.ctx.storage.put('state', state); await this.ctx.storage.setAlarm(Date.now() + 30 * 60_000);
        return Response.json({ok: true});
      }
      if (!state) {
        if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Room not found', {status: 404});
        const [client, server] = Object.values(new WebSocketPair());
        server.accept(); server.close(4404, 'Room not found');
        return new Response(null, {status: 101, webSocket: client});
      }
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Not found', {status: 404});
      const id = url.searchParams.get('playerId');
      if (!id) return new Response('Identity required', {status: 401});
      const [client, server] = Object.values(new WebSocketPair());
      for (const [ws, session] of this.sessions) if (session.id === id) { this.sessions.delete(ws); try { ws.close(4409, 'Opened in another tab'); } catch {} }
      const session = {id, name: normalizePlayerName(url.searchParams.get('name')) || 'Player'};
      this.ctx.acceptWebSocket(server); server.serializeAttachment(session); this.sessions.set(server, session);
      const player = state.players.find(p => p.id === id);
      if (player) {
        player.connected = true;
        if (!state.players.some(p => p.id === state.hostId && p.connected)) state.hostId = player.id;
      }
      await this.ctx.storage.deleteAlarm(); await this.ctx.storage.put('state', state); this.broadcast(state);
      return new Response(null, {status: 101, webSocket: client});
    });
  }
  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const session = this.sessions.get(ws); if (!session || typeof raw !== 'string' || raw.length > 2048) return;
    if (raw === 'ping') { ws.send('pong'); return; }
    let msg: Record<string, unknown>;
    try { msg = JSON.parse(raw); if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return; } catch { return; }
    await this.ctx.blockConcurrencyWhile(async () => {
      // A replaced socket must not regain authority while queued.
      if (this.sessions.get(ws) !== session) return;
      const state = await this.ctx.storage.get<State>('state'); if (!state) return;
      if (msg.type === 'sync') { this.send(ws, state, session.id); return; }
      const player = state.players.find(p => p.id === session.id);
      try {
        const active = state.game && state.game.phase !== 'finished';
        switch (msg.type) {
          case 'join':
            if (!/^tg_\d+$/.test(session.id)) throw new Error('Sign in with Telegram to join.');
            if (player) break;
            if (active) throw new Error('This round is underway. Watch until the next lobby.');
            if (state.players.length >= 12) throw new Error('Room is full (12 players).');
            state.players.push({id: session.id, name: session.name, team: null, role: null, connected: true});
            state.hostId ??= session.id; break;
          case 'choose':
            if (!player) throw new Error('Join the room first.');
            if (state.game) throw new Error('Return to the lobby before changing roles.');
            if ((msg.team !== 'red' && msg.team !== 'blue') || (msg.role !== 'spymaster' && msg.role !== 'operative')) throw new Error('Choose a team and role.');
            if (msg.role === 'spymaster' && state.players.some(p => p.id !== player.id && p.team === msg.team && p.role === 'spymaster')) throw new Error('That team already has a spymaster.');
            player.team = msg.team; player.role = msg.role; break;
          case 'start':
            if (state.hostId !== session.id) throw new Error('Only the host can start.');
            if (state.game) throw new Error('Return to the lobby first.');
            for (const team of ['red', 'blue']) for (const role of ['spymaster', 'operative']) {
              if (!state.players.some(p => p.team === team && p.role === role && p.connected)) throw new Error('Each team needs a connected spymaster and operative.');
            }
            if (state.players.some(p => !p.team || !p.role || !p.connected)) throw new Error('Everyone must be connected and choose a role, or leave the lobby.');
            state.game = newGame(); break;
          case 'clue': case 'guess': case 'endTurn': {
            const game = state.game;
            if (!game || msg.gameId !== game.id || msg.revision !== state.revision) throw new Error('The board changed. Please try again.');
            if (!player || player.team !== game.turn) throw new Error('It is not your team’s turn.');
            if (msg.type === 'clue') { if (player.role !== 'spymaster') throw new Error('Only the spymaster gives clues.'); giveClue(game, msg.word, msg.count); }
            else { if (player.role !== 'operative') throw new Error('Only operatives can guess or end the turn.'); if (msg.type === 'guess') guess(game, msg.index); else endTurn(game); }
            break;
          }
          case 'lobby':
            if (state.hostId !== session.id) throw new Error('Only the host can return to the lobby.');
            if (active) throw new Error('Finish the round first.');
            state.game = null; break;
          case 'leave':
            if (active) throw new Error('Roles are locked until the round ends. You can close this tab and reconnect later.');
            state.players = state.players.filter(p => p.id !== session.id);
            if (state.hostId === session.id) state.hostId = state.players.find(p => p.connected)?.id ?? state.players[0]?.id ?? null;
            break;
          case 'kick':
            if (state.hostId !== session.id || state.game) throw new Error('Only the host can remove players in the lobby.');
            if (msg.playerId === session.id) throw new Error('Use leave instead.');
            state.players = state.players.filter(p => p.id !== msg.playerId); break;
          default: return;
        }
        state.revision++; await this.ctx.storage.put('state', state); this.broadcast(state);
      } catch (error) { ws.send(JSON.stringify({type: 'error', message: error instanceof Error ? error.message : 'Action failed.'})); this.send(ws, state, session.id); }
    });
  }
  private send(ws: WebSocket, state: State, id: string) {
    const player = state.players.find(p => p.id === id);
    try { ws.send(JSON.stringify({type: 'state', roomCode: state.roomCode, revision: state.revision, hostId: state.hostId, players: state.players, you: {id, team: player?.team ?? null, role: player?.role ?? null}, game: state.game ? gameView(state.game, player?.role === 'spymaster') : null})); } catch {}
  }
  private broadcast(state: State) { for (const [ws, s] of this.sessions) this.send(ws, state, s.id); }
  async webSocketClose(ws: WebSocket): Promise<void> { await this.disconnect(ws); }
  async webSocketError(ws: WebSocket): Promise<void> { await this.disconnect(ws); }
  private async disconnect(ws: WebSocket) {
    const session = this.sessions.get(ws); if (!session) return; this.sessions.delete(ws);
    await this.ctx.blockConcurrencyWhile(async () => {
      const state = await this.ctx.storage.get<State>('state'); if (!state) return;
      const player = state.players.find(p => p.id === session.id);
      if (player && ![...this.sessions.values()].some(s => s.id === session.id)) player.connected = false;
      if (state.hostId === session.id) state.hostId = state.players.find(p => p.connected)?.id ?? state.hostId;
      await this.ctx.storage.put('state', state); this.broadcast(state);
      if (!this.sessions.size) await this.ctx.storage.setAlarm(Date.now() + 30 * 60_000);
    });
  }
  async alarm() { if (!this.ctx.getWebSockets().length) await this.ctx.storage.deleteAll(); }
}
