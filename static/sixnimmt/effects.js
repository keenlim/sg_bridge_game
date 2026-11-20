'use strict';

// Presentation only. Committed choices stay private until the Worker reveals them.
(() => {
  const toggle = document.getElementById('sound');
  const ribbon = document.getElementById('reveal-strip');
  const rows = document.getElementById('rows');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const key = 'funCentral.sixnimmt.sound';
  let enabled = false, audio, timeout;
  const voices = new Set();
  try { enabled = localStorage.getItem(key) === 'on'; } catch { /* storage unavailable */ }

  const cues = {
    select: [[520,0,.07,'sine']],
    lock: [[385,0,.08,'triangle'],[575,.055,.095,'sine']],
    reveal: [[425,0,.09,'triangle'],[625,.075,.11,'sine']],
    take: [[275,0,.14,'triangle'],[175,.095,.20,'triangle']],
    deal: [[330,0,.08,'sine'],[440,.05,.08,'sine'],[660,.10,.15,'sine']],
    finish: [[392,0,.12,'triangle'],[523,.10,.12,'triangle'],[659,.20,.23,'triangle']],
  };
  function paintSound() {
    toggle.textContent = enabled ? 'Sound on' : 'Sound off';
    toggle.setAttribute('aria-pressed', String(enabled));
  }
  function unlock() {
    if (!enabled) return;
    try {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) return;
      audio ||= new Context();
      if (audio.state === 'suspended') audio.resume().catch(() => {});
    } catch { /* Web Audio unavailable */ }
  }
  function play(cue) {
    if (!enabled || audio?.state !== 'running' || document.visibilityState !== 'visible') return;
    for (const [hz, offset, duration, type] of cues[cue] || []) {
      try {
        const osc = audio.createOscillator(), gain = audio.createGain();
        const t = audio.currentTime + offset;
        osc.type = type;
        osc.frequency.setValueAtTime(hz,t);
        gain.gain.setValueAtTime(.0001,t);
        gain.gain.exponentialRampToValueAtTime(.08,t+.016);
        gain.gain.exponentialRampToValueAtTime(.0001,t+duration);
        osc.connect(gain).connect(audio.destination);
        voices.add(osc);
        osc.onended = () => { voices.delete(osc); osc.disconnect(); gain.disconnect(); };
        osc.start(t); osc.stop(t+duration+.01);
      } catch { /* do not block the game on audio errors */ }
    }
  }
  toggle.addEventListener('click', () => {
    enabled = !enabled;
    try { localStorage.setItem(key, enabled ? 'on' : 'off'); } catch { /* unavailable */ }
    paintSound();
    if (enabled) {
      unlock();
      if (audio?.state === 'running') play('select');
      else audio?.resume().then(() => play('select')).catch(() => {});
    } else {
      for (const osc of voices) { try { osc.stop(); } catch { /* already ended */ } }
    }
  });
  document.addEventListener('pointerdown', unlock, { passive:true });
  document.addEventListener('keydown', unlock);
  document.addEventListener('sixnimmt:select', () => play('select'));
  paintSound();

  function clearRibbon() {
    clearTimeout(timeout);
    ribbon.hidden = true;
    ribbon.replaceChildren();
  }
  function showRibbon(moves, state) {
    clearRibbon();
    const label = document.createElement('b');
    label.textContent = moves.some(m=>m.points) ? 'Row picked up!' : 'Cards revealed!';
    ribbon.append(label);
    for (const [i, move] of moves.entries()) {
      const chip = document.createElement('span');
      chip.className = 'reveal-chip';
      chip.style.setProperty('--stagger', Math.min(i,9)*28+'ms');
      const name = state.seats.find(p=>p.id===move.id)?.name || 'Player';
      chip.textContent = `${name} · ${move.card}${move.points ? ' (+'+move.points+')' : ''}`;
      ribbon.append(chip);
    }
    ribbon.hidden = false;
    timeout = setTimeout(clearRibbon, 2050);
  }
  function pulse(nodes, frames, options) {
    if (motion.matches) return;
    nodes.forEach((node, i) => node.animate?.(frames,{...options,delay:Math.min(i,9)*24}));
  }
  document.addEventListener('sixnimmt:state', ({detail:{previous,state}}) => {
    const before = previous?.game, now = state?.game;
    if (!now) { clearRibbon(); return; }
    if (!previous || previous.roomCode !== state.roomCode) return;
    if (!before || before.serial !== now.serial) {
      clearRibbon();
      pulse([...rows.querySelectorAll('.card'),...document.querySelectorAll('#hand .card')],
        [{opacity:.15,transform:'translateY(14px) scale(.94)'},{opacity:1,transform:'translateY(0) scale(1)'}],
        {duration:260,fill:'backwards',easing:'ease-out'});
      play('deal');
      return;
    }
    const resolved = before.phase === 'select' && (now.turn !== before.turn || now.phase !== 'select');
    const afterChoice = before.phase === 'take';
    const newMoves = resolved ? now.history : afterChoice ? now.history.slice(before.history.length) : [];
    if (resolved || newMoves.length) {
      const reveal = resolved ? [...now.history,...now.revealed] : newMoves;
      if (reveal.length) showRibbon(reveal,state);
      const changedRows = [...new Set(newMoves.map(m=>m.row))];
      for (const i of changedRows) {
        const row = rows.children[i], took = newMoves.some(m=>m.row===i&&m.points);
        if (row) pulse([row],took
          ? [{backgroundColor:'#75483c',transform:'scale(.975)'},{backgroundColor:'#173d34',transform:'scale(1)'}]
          : [{backgroundColor:'#346554',transform:'translateX(3px)'},{backgroundColor:'#173d34',transform:'translateX(0)'}],
          {duration:410,easing:'ease-out'});
      }
      play(now.phase === 'finished' ? 'finish' : newMoves.some(m=>m.points) ? 'take' : 'reveal');
    } else if (before.yourPick == null && now.yourPick != null && before.turn === now.turn) play('lock');
  });
})();
