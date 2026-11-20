'use strict';
const $ = (id) => document.getElementById(id);
const codeRE = /^[A-Z0-9]{4}$/;
const points = n => n === 55 ? 7 : n % 11 === 0 ? 5 : n % 10 === 0 ? 3 : n % 5 === 0 ? 2 : 1;
let ws, view, selected, pending, reconnect, networkEpoch = 0;
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
  return true;
}
function refreshLogin() {
  $('login').hidden = signedIn();
  $('create').disabled = !signedIn();
  if (!signedIn()) FunAuth.mountLogin($('login'), user => {
    profile = user; refreshLogin(); connect(true);
  }).catch(() => {});
}
function connect(force = false) {
  const epoch = ++networkEpoch;
  clearTimeout(reconnect);
  if (ws) ws.close();
  ws = null; view = null; pending = false; selected = null;
  document.dispatchEvent(new CustomEvent('sixnimmt:state', {detail:{previous:null,state:null}}));
  const code = roomCode();
  $('error').textContent = '';
  $('home').hidden = codeRE.test(code) && signedIn();
  $('room').hidden = $('copy').hidden = $('exit').hidden = !codeRE.test(code);
  render();
  if (!codeRE.test(code)) {
    if (code) $('error').textContent = 'Room codes are four letters or numbers.';
    return;
  }
  $('room-code').textContent = code;
  $('status').textContent = 'Connecting…';
  const params = new URLSearchParams({ room: code });
  const token = FunAuth.token();
  if (token && signedIn()) params.set('token', token);
  const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/sixnimmt/ws?${params}`);
  ws = socket;
  socket.addEventListener('message', e => {
    if (epoch !== networkEpoch || typeof e.data !== 'string' || e.data === 'pong') return;
    let msg; try { msg = JSON.parse(e.data); } catch { return; }
    if (msg.type === 'error') { $('error').textContent = msg.message; pending = false; render(); return; }
    if (msg.type !== 'state') return;
    if (msg.game?.serial !== view?.game?.serial || msg.game?.turn !== view?.game?.turn || msg.game?.phase !== 'select') selected = null;
    if (msg.game?.yourPick != null || msg.game?.serial !== view?.game?.serial || msg.game?.turn !== view?.game?.turn) pending = false;
    const previous = view;
    view = msg; $('status').textContent = ''; render();
    document.dispatchEvent(new CustomEvent('sixnimmt:state', {detail:{previous,state:msg}}));
  });
  socket.addEventListener('close', e => {
    if (epoch !== networkEpoch) return;
    const hadState = !!view;
    view = null; pending = false; render();
    if (e.code === 4409) { $('status').textContent = 'This room was opened in another tab.'; return; }
    if (!hadState && !force) { $('status').textContent = 'Could not open this room. Check the code or reconnect.'; return; }
    $('status').textContent = 'Disconnected. Reconnecting…';
    reconnect = setTimeout(() => connect(), 1200);
  });
}
function render() {
  const list = $('seats'), controls = $('controls'), g = view?.game;
  list.replaceChildren(); controls.replaceChildren();
  $('game').hidden = !g;
  $('room').classList.toggle('playing', Boolean(g));
  $('players-title').textContent = g ? 'Scoreboard' : 'Gather your table';
  $('seated').textContent = g ? 'Lowest score wins' : `${view?.seats.length ?? 0} / 10 seated`;
  $('player-panel').hidden = !view && !codeRE.test(roomCode());
  if (!view) { if (codeRE.test(roomCode())) controls.append(button('Reconnect', () => connect())); return; }
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
  if (host && g.phase === 'round-end') controls.append(button('Deal next round', () => send('next'), view.seats.some(p => !p.connected), 'btn btn-primary primary'));
  if (host) controls.append(button('Back to lobby', () => {
    if (g.phase === 'finished' || confirm('End this match and return everyone to the lobby?')) send('lobby');
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
$('lock').addEventListener('click', () => { if (selected != null && send('select',{card:selected})) { pending = true; render(); } });
$('copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(location.href); $('status').textContent = 'Invite copied.'; }
  catch { $('status').textContent = 'Copy the address from your address bar.'; }
});
$('join-form').addEventListener('submit', e => {
  e.preventDefault();
  const code = $('code').value.trim().toUpperCase();
  if (codeRE.test(code)) { if (roomCode() === code) connect(); else location.hash = code; }
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
window.addEventListener('hashchange', () => connect());
FunAuth.profile().then(p => { profile = p; refreshLogin(); connect(); });
