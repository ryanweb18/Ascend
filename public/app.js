// Ascend — browser client.
(() => {
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };
  // The seat token is kept per browser tab, so two tabs can be two different players.
  const tabStore = {
    get(k) { try { return JSON.parse(sessionStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch {} },
    del(k) { try { sessionStorage.removeItem(k); } catch {} },
  };

  let ws, state = null, prev = null, reconnectDelay = 500, roundKey = null;
  let session = tabStore.get('ascend.session');

  // ---------- Connection ----------
  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(window.ASCEND_SERVER || `${proto}://${location.host}`);
    ws.onopen = () => {
      reconnectDelay = 500;
      if (session) send({ type: 'resume', code: session.code, token: session.token });
    };
    ws.onmessage = (e) => onMessage(JSON.parse(e.data));
    ws.onclose = () => {
      if (state) toast('Reconnecting…');
      setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 1.6, 5000);
    };
  }
  function send(msg) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
    else toast('Still connecting — try again in a second.');
  }

  function onMessage(msg) {
    switch (msg.type) {
      case 'joined':
        session = { code: msg.code, token: msg.token };
        tabStore.set('ascend.session', session);
        history.replaceState(null, '', `?room=${msg.code}`);
        break;
      case 'state':
        prev = state; state = msg.state;
        react(prev, state);
        render();
        break;
      case 'error':
        toast(msg.message); Sound.play('error');
        break;
      case 'resumeFailed':
        session = null; tabStore.del('ascend.session'); showScreen('home');
        break;
      case 'kicked':
        session = null; tabStore.del('ascend.session'); state = null; showScreen('home');
        toast('The host removed you from the room.');
        break;
      case 'arrived':
        if (state && msg.playerId !== state.you) Sound.play('join');
        break;
      case 'reaction':
        showReaction(msg.playerId, msg.emoji); Sound.play('pop');
        break;
    }
  }

  // ---------- Helpers ----------
  const me = () => state && state.players.find(p => p.id === state.you);
  const byId = (id) => state && state.players.find(p => p.id === id);
  const isMyTurn = () => state && state.phase === 'playing' && state.turnId === state.you;
  // Cards are printed in five faded inks by number range: blue, olive, mustard, orange, red.
  const INK_HUES = [212, 66, 40, 22, 4];
  const hue = (v) => INK_HUES[Math.min(4, Math.floor(((v - 1) / state.maxCard) * 5))];
  const pos = (v) => (v - 1) / Math.max(1, state.maxCard - 1);
  const seqCount = (r) => { if (!r || !r.length) return 0; let n = 1; for (let i = 1; i < r.length; i++) { if (r[i] > r[i - 1]) n++; else break; } return n; };

  function bigCard(v, extra = '') {
    const c = el('div', 'big-card ' + extra, `<span class="n">${v}</span>`);
    c.style.setProperty('--hue', hue(v)); c.style.setProperty('--pos', pos(v));
    return c;
  }

  let toastTimer;
  function toast(text) {
    const t = $('toast'); t.textContent = text; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  function showScreen(name) {
    for (const id of ['home', 'lobby', 'game']) $(id).hidden = id !== name;
    if (name !== 'game') $('roundOverlay').hidden = true;
    if (name === 'home') { $('topbarMid').innerHTML = ''; history.replaceState(null, '', location.pathname); }
  }

  // ---------- Sounds driven by state changes ----------
  function react(a, b) {
    if (!a || !b) return;
    if (b.phase === 'playing' && b.turnId === b.you && (a.turnId !== b.you || a.phase !== 'playing')) {
      setTimeout(() => Sound.play('yourTurn'), 350);
    }
    const lm = b.lastMove;
    if (lm && (!a.lastMove || a.lastMove.seq !== lm.seq) && lm.playerId !== b.you) {
      if (lm.type === 'draw') Sound.play(lm.from === 'deck' ? 'draw' : 'click');
      else Sound.play('otherMove');
    }
    if (a.phase === 'playing' && (b.phase === 'roundOver' || b.phase === 'gameOver')) {
      const iWon = b.roundResult && b.roundResult.winnerId === b.you;
      setTimeout(() => Sound.play(iWon || (b.phase === 'gameOver' && b.winnerId === b.you) ? 'win' : 'roundEnd'), 300);
      if (b.phase === 'gameOver' && b.winnerId === b.you) setTimeout(sparkles, 400);
    }
  }

  // ---------- Rendering ----------
  function render() {
    if (!state) return showScreen('home');
    const chips = [`<span class="chip">Room ${state.code}</span>`];
    if (state.phase !== 'lobby') chips.push(`<span class="chip hide-sm">Round ${state.round}</span>`, `<span class="chip hide-sm">Play to ${state.settings.target}</span>`);
    $('topbarMid').innerHTML = chips.join('');

    if (state.phase === 'lobby') { showScreen('lobby'); renderLobby(); return; }
    showScreen('game');
    renderGame();
    renderRoundOverlay();
  }

  function renderLobby() {
    const host = state.hostId === state.you;
    $('lobbyCode').textContent = state.code;
    const seats = $('seats'); seats.innerHTML = '';
    const colors = ['#c4493c', '#3d6a98', '#d4a03a', '#6f8a55'];
    state.players.forEach((p, i) => {
      const li = el('li', 'seat');
      li.innerHTML = `<span class="dot" style="background:${colors[i]}"></span>
        <span class="name">${esc(p.name)}${p.id === state.you ? ' <span class="muted">(you)</span>' : ''}</span>
        ${p.id === state.hostId ? '<span class="tag">host</span>' : ''}
        ${p.isBot ? '<span class="tag">bot</span>' : ''}
        ${!p.connected ? '<span class="tag">away</span>' : ''}`;
      if (host && p.id !== state.you) {
        const x = el('button', 'x', '×'); x.title = 'Remove'; x.setAttribute('aria-label', `Remove ${p.name}`);
        x.onclick = () => { Sound.play('click'); send({ type: 'kick', playerId: p.id }); };
        li.appendChild(x);
      }
      seats.appendChild(li);
    });
    for (let i = state.players.length; i < 4; i++) seats.appendChild(el('li', 'seat empty', `<span class="dot" style="border:1px dashed ${colors[i]}"></span><span class="name">Open seat</span>`));

    $('hostControls').style.display = host ? '' : 'none';
    $('addBotBtn').disabled = state.players.length >= 4;
    $('targetSel').value = String(state.settings.target);
    $('bonusChk').checked = state.settings.bonus;
    $('startBtn').hidden = !host;
    $('startBtn').disabled = state.players.length < 2;
    const hostName = byId(state.hostId)?.name || 'the host';
    $('lobbyNote').textContent = host
      ? (state.players.length < 2 ? 'Waiting for at least one more player (or add a bot).' : `Ready when you are. Playing to ${state.settings.target}${state.settings.bonus ? ' with run bonuses' : ''}.`)
      : `Waiting for ${hostName} to start · playing to ${state.settings.target}${state.settings.bonus ? ' with run bonuses' : ''}.`;
  }

  function renderGame() {
    const you = me();
    const myTurn = isMyTurn();
    const held = state.held;
    const lm = state.lastMove;
    const freshMove = lm && (!prev || !prev.lastMove || prev.lastMove.seq !== lm.seq);

    // Opponents, in seat order starting after me
    const opps = $('opponents'); opps.innerHTML = '';
    const idx = state.players.findIndex(p => p.id === state.you);
    const ordered = state.players.slice(idx + 1).concat(state.players.slice(0, idx));
    for (const p of ordered) {
      const card = el('div', 'glass opp' + (state.turnId === p.id ? ' turn' : ''));
      card.dataset.pid = p.id;
      let status = '';
      if (state.turnId === p.id) {
        if (!held) status = `<span class="opp-status live">Thinking…</span>`;
        else status = `<span class="opp-status live">${held.from === 'deck' ? 'Drew from the deck' : `Took the ${held.card}`}</span>`;
      } else if (!p.connected) status = `<span class="opp-status">Away</span>`;
      else if (p.autopilot) status = `<span class="opp-status">Autopilot</span>`;
      else status = `<span class="opp-status"></span>`;
      const pct = Math.min(100, (p.score / state.settings.target) * 100);
      card.innerHTML = `
        <div class="opp-head"><span class="dot" style="background:${p.color}"></span>
          <span class="name">${esc(p.name)}${p.isBot ? ' <span class="tag">bot</span>' : ''}${p.autopilot ? ' <span class="tag">auto</span>' : ''}</span>
          <span class="pts">${p.score}</span></div>
        <div class="progress"><span style="width:${pct}%;background:${p.color}"></span></div>
        <div class="mini-rack">${Array.from({ length: 10 }, (_, i) => `<i style="width:${55 + i * 4.5}%"></i>`).join('')}</div>
        ${status}`;
      if (freshMove && lm.type === 'place' && lm.playerId === p.id) {
        const bar = card.querySelectorAll('.mini-rack i')[lm.slot];
        if (bar) bar.classList.add('flash');
      }
      opps.appendChild(card);
    }

    // My rack
    $('myName').textContent = you.name;
    $('myScore').textContent = you.score;
    const seq = seqCount(you.rack);
    $('mySeq').textContent = seq === 10 ? 'Perfect climb!' : `${seq} in order from the bottom · worth ${seq * 5}`;
    document.querySelector('.rack-panel').classList.toggle('turn', myTurn);
    const rack = $('rack'); rack.innerHTML = '';
    const pickable = myTurn && held;
    (you.rack || []).forEach((v, i) => {
      const li = el('li', 'slot' + (i < seq ? ' in-seq' : '') + (pickable ? ' pickable' : ''));
      const label = el('span', 'slot-label', String((i + 1) * 5));
      const card = el('button', 'card', `<span class="num">${v}</span>`);
      card.style.setProperty('--hue', hue(v)); card.style.setProperty('--pos', pos(v));
      card.setAttribute('aria-label', `Slot ${i + 1}: ${v}${pickable ? ` — swap with ${held.card}` : ''}`);
      card.tabIndex = pickable ? 0 : -1;
      if (pickable) {
        card.title = `Swap ${v} for ${held.card}`;
        card.onclick = () => { Sound.play('place'); send({ type: 'place', slot: i }); };
        card.onmouseenter = () => Sound.play('hover');
      }
      if (freshMove && lm.type === 'place' && lm.playerId === state.you && lm.slot === i) card.classList.add('just-placed');
      li.append(label, card, el('span', 'slot-check', '✓'));
      rack.appendChild(li);
    });

    // Piles
    $('deckCount').textContent = state.deckCount;
    const canDraw = myTurn && !held;
    $('deckPile').classList.toggle('active', canDraw);
    $('discardPile').classList.toggle('active', canDraw && state.discardTop != null);
    $('deckPile').disabled = !canDraw;
    $('discardPile').disabled = !(canDraw && state.discardTop != null);
    const face = $('discardFace'); face.innerHTML = '';
    if (state.discardTop != null) {
      const changed = !prev || prev.discardTop !== state.discardTop;
      face.appendChild(bigCard(state.discardTop, changed ? 'flip-in' : ''));
      face.className = '';
    } else face.className = 'face-slot';

    // Held card
    const hz = $('heldZone'); hz.innerHTML = '';
    if (held) {
      const freshHeld = !prev || !prev.held;
      if (held.card != null) {
        const c = bigCard(held.card); if (!freshHeld) c.style.animation = 'none';
        hz.appendChild(c);
      } else {
        const c = el('div', 'big-card hidden-face', '<span class="n">?</span>'); if (!freshHeld) c.style.animation = 'none';
        hz.appendChild(c);
      }
      const holder = byId(state.turnId);
      hz.appendChild(el('div', 'hint', myTurn ? 'Click a card in your rack to swap' : `${esc(holder.name)} is deciding…`));
    } else hz.appendChild(el('div', 'placeholder'));

    // Actions + banner
    const actions = $('actions'); actions.innerHTML = '';
    const banner = $('turnBanner');
    banner.classList.toggle('mine', myTurn);
    if (state.phase !== 'playing') banner.innerHTML = 'Round complete';
    else if (myTurn && !held) banner.innerHTML = state.discardTop != null
      ? `<b>Your turn</b> — draw from the deck or take the ${state.discardTop}`
      : `<b>Your turn</b> — draw from the deck`;
    else if (myTurn && held.from === 'deck') {
      banner.innerHTML = `You drew a <b>${held.card}</b> — swap it in, or let it go`;
      const b = el('button', 'btn', 'Discard it <span class="muted small">(X)</span>');
      b.onclick = () => { Sound.play('discard'); send({ type: 'discard' }); };
      actions.appendChild(b);
    } else if (myTurn) banner.innerHTML = `Place the <b>${held.card}</b> somewhere in your rack`;
    else {
      const t = byId(state.turnId);
      banner.innerHTML = `Waiting for <b>${esc(t.name)}</b>${t.connected ? '' : ' (reconnecting…)'}`;
    }

    // Log
    const log = $('log'); log.innerHTML = '';
    state.log.slice(-4).forEach(entry => log.appendChild(el('li', '', esc(entry.text))));
  }

  function renderRoundOverlay() {
    const ov = $('roundOverlay');
    if (state.phase !== 'roundOver' && state.phase !== 'gameOver') { ov.hidden = true; roundKey = null; return; }
    const key = `${state.round}:${state.phase}:${state.hostId}`;
    if (key === roundKey) return;
    roundKey = key;
    const rr = state.roundResult;
    const winner = byId(rr.winnerId);
    const host = state.hostId === state.you;
    const modal = $('roundModal');
    let html = '';
    if (state.phase === 'gameOver') {
      const champ = byId(state.winnerId);
      html += `<div class="champion"><span class="crown">✦</span><h2>${champ.id === state.you ? 'You win!' : `${esc(champ.name)} wins`}</h2>
        <p class="muted">Final score ${champ.score} · after ${state.round} round${state.round === 1 ? '' : 's'}</p></div>`;
    } else {
      html += `<p class="eyebrow">Round ${state.round}</p><h2>${winner.id === state.you ? 'You ascended!' : `${esc(winner.name)} ascended`}</h2>`;
    }
    html += '<div class="results">';
    const rows = rr.results.slice().sort((a, b) => b.total - a.total);
    for (const r of rows) {
      const p = byId(r.playerId);
      const isW = r.playerId === rr.winnerId;
      const seq = isW ? 10 : seqCount(r.rack);
      // Highlight the longest run for the winner when bonuses apply
      let runStart = -1;
      if (isW && r.bonus) {
        let best = 1, cur = 1, start = 0;
        for (let i = 1; i < r.rack.length; i++) {
          if (r.rack[i] === r.rack[i - 1] + 1) { cur++; if (cur > best) { best = cur; start = i - cur + 1; } } else cur = 1;
        }
        runStart = start; r._runLen = best;
      }
      const chips = r.rack.map((v, i) => {
        const inRun = runStart >= 0 && i >= runStart && i < runStart + r._runLen;
        return `<span class="${i < seq ? 'ok' : ''}${inRun ? ' run' : ''}" style="--hue:${hue(v)}">${v}</span>`;
      }).join('');
      html += `<div class="result-row${isW ? ' win' : ''}">
        <div class="result-name"><span class="dot" style="background:${p.color}"></span>${esc(p.name)}${p.id === state.you ? ' <span class="muted">(you)</span>' : ''}</div>
        <div class="result-pts"><span class="plus">+${r.points}</span>${r.bonus ? ` <span class="muted small">(incl. +${r.bonus} run of ${r.run})</span>` : ''}<div class="tot">${r.total} total</div></div>
        <div class="result-rack">${chips}</div></div>`;
    }
    html += '</div><div class="modal-actions">';
    if (state.phase === 'gameOver') {
      html += host ? `<button class="btn primary" data-act="backToLobby">Back to lobby</button>` : `<span class="muted">Waiting for the host…</span>`;
    } else {
      html += host ? `<button class="btn primary" data-act="nextRound">Deal next round</button>` : `<span class="muted">Waiting for the host to deal…</span>`;
    }
    html += '</div>';
    modal.innerHTML = html;
    modal.querySelectorAll('[data-act]').forEach(b => b.onclick = () => { Sound.play('click'); send({ type: b.dataset.act }); });
    ov.hidden = false;
  }

  function showReaction(playerId, emoji) {
    let host = document.querySelector(`.opp[data-pid="${playerId}"]`);
    if (!host && state && playerId === state.you) host = document.querySelector('.rack-panel');
    if (!host) return;
    const f = el('span', 'float-emoji', emoji);
    host.appendChild(f);
    setTimeout(() => f.remove(), 2300);
  }

  function sparkles() {
    const colors = ['#c4493c', '#3d6a98', '#d4a03a', '#6f8a55', '#f3e6c8'];
    for (let i = 0; i < 60; i++) {
      const s = el('div', 'sparkle');
      s.style.left = `${50 + (Math.random() - 0.5) * 30}vw`;
      s.style.top = `${45 + (Math.random() - 0.5) * 20}vh`;
      s.style.background = colors[i % colors.length];
      s.style.setProperty('--dx', `${(Math.random() - 0.5) * 600}px`);
      s.style.setProperty('--dy', `${(Math.random() - 0.7) * 500}px`);
      s.style.animationDelay = `${Math.random() * 0.4}s`;
      document.body.appendChild(s);
      setTimeout(() => s.remove(), 3000);
    }
  }

  // ---------- Wiring ----------
  const nameInput = $('nameInput'), codeInput = $('codeInput');
  nameInput.value = store.get('ascend.name', '');
  const urlRoom = new URLSearchParams(location.search).get('room');
  if (urlRoom) codeInput.value = urlRoom.toUpperCase().slice(0, 4);

  function getName() {
    const n = nameInput.value.trim();
    if (!n) { nameInput.focus(); toast('Pick a name first.'); Sound.play('error'); return null; }
    store.set('ascend.name', n);
    return n;
  }
  $('createBtn').onclick = () => { const n = getName(); if (!n) return; Sound.play('click'); send({ type: 'create', name: n }); };
  $('joinBtn').onclick = () => {
    const n = getName(); if (!n) return;
    const code = codeInput.value.trim().toUpperCase();
    if (code.length !== 4) { toast('Room codes are 4 letters.'); Sound.play('error'); return; }
    Sound.play('click'); send({ type: 'join', code, name: n });
  };
  codeInput.addEventListener('input', () => { codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z]/g, ''); });
  codeInput.addEventListener('keydown', e => { if (e.key === 'Enter') $('joinBtn').click(); });
  nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') (codeInput.value.length === 4 ? $('joinBtn') : $('createBtn')).click(); });

  $('copyLink').onclick = async () => {
    Sound.play('click');
    const link = `${location.origin}/?room=${state.code}`;
    try { await navigator.clipboard.writeText(link); toast('Invite link copied'); }
    catch { toast(link); }
  };
  $('addBotBtn').onclick = () => { Sound.play('click'); send({ type: 'addBot' }); };
  $('targetSel').onchange = (e) => { Sound.play('click'); send({ type: 'settings', target: Number(e.target.value) }); };
  $('bonusChk').onchange = (e) => { Sound.play('click'); send({ type: 'settings', bonus: e.target.checked }); };
  $('startBtn').onclick = () => { Sound.play('click'); send({ type: 'start' }); };
  $('leaveBtn').onclick = () => {
    Sound.play('click'); send({ type: 'leave' });
    session = null; tabStore.del('ascend.session'); state = null; showScreen('home');
  };

  $('deckPile').onclick = () => { if (!isMyTurn() || state.held) return; Sound.play('draw'); send({ type: 'draw', from: 'deck' }); };
  $('discardPile').onclick = () => { if (!isMyTurn() || state.held || state.discardTop == null) return; Sound.play('click'); send({ type: 'draw', from: 'discard' }); };

  const reactBar = $('reactions');
  ['👋', '😮', '😅', '🎉', '🙏', '😎'].forEach(em => {
    const b = el('button', '', em); b.title = 'Send a reaction';
    b.onclick = () => send({ type: 'react', emoji: em });
    reactBar.appendChild(b);
  });

  // Keyboard: D = deck, T = take discard, X = discard drawn card, 1–9 & 0 = slot (bottom = 1)
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, select, textarea')) return;
    if (e.key === 'Escape') { $('rulesOverlay').hidden = true; $('soundPop').hidden = true; return; }
    if (!isMyTurn()) return;
    const k = e.key.toLowerCase();
    if (!state.held && k === 'd') $('deckPile').click();
    else if (!state.held && k === 't') $('discardPile').click();
    else if (state.held && k === 'x' && state.held.from === 'deck') { Sound.play('discard'); send({ type: 'discard' }); }
    else if (state.held && /^[0-9]$/.test(k)) { const slot = k === '0' ? 9 : Number(k) - 1; Sound.play('place'); send({ type: 'place', slot }); }
  });

  // Rules
  $('rulesBtn').onclick = () => { Sound.play('click'); $('rulesOverlay').hidden = false; };
  $('closeRules').onclick = () => { Sound.play('click'); $('rulesOverlay').hidden = true; };
  $('rulesOverlay').onclick = (e) => { if (e.target === $('rulesOverlay')) $('rulesOverlay').hidden = true; };

  // Sound settings
  const pop = $('soundPop');
  $('soundBtn').onclick = (e) => { e.stopPropagation(); Sound.play('click'); pop.hidden = !pop.hidden; };
  document.addEventListener('click', (e) => { if (!pop.hidden && !pop.contains(e.target)) pop.hidden = true; });
  $('musicOn').checked = Sound.prefs.musicOn; $('sfxOn').checked = Sound.prefs.sfxOn;
  $('musicVol').value = Sound.prefs.music; $('sfxVol').value = Sound.prefs.sfx;
  $('musicOn').onchange = (e) => Sound.setMusicOn(e.target.checked);
  $('sfxOn').onchange = (e) => { Sound.setSfxOn(e.target.checked); Sound.play('click'); };
  $('musicVol').oninput = (e) => Sound.setMusicVolume(Number(e.target.value));
  $('sfxVol').oninput = (e) => Sound.setSfxVolume(Number(e.target.value));
  $('sfxVol').onchange = () => Sound.play('click');

  // Browsers only allow audio after the first interaction.
  const unlock = () => { Sound.init(); };
  document.addEventListener('pointerdown', unlock, { capture: true });
  document.addEventListener('keydown', unlock, { capture: true });

  showScreen('home');
  connect();
})();
