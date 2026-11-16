'use strict';
(() => {
  if (window.FC_MOVED) return;
  const $ = id => document.getElementById(id);
  const node = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const teamName = team => team === 'red' ? 'Red' : 'Blue';
  const roles = { spymaster: 'Spymaster', operative: 'Operative' };
  // Optional reading breaks for the original deck. They add no characters and
  // wrap only when a narrow card needs them; rules and accessible names keep
  // the complete word. Avoid arbitrary orphan-letter breaks on phone boards.
  const wordBreaks = Object.fromEntries([
    'BAL|CONY', 'BOUL|DER', 'CHIM|NEY', 'COM|PASS', 'DIA|MOND',
    'EN|VE|LOPE', 'FOUN|TAIN', 'HAM|MER', 'HO|RI|ZON', 'LAN|TERN',
    'LIGHT|HOUSE', 'MEA|DOW', 'MOUN|TAIN', 'MUSH|ROOM', 'NOTE|BOOK',
    'PUMP|KIN', 'RAIN|BOW', 'SAT|EL|LITE', 'SHAD|OW', 'SPAR|ROW',
    'STRAW|BERRY', 'SUB|MARINE', 'THUN|DER', 'TRI|ANGLE', 'TRUM|PET',
    'UM|BRELLA', 'VOL|CANO', 'WATER|FALL', 'WIN|DOW',
  ].map(parts => [parts.replaceAll('|', ''), parts.split('|')]));
  let profile = null, socket = null, view = null, room = '', retryTimer = 0, retryDelay = 800, heartbeat = 0, pendingTimer = 0;
  let pending = false, generation = 0, lastMessage = 0, fatal = false, selection = null, joined = false, ready = false, leaving = false;
  const connected = () => ready && socket?.readyState === WebSocket.OPEN;
  const error = message => { $('error').textContent = message || ''; };
  const readRoom = () => /^[A-Za-z0-9]{4}$/.test(location.hash.slice(1)) ? location.hash.slice(1).toUpperCase() : '';
  const canGuess = () => connected() && !pending && view?.game?.phase === 'guess' && view.you?.role === 'operative' && view.you.team === view.game.turn;
  function closeGuess() { selection = null; if ($('confirm').open) $('confirm').close('cancel'); }
  function clearPending() { pending = false; clearTimeout(pendingTimer); }
  function send(type, data = {}) {
    if (!connected() || pending) return;
    error(''); closeGuess(); pending = true;
    socket.send(JSON.stringify({ type, ...data, ...(view?.game ? { gameId: view.game.id, revision: view.revision } : {}) }));
    pendingTimer = setTimeout(() => { clearPending(); error('No response yet. Reconnecting to confirm the latest state…'); socket?.close(); }, 8000);
    render();
  }
  function stop() {
    generation++; clearTimeout(retryTimer); clearInterval(heartbeat); clearPending();
    if (socket) { socket.onclose = null; socket.close(); socket = null; }
    ready = false; joined = false; closeGuess();
  }
  function connect() {
    stop(); if (!room || fatal) return;
    const current = generation;
    $('connection').textContent = 'Connecting… Actions pause until the room is synced.';
    $('connection').classList.add('offline');
    const params = new URLSearchParams({ room });
    const token = FunAuth.token(); if (token) params.set('token', token);
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/wordagents/ws?${params}`);
    socket = ws;
    ws.onopen = () => {
      if (current !== generation) return;
      lastMessage = Date.now();
      heartbeat = setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) return;
        if (Date.now() - lastMessage > 40000) { ws.close(); return; }
        ws.send('ping');
      }, 15000);
    };
    ws.onmessage = event => {
      if (current !== generation) return;
      lastMessage = Date.now(); if (event.data === 'pong') return;
      let message; try { message = JSON.parse(event.data); } catch { return; }
      if (message.type === 'error') { clearPending(); leaving = false; error(message.message || 'That action could not be completed.'); render(); return; }
      if (message.type !== 'state') return;
      if (view && message.revision < view.revision) return;
      if (selection && (selection.revision !== message.revision || selection.gameId !== message.game?.id)) closeGuess();
      view = message; ready = true; retryDelay = 800; clearPending();
      if (leaving && !view.players.some(p => p.id === view.you?.id)) { leaving = false; stop(); location.hash = ''; return; }
      $('connection').textContent = '● Live · room synced'; $('connection').classList.remove('offline');
      if (!joined && profile) { joined = true; ws.send(JSON.stringify({ type: 'join', name: profile.displayName || profile.name || 'Player' })); }
      render();
    };
    ws.onclose = event => {
      if (current !== generation) return;
      ready = false; clearInterval(heartbeat); clearPending(); closeGuess();
      if ([4401,4403,4404,4409].includes(event.code)) {
        fatal = true;
        error(event.code === 4409 ? 'This player connected in another tab. Leave this room before reconnecting here.' : event.code === 4404 ? 'This room no longer exists. Create a new room or check your invite.' : 'Your sign-in needs refreshing. Leave this room and sign in again.');
        $('connection').textContent = 'Disconnected';
      } else {
        $('connection').textContent = 'Connection interrupted · reconnecting automatically…';
        retryTimer = setTimeout(connect, retryDelay); retryDelay = Math.min(retryDelay * 1.7, 8000);
      }
      $('connection').classList.add('offline'); render();
    };
    ws.onerror = () => { /* close event drives retry */ };
  }
  function playerRow(p, me, host) {
    const item = node('li', '', p.name + (p.id === me?.id ? ' (you)' : ''));
    item.append(node('small', '', `${roles[p.role] || 'Choose a role'}${p.connected ? '' : ' · offline'}`));
    if (host && p.id !== me?.id) {
      const remove = node('button', 'wa-remove', 'Remove'); remove.type = 'button';
      remove.setAttribute('aria-label', `Remove ${p.name} from room`); remove.disabled = !connected() || pending;
      remove.onclick = () => send('kick', { playerId: p.id }); item.append(remove);
    }
    return item;
  }
  function render() {
    if (!view) return;
    const game = view.game, me = view.you, host = me?.id === view.hostId;
    $('lobby').hidden = !!game; $('mission').hidden = !game;
    if (!game) {
      const seated = view.players.some(p => p.id === me?.id);
      $('join-seat').hidden = !profile || seated; $('join-seat').disabled = !connected() || pending;
      const teams = $('teams'); teams.replaceChildren();
      for (const team of ['red', 'blue']) {
        const group = node('section', `wa-team ${team}`); group.append(node('h3', '', `${teamName(team)} team`));
        const list = node('ul');
        const players = view.players.filter(p => p.team === team);
        if (!players.length) list.append(node('li', 'wa-muted', 'Waiting for agents…'));
        for (const p of players) list.append(playerRow(p, me, host));
        group.append(list); const actions = node('div', 'wa-actions');
        for (const role of ['spymaster', 'operative']) {
          const selected = me?.team === team && me?.role === role;
          const button = node('button', `wa-small${selected ? ' selected' : ''}`, `${selected ? '✓ ' : ''}${role === 'spymaster' ? 'Be spymaster' : 'Join operatives'}`);
          button.type = 'button'; button.setAttribute('aria-pressed', String(selected));
          button.disabled = !connected() || pending || !profile || !seated || (role === 'spymaster' && players.some(p => p.role === role && p.id !== me?.id));
          button.onclick = () => send('choose', { team, role }); actions.append(button);
        }
        group.append(actions); teams.append(group);
      }
      const unassigned = view.players.filter(p => !p.team || !p.role);
      if (unassigned.length) { const waiting = node('section', 'wa-team wa-unassigned'); waiting.append(node('h3', '', 'Choosing a role')); const list = node('ul'); for (const p of unassigned) list.append(playerRow(p, me, host)); waiting.append(list); teams.append(waiting); }
      const valid = view.players.every(p => p.connected && p.team && p.role) && ['red', 'blue'].every(team => ['spymaster', 'operative'].every(role => view.players.some(p => p.team === team && p.role === role && p.connected)));
      $('start').hidden = !host; $('start').disabled = !valid || !connected() || pending;
      $('lobby-note').textContent = !profile ? 'Sign in to take a role. You are watching this room.' : !seated ? 'You are watching. Join this room to choose a team and role.' : valid ? host ? 'Both teams are ready. You can start the mission.' : 'Both teams are ready. Waiting for the host to start.' : 'At least four players are needed. Everyone must be connected and assigned; each team needs a spymaster and operative.';
      return;
    }
    const finished = game.phase === 'finished', active = me?.team === game.turn;
    $('red-left').textContent = game.remaining.red; $('blue-left').textContent = game.remaining.blue;
    $('turn').textContent = finished ? `${teamName(game.winner)} team wins!` : `${teamName(game.turn)} team · ${game.phase === 'clue' ? 'give a clue' : 'make a guess'}`;
    $('your-role').textContent = me?.role ? `You: ${teamName(me.team)} ${roles[me.role]}` : 'You are watching';
    $('secret-note').hidden = me?.role !== 'spymaster' || finished;
    const board = $('board'); const focusedIndex = document.activeElement?.dataset?.index; board.replaceChildren();
    game.cards.forEach((card, index) => {
      const button = node('button', `wa-card${card.color ? ' ' + card.color : ''}${card.revealed ? ' revealed' : ''}`);
      const label = node('span', 'wa-word');
      (wordBreaks[card.word] || [card.word]).forEach((part, i) => {
        if (i) label.append(document.createElement('wbr'));
        label.append(document.createTextNode(part));
      });
      button.append(label);
      button.type = 'button'; button.dataset.index = index;
      button.disabled = !canGuess() || card.revealed;
      const status = card.color === 'assassin' ? 'Assassin' : card.color === 'neutral' ? 'Civilian' : card.color ? `${teamName(card.color)} agent` : 'Unrevealed';
      if (card.color) button.append(node('small', '', status));
      button.setAttribute('aria-label', `${card.word}, ${status}${card.revealed ? ', revealed' : ''}`);
      button.onclick = () => { if (!canGuess()) return; selection = { index, revision: view.revision, gameId: game.id }; $('confirm-word').textContent = card.word; $('confirm').showModal(); };
      board.append(button);
    });
    if (focusedIndex != null) board.querySelector(`[data-index="${focusedIndex}"]`)?.focus({ preventScroll: true });
    $('current-clue').textContent = game.clue ? `${game.clue.word} · ${game.clue.count}` : 'Waiting for a clue';
    $('instruction').textContent = finished ? 'The full key is now revealed. Compare your connections, then play again.' : game.phase === 'clue' ? active && me?.role === 'spymaster' ? 'Connect your agents with one word and a number.' : `Waiting for the ${teamName(game.turn).toLowerCase()} spymaster…` : `${game.guessesLeft} guesses remaining. ${active && me?.role === 'operative' ? 'Tap a word, then confirm to reveal it.' : 'Watch the team’s guesses unfold.'}`;
    $('clue-form').hidden = !(game.phase === 'clue' && active && me?.role === 'spymaster');
    for (const input of $('clue-form').elements) input.disabled = !connected() || pending;
    $('end-turn').hidden = !(game.phase === 'guess' && active && me?.role === 'operative'); $('end-turn').disabled = !connected() || pending || game.guessesMade < 1;
    $('back-lobby').hidden = !finished || !host; $('back-lobby').disabled = !connected() || pending;
    $('log').replaceChildren(...game.log.map(entry => node('li', '', entry)));
  }
  function navigate() {
    stop(); view = null; fatal = false; leaving = false; error(''); room = readRoom();
    $('home').hidden = !!room; $('room').hidden = !room;
    if (room) $('connection').after($('login')); else $('identity').after($('login'));
    if (room) { $('room-code').textContent = room; $('lobby').hidden = true; $('mission').hidden = true; connect(); }
  }
  $('rules-open').onclick = () => $('rules').showModal();
  $('confirm').addEventListener('close', () => { selection = null; });
  $('confirm-guess').onclick = event => { event.preventDefault(); const chosen = selection; if (!chosen || !canGuess() || chosen.revision !== view.revision || chosen.gameId !== view.game.id) { closeGuess(); return; } send('guess', { index: chosen.index }); };
  $('create').onclick = async () => {
    if (!profile) return; $('create').disabled = true; error('');
    try {
      const response = await fetch('/api/wordagents/create', { method: 'POST', headers: { Authorization: `Bearer ${FunAuth.token()}` }, signal: AbortSignal.timeout(10000) });
      const data = await response.json(); if (!response.ok || !/^[A-Z0-9]{4}$/.test(data.roomCode)) throw new Error(data.error || 'Could not create a room. Please retry.');
      location.hash = data.roomCode;
    } catch (err) { error(err.message || 'Could not create a room. Please retry.'); }
    finally { $('create').disabled = false; }
  };
  $('join-form').onsubmit = event => { event.preventDefault(); const code = $('room-input').value.trim().toUpperCase(); if (/^[A-Z0-9]{4}$/.test(code)) location.hash = code; };
  $('leave').onclick = () => {
    if (connected() && view && (!view.game || view.game.phase === 'finished') && view.players.some(p => p.id === view.you?.id)) {
      if (pending) return; leaving = true; send('leave');
    } else { stop(); location.hash = ''; }
  };
  $('copy').onclick = async () => {
    const url = `${location.origin}/wordagents/#${room}`;
    try { await navigator.clipboard.writeText(url); $('copy').textContent = 'Copied!'; setTimeout(() => { $('copy').textContent = 'Copy invite'; }, 1800); }
    catch { error(`Copy this invite: ${url}`); }
  };
  $('join-seat').onclick = () => send('join', { name: profile?.displayName || profile?.name || 'Player' });
  $('start').onclick = () => send('start');
  $('end-turn').onclick = () => send('endTurn');
  $('back-lobby').onclick = () => send('lobby');
  $('clue-form').onsubmit = event => { event.preventDefault(); send('clue', { word: $('clue-word').value.trim(), count: Number($('clue-count').value) }); };
  const resync = () => {
    if (!room || fatal || document.hidden) return;
    if (socket?.readyState === WebSocket.OPEN) { ready = false; closeGuess(); render(); socket.send(JSON.stringify({ type: 'sync' })); }
    else if (!socket || socket.readyState !== WebSocket.CONNECTING) connect();
  };
  addEventListener('online', resync); document.addEventListener('visibilitychange', resync); addEventListener('hashchange', navigate);
  addEventListener('offline', () => { ready = false; closeGuess(); $('connection').textContent = 'You are offline · actions paused'; $('connection').classList.add('offline'); render(); });
  async function identify() {
    profile = await FunAuth.profile();
    if (profile?.offline) { profile = null; error('Unable to verify sign-in right now. Check your connection and reload.'); }
    $('identity').textContent = profile ? `Signed in as ${profile.displayName || profile.name || 'Player'}` : 'One sign-in across funCentral.';
    $('entry').hidden = !profile; $('login').hidden = !!profile;
    if (!profile) await FunAuth.mountLogin($('login'), () => identify());
    navigate();
  }
  identify();
})();
