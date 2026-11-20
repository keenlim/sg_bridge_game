'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const make = (tag, cls, text) => { const n=document.createElement(tag); if(cls)n.className=cls; if(text!==undefined)n.textContent=text; return n; };
  const names = { freeze:'Freeze',flipThree:'Flip Three',secondChance:'Second Chance' };
  const CONNECTION_TIMEOUT = 8000;
  const TERMINAL_CLOSE_CODES = [4401, 4403, 4404, 4409];
  let profile=null, view=null, socket=null, room='', ready=false, pending=false, generation=0, retry=null, heartbeat=null, timeout=null, leaving=false;
  let connectTimeout=null, retryDelay=1500, terminalClose=false;
  const name = id => view?.players.find(p=>p.id===id)?.name || 'Player';
  const me = () => view?.you?.id;
  const host = () => !!me() && view?.hostId===me();
  const seated = () => !!me() && view?.players.some(p=>p.id===me());
  const active = () => ready && !pending && socket?.readyState===WebSocket.OPEN;
  function notice(message) { $('notice').textContent=message; $('notice').hidden=false; clearTimeout(notice.timer); notice.timer=setTimeout(()=>$('notice').hidden=true,6500); }
  function button(label, action, disabled=false, cls='') {const b=make('button',cls,label);b.type='button';b.disabled=disabled;b.onclick=action;return b;}
  function send(type, data={}) {
    if(!active())return false;
    const frame={type,...data};
    if(['hit','stay','target','nextRound','abandon'].includes(type)){if(!view?.game)return false;frame.gameId=view.game.id;frame.revision=view.revision;}
    pending=true;socket.send(JSON.stringify(frame));clearTimeout(timeout);
    timeout=setTimeout(()=>{notice('No response yet. Reconnecting to check the latest state.');connect();},8000);render();return true;
  }
  function stop() {generation++;ready=false;pending=false;clearTimeout(retry);clearTimeout(timeout);clearTimeout(connectTimeout);clearInterval(heartbeat);if(socket){socket.onclose=null;socket.onmessage=null;socket.close();socket=null;}}
  function connect() {
    stop();if(!room || terminalClose || window.FC_MOVED)return;const g=generation;let last=Date.now();
    $('connection').textContent='Connecting…';$('recovery').hidden=true;
    const params=new URLSearchParams({room});const token=FunAuth.token();if(token)params.set('token',token);
    socket=new WebSocket(`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}/api/flip7/ws?${params}`);
    const ws=socket;
    connectTimeout=setTimeout(()=>{if(g===generation&&!ready)ws.close();},CONNECTION_TIMEOUT);
    ws.onopen=()=>{if(g!==generation)return;heartbeat=setInterval(()=>{if(Date.now()-last>40000){ws.close();return;}if(ws.readyState===WebSocket.OPEN)ws.send('ping');},15000);};
    ws.onmessage=e=>{
      if(g!==generation)return;last=Date.now();if(e.data==='pong')return;let s;try{s=JSON.parse(e.data);}catch{return;}
      if(s.type==='error'){pending=false;leaving=false;clearTimeout(timeout);notice(s.message||'Action could not be completed.');render();return;}
      if(s.type!=='state'||(view&&s.revision<view.revision))return;
      view=s;ready=true;pending=false;retryDelay=1500;clearTimeout(connectTimeout);clearTimeout(timeout);$('connection').textContent='● Live';
      if(leaving&&!seated()){leaving=false;location.hash='';return;}render();
    };
    ws.onclose=e=>{if(g!==generation)return;ready=false;pending=false;clearTimeout(timeout);clearTimeout(connectTimeout);clearInterval(heartbeat);$('connection').textContent='Offline';render();
      if(TERMINAL_CLOSE_CODES.includes(e.code)){terminalClose=true;$('recovery').hidden=false;$('recovery-message').textContent=e.code===4409?'This room is open in another tab or device.':e.code===4404?'This room no longer exists. Check the code or create a new room.':'Your sign-in needs refreshing. Return home and sign in again.';$('reconnect').hidden=e.code!==4409;}
      else {$('connection').textContent='Reconnecting…';retry=setTimeout(connect,retryDelay);retryDelay=Math.min(retryDelay*2,10000);}
    };
    ws.onerror=()=>{};render();
  }
  function card(value, kind='') {const n=make('div',`card ${kind}`);n.append(make('small','',kind==='shield'?'PROTECT':kind?'BONUS':'NUMBER'),make('span','',String(value)));return n;}
  function render() {
    $('home').hidden=!!room;$('room').hidden=!room;if(!view||!room)return;
    $('code').textContent=view.roomCode;$('watchers').textContent=`${view.watchers||0} watching · ${view.players.length}/${view.maxPlayers||12} seats`;
    const game=view.game;const roster=$('players');roster.replaceChildren();
    for(const p of view.players){const gp=game?.players.find(x=>x.id===p.id);const tile=make('article',`player ${gp?.status||''} ${game?.turnId===p.id?'current':''}`);tile.dataset.playerId=p.id;
      const head=make('div','player-head');head.append(make('span','avatar',p.name.slice(0,2).toUpperCase()));const info=make('div');info.append(make('div','player-name',p.name+(p.id===me()?' · you':'')),make('div','status',[p.id===view.hostId?'Host':null,p.connected?'Connected':'Offline',gp?.status,game?.turnId===p.id?'Taking a turn':null].filter(Boolean).join(' · ')));head.append(info);
      if(gp){const score=make('div','player-score',String(gp.roundScore));score.append(make('small','',gp.status==='busted'?'BUSTED':'THIS ROUND'));head.append(score);}
      tile.append(head);
      if(gp){const cards=make('div','cards');for(const n of gp.numbers)cards.append(card(n));for(const n of gp.bonuses)cards.append(card(`+${n}`,'special'));if(gp.doubled)cards.append(card('×2','special'));if(gp.secondChance)cards.append(card('Save','shield'));if(!cards.children.length)cards.append(make('span','empty-cards','Waiting for the first card.'));tile.append(cards);}
      if(host()&&!game&&p.id!==me())tile.append(button('Remove '+p.name,()=>send('kick',{playerId:p.id}),!active(),'quiet danger'));roster.append(tile);
    }
    $('standings').replaceChildren();const standings=game?[...game.players].sort((a,b)=>b.total-a.total):view.players.map(p=>({id:p.id,total:0}));standings.forEach((p,i)=>{const row=make('div','standing');row.append(make('span','',`${i+1}. ${name(p.id)}`),make('b','',String(p.total)));$('standings').append(row);});
    const actions=$('actions');actions.replaceChildren();$('summary').hidden=true;$('abandon').hidden=!(host()&&game&&!['finished'].includes(game.phase));$('abandon').disabled=!active();
    if(!game){$('round-label').textContent='THE TABLE IS OPEN';$('headline').textContent='Take a seat.';$('hint').textContent=`Invite your friends. ${view.minPlayers||3} connected players needed to start.`;
      if(!seated()&&profile&&!view.you?.removed)actions.append(button('Take a seat',()=>send('join'),!active()||view.players.length>=(view.maxPlayers||12),'primary'));
      if(!profile)actions.append(make('p','','Watching as a guest. Sign in from the home page to play.'));
      if(view.you?.removed)actions.append(make('p','','The host removed your seat. You can keep watching.'));
      if(host())actions.append(button('Start game',()=>send('start'),!active()||view.players.length<(view.minPlayers||3)||view.players.some(p=>!p.connected),'primary'));
      else if(seated())actions.append(make('p','','Waiting for the host to start the game.'));return;
    }
    $('round-label').textContent=`ROUND ${game.round} / RACE TO 200 · ${game.deckCount} CARDS LEFT`;
    if(game.phase==='finished'||game.phase==='roundEnd'){
      const best=Math.max(...game.players.map(p=>p.total));const winners=game.players.filter(p=>p.total===best).map(p=>name(p.id));
      $('headline').textContent=game.phase==='finished'?(winners.length>1?`${winners.join(' & ')} tie!`:`${winners[0]} wins!`):'Banked. Busted. Next?';
      $('hint').textContent=game.phase==='finished'?'Final totals are in. Thanks for playing.':'Round complete. Everyone’s total has been updated.';
      $('summary').hidden=false;$('summary').textContent=game.flippedBy?`${name(game.flippedBy)} flipped seven! +15 bonus points.`:game.phase==='finished'?`${best} points takes the game.`:'A fresh round means a fresh chance.';
      if(host())actions.append(game.phase==='finished'?button('Back to lobby',()=>send('lobby'),!active(),'primary'):button(`Start round ${game.round+1}`,()=>send('nextRound'),!active(),'primary'));else actions.append(make('p','','Waiting for the host.'));return;
    }
    const gp=game.players.find(p=>p.id===me());const yourTurn=seated()&&game.turnId===me()&&gp?.status==='active';
    if(game.pending){const p=game.pending;$('headline').textContent=`${names[p.type]||'Action card'}.`;$('hint').textContent=`${name(p.actorId)} chooses who receives this card.`;
      if(p.actorId===me()&&seated()){actions.append(make('p','',`Choose a player for ${names[p.type]||'this card'}.`));for(const id of p.targets)actions.append(button(`Choose ${name(id)}`,()=>send('target',{playerId:id}),!active(),'primary'));}
      else actions.append(make('p','','Waiting for the action card to be resolved.'));return;
    }
    $('headline').textContent=yourTurn?'One more card?':`${name(game.turnId)} is up.`;
    $('hint').textContent=yourTurn?'Trust your luck. Or take the points.':seated()?'Watch the table. Your next turn is coming.':'You’re watching this game. Join the next game from the lobby.';
    const allowed=active()&&yourTurn&&game.phase==='playing';
    actions.append(button('Hit · draw a card',()=>send('hit'),!allowed,'primary'),button(`Stay · bank ${gp?.roundScore||0}`,()=>send('stay'),!allowed||!(gp.numbers.length||gp.bonuses.length||gp.doubled||gp.secondChance)));
    if(pending)actions.append(make('p','','Confirming your move…'));
  }
  function navigate(){stop();view=null;leaving=false;terminalClose=false;retryDelay=1500;room=location.hash.slice(1).split(':')[0].toUpperCase();if(!/^[A-Z0-9]{4}$/.test(room))room='';$('home').hidden=!!room;$('room').hidden=!room;$('recovery').hidden=true;if(room)connect();}
  $('rules-open').onclick=()=>$('rules').showModal();$('rules-close').onclick=()=>$('rules').close();
  $('join-form').onsubmit=e=>{e.preventDefault();const code=$('room-input').value.trim().toUpperCase();if(/^[A-Z0-9]{4}$/.test(code)){if(location.hash==='#'+code)navigate();else location.hash=code;}else notice('Enter a four-character room code.');};
  $('create').onclick=async()=>{const b=$('create');b.disabled=true;try{const r=await fetch('/api/flip7/create',{method:'POST',headers:{Authorization:`Bearer ${FunAuth.token()}`},signal:AbortSignal.timeout(10000)});const d=await r.json();if(!r.ok||!/^[A-Z0-9]{4}$/.test(d.roomCode||''))throw Error(d.error||'Could not create a room.');location.hash=d.roomCode;}catch(e){notice(e.message);}finally{b.disabled=false;}};
  $('invite').onclick=async()=>{const url=`${location.origin}/flip7/#${room}`;try{await navigator.clipboard.writeText(url);notice('Invite link copied.');}catch{notice(`Share this room code: ${room}`);}};
  $('leave').onclick=()=>{if(!seated()){location.hash='';return;}if(view.game&&view.game.phase!=='finished'){if(confirm('Return home? Your seat stays in this game. Reopen the invite with the same sign-in to reconnect.'))location.hash='';return;}if(pending)return;if(!ready){if(confirm('Leave without giving up your seat? Reopen the invite to reconnect.'))location.hash='';return;}leaving=send('leave');};
  $('abandon').onclick=()=>{const revision=view?.revision;const id=view?.game?.id;if(confirm('End this game for everyone and return to the lobby?')&&view?.revision===revision&&view?.game?.id===id)send('abandon');};
  $('reconnect').onclick=()=>{terminalClose=false;retryDelay=1500;connect();};window.addEventListener('hashchange',navigate);window.addEventListener('online',()=>{if(room&&!ready)connect();});window.addEventListener('pagehide',stop);
  window.addEventListener('pageshow',e=>{if(e.persisted&&room)connect();});
  async function auth(){profile=await FunAuth.profile();$('identity').textContent=profile?.offline?'Sign-in could not be checked. Please reconnect.':profile?`Playing as ${profile.displayName||'you'}`:'Sign in once. Play across funCentral.';$('signed-in').hidden=!profile||!!profile.offline;$('login').hidden=!!profile; if(!profile)await FunAuth.mountLogin($('login'),()=>{auth();if(room)connect();});render();}
  navigate();auth();
})();
