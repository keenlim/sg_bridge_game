'use strict';
const $ = (id) => document.getElementById(id);
const codeRE = /^[A-Z0-9]{4}$/;
const points = n => n === 55 ? 7 : n % 11 === 0 ? 5 : n % 10 === 0 ? 3 : n % 5 === 0 ? 2 : 1;
const HANDSHAKE_MS = 10_000;
const HEARTBEAT_MS = 20_000;
const RESPONSE_MS = 6_000;
const RETRY_MS = [800, 1600, 3200, 6400, 10_000, 10_000];
let ws, view, selected, pending;
let reconnect, handshake, heartbeat, response, networkEpoch = 0;
let attempts = 0, blocked = false, suspended = false, awaitingState = false;
let profile = null;
const roomCode = () => location.hash.slice(1).toUpperCase();
const signedIn = () => !!profile && !!FunAuth.token();
function element(tag, text, className) {
  const el = document.createElement(tag);
  if (text != null) el.textContent = text;
  if (className) el.className = className;
  return el;
}
function button(text, action, disabled = false, cls) {
  const el = element('button', text, cls); el.type = 'button'; el.disabled = disabled;
  el.addEventListener('click', action); return el;
}
function live() { return ws?.readyState === WebSocket.OPEN && !!view; }
function send(type, extra = {}) {
  if (!live()) return false;
  $('error').textContent = '';
  const g = view.game;
  ws.send(JSON.stringify({ type, serial: g?.serial, turn: g?.turn, ...extra }));
  if (type === 'select') expectRoomState();
  return true;
}
function refreshLogin() {
  $('login').hidden = signedIn();
  $('create').disabled = !signedIn();
  if (!signedIn()) FunAuth.mountLogin($('login'), user => {
    profile = user; refreshLogin(); restart();
  }).catch(() => {});
}
function resetSocket() {
  ++networkEpoch; // Ignore every late event from the previous connection.
  clearTimeout(reconnect); clearTimeout(handshake); clearTimeout(heartbeat); clearTimeout(response);
  reconnect = handshake = heartbeat = response = undefined;
  awaitingState = false;
  const previous = ws;
  ws = null; view = null; pending = false; selected = null;
  if (previous) previous.close();
  document.dispatchEvent(new CustomEvent('sixnimmt:state', {detail:{previous:null,state:null}}));
}
function retry(code) {
  resetSocket();
  render();
  if (code === 4409 || code === 4404) {
    blocked = true;
    $('status').textContent = code === 4409 ? 'This room was opened in another tab.'
      : 'Room not found or expired. Check the code or open a new room.';
    return;
  }
  if (suspended || !codeRE.test(roomCode())) return;
  if (navigator.onLine === false) {
    $('status').textContent = 'Offline. Reconnecting when you’re back online…';
    return;
  }
  if (attempts >= RETRY_MS.length) {
    $('status').textContent = 'Could not reconnect. Check the code or try Reconnect.';
    return;
  }
  $('status').textContent = 'Disconnected. Reconnecting…';
  reconnect = setTimeout(connect, RETRY_MS[attempts++]);
}
function startHeartbeat(epoch) {
  clearTimeout(heartbeat);
  heartbeat = setTimeout(() => {
    if (epoch !== networkEpoch || !live()) return;
    if (document.visibilityState !== 'hidden' && !response) {
      ws.send('ping');
      response = setTimeout(() => { if (epoch === networkEpoch) retry(); }, RESPONSE_MS);
    }
    startHeartbeat(epoch);
  }, HEARTBEAT_MS);
}
function checkRoom() {
  if (suspended || blocked || !codeRE.test(roomCode())) return;
  if (navigator.onLine === false) return;
  if (!live()) {
    // Let an in-flight handshake complete; skip the queued delay on resume.
    if (!ws) restart();
    return;
  }
  if (!awaitingState) {
    ws.send(JSON.stringify({ type: 'sync' }));
    expectRoomState();
  }
}
function expectRoomState() {
  if (awaitingState) return;
  const epoch = networkEpoch;
  clearTimeout(response);
  awaitingState = true;
  response = setTimeout(() => { if (epoch === networkEpoch) retry(); }, RESPONSE_MS);
}
function restart() {
  blocked = false; attempts = 0;
  $('error').textContent = '';
  connect();
}
function connect() {
  resetSocket();
  const epoch = networkEpoch;
  const code = roomCode();
  $('home').hidden = codeRE.test(code) && signedIn();
  $('room').hidden = $('copy').hidden = $('exit').hidden = !codeRE.test(code);
  render();
  if (!codeRE.test(code)) {
    if (code) $('error').textContent = 'Room codes are four letters or numbers.';
    return;
  }
  if (suspended) return;
  $('room-code').textContent = code;
  if (navigator.onLine === false) {
    $('status').textContent = 'Offline. Reconnecting when you’re back online…';
    return;
  }
  $('status').textContent = attempts ? 'Reconnecting…' : 'Connecting…';
  const params = new URLSearchParams({ room: code });
  const token = FunAuth.token();
  if (token && signedIn()) params.set('token', token);
  const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/sixnimmt/ws?${params}`);
  ws = socket;
  // Opening a transport is not enough. Require an authoritative room state.
  handshake = setTimeout(() => { if (epoch === networkEpoch) retry(); }, HANDSHAKE_MS);
  socket.addEventListener('message', e => {
    if (epoch !== networkEpoch || typeof e.data !== 'string') return;
    if (e.data === 'pong') {
      if (!awaitingState) { clearTimeout(response); response = undefined; }
      return;
    }
    let msg; try { msg = JSON.parse(e.data); } catch { return; }
    if (msg.type === 'error') { $('error').textContent = msg.message; pending = false; render(); return; }
    if (msg.type !== 'state' || msg.roomCode !== code) return;
    const firstState = !view;
    const changedTurn = msg.game?.serial !== view?.game?.serial || msg.game?.turn !== view?.game?.turn;
    if (changedTurn || msg.game?.phase !== 'select') selected = null;
    if (changedTurn || msg.game?.yourPick != null || msg.game?.phase !== 'select') pending = false;
    clearTimeout(handshake);
    handshake = undefined; attempts = 0;
    if (!pending) { clearTimeout(response); response = undefined; awaitingState = false; }
    if (firstState) startHeartbeat(epoch);
    const previous = view;
    view = msg; $('status').textContent = ''; render();
    document.dispatchEvent(new CustomEvent('sixnimmt:state', {detail:{previous,state:msg}}));
  });
  socket.addEventListener('close', e => {
    if (epoch === networkEpoch) retry(e.code);
  });
}
function render() {
  const list = $('seats'), controls = $('controls'), g = view?.game;
  list.replaceChildren(); controls.replaceChildren();
  $('offline-note').hidden = true;
  $('game').hidden = !g;
  $('room').classList.toggle('playing', Boolean(g));
  $('players-title').textContent = g ? 'Scoreboard' : 'Gather your table';
  $('seated').textContent = g ? 'Lowest score wins' : `${view?.seats.length ?? 0} / 10 seated`;
  $('player-panel').hidden = !view && !codeRE.test(roomCode());
  if (!view) { if (codeRE.test(roomCode())) controls.append(button('Reconnect', restart)); return; }
  const me = view.seats.find(p => p.id === view.you), host = view.hostId === view.you;
  const name = id => view.seats.find(p => p.id === id)?.name ?? 'Player';
  for (const p of view.seats) {
    const ready = Boolean(g?.locked.includes(p.id)), own = p.id === view.you;
    const status = !p.connected ? 'Offline'
      : g?.phase === 'select' ? (ready ? 'Ready' : 'Choosing')
      : p.id === view.hostId ? 'Host' : 'Seated';
    const li = element('li', null, `six-seat${own ? ' own' : ''}${ready ? ' ready' : ''}`);
    const avatar = element('span', Array.from(p.name.trim())[0]?.toUpperCase() || '?', 'six-avatar');
    avatar.setAttribute('aria-hidden', 'true');
    const identity = element('span', null, 'six-identity');
    const label = element('strong', p.name + (own ? ' (you)' : ''));
    label.title = label.textContent;
    identity.append(label, element('small', status));
    li.append(avatar, identity);
    if (g) {
      const score = element('span', null, 'six-score');
      score.append(element('strong', String(g.scores[p.id])), element('small', `+${g.roundPoints[p.id]} round`));
      score.setAttribute('aria-label', `${g.scores[p.id]} points, ${g.roundPoints[p.id]} this round`);
      li.append(score);
    } else if (host && !p.connected) {
      li.append(button('Remove', () => send('removeOffline', { id: p.id }), false, 'btn btn-secondary'));
    }
    list.append(li);
  }
  if (!view.seats.length) list.append(element('li', 'No players seated yet.', 'six-empty'));
  if (!g) {
    if (signedIn() && !me) controls.append(button('Take a seat', () => send('join'), view.seats.length >= 10, 'btn btn-primary primary'));
    if (me) controls.append(button('Leave seat', () => send('leave')));
    if (host) controls.append(button('Deal cards', () => send('start'), view.seats.length < 2 || view.seats.some(p => !p.connected), 'btn btn-primary primary'));
    return;
  }
  const offline = view.seats.filter(p => !p.connected);
  const waiting = g.phase === 'select' ? offline.filter(p => !g.locked.includes(p.id))
    : g.phase === 'take' ? offline.filter(p => p.id === g.chooser)
    : g.phase === 'round-end' ? offline : [];
  $('offline-note').hidden = !waiting.length;
  $('offline-note').textContent = waiting.length
    ? `Waiting for ${waiting.map(p => p.name).join(', ')} to reconnect. Seats are kept; no cards are played automatically.${host ? ' To start over instead, end the match, then remove the offline seat in the lobby.' : ''}`
    : '';
  if (host && g.phase === 'round-end') controls.append(button('Deal next round', () => send('next'), !!offline.length, 'btn btn-primary primary'));
  if (host) controls.append(button(g.phase === 'finished' ? 'Back to lobby' : 'End match', () => {
    if (g.phase === 'finished' || confirm('End this match for everyone? Current scores and cards will be discarded. Players keep their seats in the lobby.')) send('lobby');
  }));
  $('round').textContent = `Round ${g.round} · Card ${g.turn} of 10`;
  $('turn-info').textContent = g.phase === 'finished' ? `Winner${g.winners.length === 1 ? '' : 's'}: ${g.winners.map(name).join(', ')}`
    : g.phase === 'round-end' ? 'Round complete. The host can deal again.'
    : g.phase === 'take' ? `${g.chooser === view.you ? 'Choose a row' : name(g.chooser) + ' is choosing a row'} to take for card ${g.revealed[0].card}.`
    : !me ? 'Watching. Players are choosing cards.' : g.yourPick ? 'Card locked. Waiting for the other players.' : 'Choose a card, then lock it in.';
  const rows = $('rows');
  rows.replaceChildren();
  g.rows.forEach((cards, i) => {
    const choose = g.phase === 'take' && g.chooser === view.you;
    const row = element('div', null, `row${choose ? ' choice' : ''}`);
    const index = element('b', i + 1, 'row-index');
    index.setAttribute('aria-label', `Row ${i + 1}`);
    row.append(index);
    for (let j=0;j<5;j++) row.append(j<cards.length ? card(cards[j]) : element('span', '·', 'slot'));
    const total = cards.reduce((n,c) => n+points(c),0);
    const take = button(`Take +${total}`, () => send('take', {row:i, card:g.revealed[0].card}), !choose, 'row-action');
    take.setAttribute('aria-label', `Take row ${i+1}, ${total} penalty points`);
    const tally = element('span', `+${total}`, 'row-total');
    tally.setAttribute('aria-label', `${total} penalty points in row ${i + 1}`);
    row.append(choose ? take : tally); rows.append(row);
  });
  $('last').textContent = [...g.history, ...g.revealed].map(m => `${name(m.id)} played ${m.card}${m.points ? ` (+${m.points})` : ''}`).join(' · ');
  $('private-hand').hidden = !me || !g.hand.length;
  const hand = $('hand');
  $('hand-size').textContent = `${g.hand.length} ${g.hand.length === 1 ? 'card' : 'cards'}`;
  const focused = document.activeElement?.dataset?.card;
  hand.replaceChildren();
  for (const num of g.hand) {
    const el = card(num, () => { selected = num; render(); document.dispatchEvent(new Event('sixnimmt:select')); }, g.phase !== 'select' || g.yourPick != null || pending);
    el.dataset.card = num;
    el.setAttribute('aria-pressed', String((g.yourPick ?? selected) === num));
    hand.append(el);
    if (focused === String(num) && !el.disabled) el.focus({preventScroll:true});
  }
  $('lock').disabled = g.phase !== 'select' || selected == null || g.yourPick != null || pending;
}
function card(n, select, disabled) {
  const out = select ? button(null, select, disabled, 'card') : element('span', null, 'card');
  out.dataset.tier = points(n);
  out.append(element('span', String(n)), element('small', '+' + points(n)));
  out.setAttribute('aria-label', `Card ${n}, ${points(n)} penalty points`);
  return out;
}
if (!window.FC_MOVED) {
  $('lock').addEventListener('click', () => { if (selected != null && send('select',{card:selected})) { pending = true; render(); } });
  $('copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(location.href); $('status').textContent = 'Invite copied.'; }
    catch { $('status').textContent = 'Copy the address from your address bar.'; }
  });
  $('join-form').addEventListener('submit', e => {
    e.preventDefault();
    const code = $('code').value.trim().toUpperCase();
    if (codeRE.test(code)) { if (roomCode() === code) restart(); else location.hash = code; }
  });
  $('create').addEventListener('click', async () => {
    $('create').disabled = true; $('error').textContent = '';
    try {
      const res = await fetch('/api/sixnimmt/create', {method:'POST', headers:{Authorization:`Bearer ${FunAuth.token()}`}, signal:AbortSignal.timeout(10000)});
      const body = await res.json();
      if (!res.ok || !codeRE.test(body.roomCode || '')) throw Error(body.error || 'Could not create a room.');
      location.hash = body.roomCode;
    } catch (e) { $('error').textContent = e.message; }
    finally { $('create').disabled = !signedIn(); }
  });
  window.addEventListener('hashchange', restart);
  window.addEventListener('online', checkRoom);
  window.addEventListener('offline', () => { if (!blocked && codeRE.test(roomCode())) retry(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkRoom(); });
  window.addEventListener('pagehide', e => {
    if (e.persisted) { suspended = true; resetSocket(); render(); }
  });
  window.addEventListener('pageshow', e => {
    if (e.persisted) { suspended = false; checkRoom(); }
  });
  FunAuth.profile().then(p => { profile = p; refreshLogin(); restart(); });
}
