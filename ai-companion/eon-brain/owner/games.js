/* ============================================================
   EON — owner/games.js  ·  "The Reset Valve"
   A little arcade EON carries next to his backpack. Click the 🎮 chip
   and a menu of quick games appears: rock-paper-scissors, tic-tac-toe,
   a reflex tap, a memory game, "guess what's in EON's backpack", and a
   fast trivia round. EON plays along — he reacts, gloats, sulks, cheers,
   then walks you back to work. Healthy by design: a pressure valve, not
   a rabbit hole.

   Owner-only (sits with the backpack). Pure add-on — consumes the avatar
   ctx (character / ai) to react; touches nothing else.
   ============================================================ */

export class Games {
  constructor(ctx) {
    this.ctx = ctx;
    this.score = {};                 // { game: {you, eon} }
    this._open = false;
    this._menuOpen = false;
    this._t = null;                  // active game timers
  }

  start() {
    this._injectStyle();
    this._buildButton();
    this._buildMenu();
    this._buildPanel();
    if (typeof window !== 'undefined') window.EonGames = this;
  }

  update() {
    const owner = this._owner();
    if (this._btn) this._btn.style.display = owner ? '' : 'none';   // '' → CSS default (grid, centred)
    if (!owner && (this._open || this._menuOpen)) this._closeAll();
  }

  // ---------------- EON reactions ----------------
  _say(t, ms = 3200) { try { this.ctx.ai?.speak(t, ms); } catch {} }
  _emote(e) { try { this.ctx.character?.playEmote?.(e); } catch {} }
  _youWin(msg) { this._inc('you'); this._say(msg, 3600); this._emote(this._pick(['sad', 'surprised', 'facepalm', 'shrug'])); }
  _eonWin(msg) { this._inc('eon'); this._say(msg, 3600); this._emote(this._pick(['cheer', 'fistPump', 'dance', 'proud'])); }
  _tie(msg) { this._say(msg, 3000); this._emote('nod'); }
  _inc(who) { const g = this._g; (this.score[g] = this.score[g] || { you: 0, eon: 0 })[who]++; }
  _sc(who) { return (this.score[this._g] || { you: 0, eon: 0 })[who]; }

  // ================= the 🎮 launcher =================
  _toggleMenu(on) {
    this._menuOpen = on === undefined ? !this._menuOpen : on;
    this._menu.classList.toggle('show', this._menuOpen);
    if (this._menuOpen) { this._closePanel(); this._say(this._pick(['Game time! 🎮', 'Need a quick reset? Pick one. 🎮', 'Ooh, a break! What are we playing?']), 3200); this._emote('wave'); }
  }
  _openGame(key) {
    this._toggleMenu(false);
    this._g = key;
    this._open = true;
    this._panel.classList.add('show');
    this._positionPanel();
    ({ rps: () => this._rps(), ttt: () => this._ttt(), reflex: () => this._reflex(),
      memory: () => this._memory(), bag: () => this._bagGuess(), trivia: () => this._trivia() }[key] || (() => {}))();
  }
  _closePanel() { this._open = false; this._panel?.classList.remove('show'); this._clearTimers(); }
  _closeAll() { this._toggleMenu(false); this._closePanel(); }
  _clearTimers() { (this._t || []).forEach(clearTimeout); this._t = []; }
  _later(fn, ms) { (this._t = this._t || []).push(setTimeout(fn, ms)); }

  _setBody(html) { this._body.innerHTML = html; }
  _title(t) { this._titleEl.textContent = t; }
  _scoreLine() { return `<div class="eg-score">You <b>${this._sc('you')}</b> · EON <b>${this._sc('eon')}</b></div>`; }
  _wrap(inner) { return `${inner}${this._scoreLine()}<div class="eg-foot"><button class="eg-again">↻ Play again</button><button class="eg-menu">← Games</button></div>`; }
  _wire() {
    const again = this._body.querySelector('.eg-again'); if (again) again.onclick = () => this._openGame(this._g);
    const menu = this._body.querySelector('.eg-menu'); if (menu) menu.onclick = () => { this._closePanel(); this._toggleMenu(true); };
  }

  // ================= 1 · Rock · Paper · Scissors =================
  _rps() {
    this._title('Rock · Paper · Scissors');
    const E = { rock: '✊', paper: '✋', scissors: '✌️' }, keys = Object.keys(E);
    const render = (msg) => {
      this._setBody(this._wrap(`<div class="eg-msg">${msg || 'Make your move!'}</div>
        <div class="eg-row">${keys.map(k => `<button class="eg-big" data-k="${k}">${E[k]}</button>`).join('')}</div>`));
      this._body.querySelectorAll('[data-k]').forEach(b => b.onclick = () => play(b.dataset.k));
      this._wire();
    };
    const play = (you) => {
      const eon = keys[(Math.random() * 3) | 0];
      const win = (a, b) => (a === 'rock' && b === 'scissors') || (a === 'paper' && b === 'rock') || (a === 'scissors' && b === 'paper');
      let res;
      if (you === eon) { res = `${E[you]} vs ${E[eon]} — a tie! 🤝`; this._tie('Great minds! 🤝'); }
      else if (win(you, eon)) { res = `${E[you]} beats ${E[eon]} — you win! 🎉`; this._youWin(this._pick(['Argh, you got me! 😤', 'No fair! Best of three? 😅', 'Beginner\'s luck! 😆'])); }
      else { res = `${E[eon]} beats ${E[you]} — EON wins! 🤖`; this._eonWin(this._pick(['Haha! Too easy. 😎', 'EON takes it! 🔥', 'Read you like a book! 📖'])); }
      render(res);
    };
    render();
  }

  // ================= 2 · Tic-Tac-Toe =================
  _ttt() {
    this._title('Tic-Tac-Toe — you\'re ✕');
    let b = Array(9).fill('');
    const LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
    const winner = (g) => { for (const [a,c,d] of LINES) if (g[a] && g[a] === g[c] && g[a] === g[d]) return g[a]; return g.every(x => x) ? 'tie' : null; };
    const eonMove = () => {
      const empty = b.map((v, i) => v ? -1 : i).filter(i => i >= 0);
      const tryWin = (mark) => { for (const i of empty) { const t = b.slice(); t[i] = mark; if (winner(t) === mark) return i; } return -1; };
      let m = tryWin('O'); if (m < 0) m = tryWin('X'); if (m < 0 && !b[4]) m = 4;
      if (m < 0) m = empty[(Math.random() * empty.length) | 0];
      if (m >= 0) b[m] = 'O';
    };
    const render = (msg) => {
      this._setBody(this._wrap(`<div class="eg-msg">${msg || 'Your move — tap a square.'}</div>
        <div class="eg-grid">${b.map((v, i) => `<button class="eg-cell ${v ? 'on' : ''}" data-i="${i}" ${v ? 'disabled' : ''}>${v === 'X' ? '✕' : v === 'O' ? '◯' : ''}</button>`).join('')}</div>`));
      this._body.querySelectorAll('[data-i]').forEach(c => c.onclick = () => move(+c.dataset.i));
      this._wire();
    };
    const finish = (w) => {
      if (w === 'X') { this._youWin('You beat me?! Rematch! 😤'); render('You win! 🎉'); }
      else if (w === 'O') { this._eonWin('Three in a row — EON wins! 😎'); render('EON wins! 🤖'); }
      else { this._tie('A draw. Well played. 🤝'); render('It\'s a tie! 🤝'); }
    };
    const move = (i) => {
      if (b[i]) return; b[i] = 'X';
      let w = winner(b); if (w) return finish(w);
      eonMove(); w = winner(b); if (w) return finish(w);
      render();
    };
    render();
  }

  // ================= 3 · Reflex tap =================
  _reflex() {
    this._title('Reflex — tap when it turns green');
    let state = 'wait', start = 0;
    const render = (cls, label) => {
      this._setBody(this._wrap(`<button class="eg-reflex ${cls}">${label}</button>`));
      this._body.querySelector('.eg-reflex').onclick = tap;
      this._wire();
    };
    const arm = () => {
      state = 'wait'; render('wait', 'Wait for green…');
      this._later(() => { state = 'go'; start = performance.now(); render('go', 'TAP!'); }, 900 + Math.random() * 2600);
    };
    const tap = () => {
      if (state === 'wait') { state = 'done'; this._clearTimers(); this._emote('surprised'); this._say('Too soon! 😄', 2600); render('bad', 'Too soon! Tap to retry'); state = 'retry'; return; }
      if (state === 'retry') { arm(); return; }
      if (state === 'go') {
        const ms = Math.round(performance.now() - start); state = 'done';
        const good = ms < 320;
        if (good) { this._eonWin(`${ms}ms — lightning! ⚡`); } else { this._youWin(`${ms}ms — bit slow, but I'll allow it. 😏`); }
        render('done', `${ms}ms — tap to retry`); state = 'retry';
      }
    };
    arm();
  }

  // ================= 4 · Memory (repeat the sequence) =================
  _memory() {
    this._title('Memory — repeat EON\'s sequence');
    const PADS = ['🟥', '🟩', '🟦', '🟨']; let seq = [], input = [], lock = true;
    const render = (msg) => {
      this._setBody(this._wrap(`<div class="eg-msg">${msg || ''}</div>
        <div class="eg-pads">${PADS.map((p, i) => `<button class="eg-pad" data-i="${i}">${p}</button>`).join('')}</div>`));
      this._body.querySelectorAll('[data-i]').forEach(p => p.onclick = () => press(+p.dataset.i));
      this._wire();
    };
    const flash = (i) => { const el = this._body.querySelectorAll('.eg-pad')[i]; if (el) { el.classList.add('lit'); this._later(() => el.classList.remove('lit'), 320); } };
    const playSeq = () => {
      lock = true; render(`Watch… (${seq.length})`);
      seq.forEach((s, k) => this._later(() => flash(s), 500 + k * 560));
      this._later(() => { lock = false; render('Your turn 👆'); }, 500 + seq.length * 560 + 200);
    };
    const next = () => { seq.push((Math.random() * 4) | 0); input = []; this._later(playSeq, 500); };
    const press = (i) => {
      if (lock) return; flash(i); input.push(i);
      const k = input.length - 1;
      if (input[k] !== seq[k]) { this._youWin(`Oof! You reached level ${seq.length}. 🧠`); render(`Wrong! Final level: ${seq.length}. Play again?`); lock = true; return; }
      if (input.length === seq.length) { this._say(`Level ${seq.length} clear! 🔥`, 2200); this._emote('cheer'); next(); }
    };
    render('Get ready…'); next();
  }

  // ================= 5 · Guess what's in EON's backpack =================
  _bagGuess() {
    this._title('Guess EON\'s backpack');
    const ITEMS = ['📎', '🍵', '📕', '🔑', '🍬', '💎', '🧦', '🔦'];
    const hidden = ITEMS[(Math.random() * ITEMS.length) | 0];
    let tries = 3;
    this._say('I\'ve hidden one thing in my bag. Guess it! 🎒', 3600); this._emote('peek');
    const render = (msg) => {
      this._setBody(this._wrap(`<div class="eg-msg">${msg || `I'm hiding one of these. ${tries} guesses left.`}</div>
        <div class="eg-row eg-wrap">${ITEMS.map(it => `<button class="eg-big" data-it="${it}">${it}</button>`).join('')}</div>`));
      this._body.querySelectorAll('[data-it]').forEach(b => b.onclick = () => guess(b.dataset.it));
      this._wire();
    };
    const guess = (it) => {
      if (it === hidden) { this._eonWin('Yes! You found it! 🎉'); render(`It was ${hidden} — nice! 🎉`); this._emote('cheer'); return; }
      tries--;
      if (tries <= 0) { this._youWin(`Out of guesses — it was ${hidden}. 😜`); render(`Out of guesses! It was ${hidden}. 🎒`); return; }
      this._say(this._pick(['Nope! 😏', 'Not that one!', 'Cold… try again. ❄️']), 2200);
      render(`Not ${it}. ${tries} left.`);
    };
    render();
  }

  // ================= 6 · Quick trivia =================
  _trivia() {
    this._title('EON\'s quick trivia');
    const Q = this._pick([
      { q: 'How many continents are there?', a: ['5', '6', '7', '8'], c: 2 },
      { q: 'What\'s the largest planet in our solar system?', a: ['Earth', 'Jupiter', 'Saturn', 'Mars'], c: 1 },
      { q: 'Which language runs in the browser?', a: ['Python', 'C++', 'JavaScript', 'Java'], c: 2 },
      { q: 'What does "AI" stand for?', a: ['Auto Input', 'Artificial Intelligence', 'Active Index', 'Applied Iteration'], c: 1 },
      { q: 'How many minutes in a full day?', a: ['1200', '1440', '1600', '2400'], c: 1 },
      { q: 'The speed of light is closest to…', a: ['300 km/s', '3,000 km/s', '300,000 km/s', '30 km/s'], c: 2 },
      { q: 'Which is a NoSQL database?', a: ['MySQL', 'Firestore', 'Postgres', 'SQLite'], c: 1 },
      { q: 'What colour do you get mixing blue and yellow?', a: ['Purple', 'Green', 'Orange', 'Brown'], c: 1 },
    ]);
    this._say('Quiz time — let\'s see! 🧠', 2600); this._emote('idea');
    const render = (msg, done) => {
      this._setBody(this._wrap(`<div class="eg-msg">${msg || Q.q}</div>
        <div class="eg-col">${Q.a.map((opt, i) => `<button class="eg-opt" data-i="${i}" ${done ? 'disabled' : ''}>${opt}</button>`).join('')}</div>`));
      if (!done) this._body.querySelectorAll('[data-i]').forEach(b => b.onclick = () => pick(+b.dataset.i));
      this._wire();
    };
    const pick = (i) => {
      if (i === Q.c) { this._eonWin('Correct! Big brain. 🧠✨'); render(`✅ ${Q.a[Q.c]} — correct!`, true); }
      else { this._youWin(`Nope — it's "${Q.a[Q.c]}". Got you! 😜`); render(`❌ It was "${Q.a[Q.c]}".`, true); }
    };
    render();
  }

  // ================= DOM =================
  _injectStyle() {
    if (document.getElementById('eon-games-style')) return;
    const s = document.createElement('style'); s.id = 'eon-games-style';
    s.textContent = `
      #eon-controls #eon-games-btn { order: 2; }
      #eon-games-menu{position:fixed;right:16px;bottom:50px;z-index:2147483600;width:230px;
        background:#fff;border-radius:14px;border:1.5px solid #1f6dff33;box-shadow:0 16px 44px rgba(16,34,94,.26);
        padding:7px;opacity:0;transform:translateY(8px);pointer-events:none;transition:opacity .18s,transform .18s;font:600 13px system-ui}
      #eon-games-menu.show{opacity:1;transform:none;pointer-events:auto}
      #eon-games-menu .egm-h{font:800 11px system-ui;letter-spacing:.4px;color:#8a96ad;text-transform:uppercase;padding:6px 8px 4px}
      #eon-games-menu button{display:flex;align-items:center;gap:9px;width:100%;border:0;background:transparent;border-radius:9px;
        padding:8px 9px;cursor:pointer;font:600 13px system-ui;color:#16203a;text-align:left}
      #eon-games-menu button:hover{background:#eef3ff}
      #eon-games-menu button .egm-i{font-size:16px}
      #eon-game{position:fixed;right:16px;bottom:50px;z-index:2147483600;width:300px;max-width:calc(100vw - 32px);
        background:#fff;color:#10225e;border-radius:14px;border:1.5px solid #1f6dff33;box-shadow:0 16px 44px rgba(16,34,94,.26);
        opacity:0;transform:translateY(8px);pointer-events:none;transition:opacity .18s,transform .18s;overflow:hidden;font:500 13px system-ui}
      #eon-game.show{opacity:1;transform:none;pointer-events:auto}
      #eon-game .eg-h{display:flex;align-items:center;padding:10px 12px;background:#1f6dff;color:#fff;font-weight:700;font-size:12.5px}
      #eon-game .eg-x{margin-left:auto;cursor:pointer;opacity:.85;font-size:14px}
      #eon-game .eg-b{padding:12px}
      #eon-game .eg-msg{font-weight:600;color:#16203a;margin-bottom:10px;min-height:20px;font-size:13px}
      #eon-game .eg-row{display:flex;gap:8px;justify-content:center}
      #eon-game .eg-wrap{flex-wrap:wrap}
      #eon-game .eg-col{display:flex;flex-direction:column;gap:7px}
      #eon-game .eg-big{flex:1;border:1.5px solid #e2e7f2;border-radius:11px;background:#f7f9ff;cursor:pointer;
        font-size:26px;padding:10px 0;transition:transform .1s,border-color .15s}
      #eon-game .eg-big:hover{transform:translateY(-3px);border-color:#1f6dff}
      #eon-game .eg-opt{border:1.5px solid #e2e7f2;border-radius:10px;background:#f7f9ff;cursor:pointer;padding:9px 11px;font:600 13px system-ui;color:#16203a;text-align:left}
      #eon-game .eg-opt:hover{border-color:#1f6dff;background:#eef3ff}
      #eon-game .eg-opt:disabled{opacity:.7;cursor:default}
      #eon-game .eg-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;max-width:200px;margin:0 auto}
      #eon-game .eg-cell{aspect-ratio:1;border:1.5px solid #e2e7f2;border-radius:10px;background:#f7f9ff;font-size:26px;cursor:pointer;color:#10225e}
      #eon-game .eg-cell:hover:not(:disabled){border-color:#1f6dff}
      #eon-game .eg-cell.on{background:#eef3ff}
      #eon-game .eg-pads{display:grid;grid-template-columns:1fr 1fr;gap:8px;max-width:200px;margin:0 auto}
      #eon-game .eg-pad{font-size:34px;border:0;background:transparent;border-radius:12px;cursor:pointer;padding:6px;opacity:.55;transition:opacity .12s,transform .12s}
      #eon-game .eg-pad.lit{opacity:1;transform:scale(1.12)}
      #eon-game .eg-reflex{width:100%;border:0;border-radius:12px;padding:34px 0;font:800 16px system-ui;color:#fff;cursor:pointer}
      #eon-game .eg-reflex.wait{background:#c0392b}#eon-game .eg-reflex.go{background:#7ed957;color:#10225e}
      #eon-game .eg-reflex.bad{background:#e67e22}#eon-game .eg-reflex.done{background:#1f6dff}
      #eon-game .eg-score{text-align:center;font:600 12px system-ui;color:#52607a;margin-top:12px}
      #eon-game .eg-foot{display:flex;gap:7px;margin-top:10px}
      #eon-game .eg-foot button{flex:1;border:0;border-radius:9px;padding:7px;cursor:pointer;font:700 12px system-ui}
      #eon-game .eg-again{background:#1f6dff;color:#fff}#eon-game .eg-again:hover{background:#1559d8}
      #eon-game .eg-menu{background:#eef1f7;color:#52607a}#eon-game .eg-menu:hover{background:#e2e7f2}`;
    document.head.appendChild(s);
  }
  _buildButton() {
    if (document.getElementById('eon-games-btn')) { this._btn = document.getElementById('eon-games-btn'); return; }
    const b = document.createElement('button');
    b.id = 'eon-games-btn'; b.className = 'eon-chip'; b.title = 'Play a quick game with EON';
    b.textContent = '🎮'; b.style.display = 'none';   // shown for the owner by update()
    b.onclick = (e) => { e.stopPropagation(); this._toggleMenu(); };
    (document.getElementById('eon-controls') || document.body).appendChild(b);
    this._btn = b;
  }
  _buildMenu() {
    if (document.getElementById('eon-games-menu')) { this._menu = document.getElementById('eon-games-menu'); return; }
    const m = document.createElement('div'); m.id = 'eon-games-menu';
    const games = [
      ['rps', '✊', 'Rock · Paper · Scissors'], ['ttt', '⭕', 'Tic-Tac-Toe'],
      ['reflex', '⚡', 'Reflex tap'], ['memory', '🧠', 'Memory'],
      ['bag', '🎒', 'Guess the backpack'], ['trivia', '❓', 'Quick trivia'],
    ];
    m.innerHTML = `<div class="egm-h">🎮 Quick games</div>` +
      games.map(([k, i, l]) => `<button data-g="${k}"><span class="egm-i">${i}</span>${l}</button>`).join('');
    document.body.appendChild(m);
    m.querySelectorAll('[data-g]').forEach(b => b.onclick = (e) => { e.stopPropagation(); this._openGame(b.dataset.g); });
    this._menu = m;
    // click-away closes the menu
    document.addEventListener('pointerdown', (e) => {
      if (!this._menuOpen) return;
      if (e.target.closest && (e.target.closest('#eon-games-menu') || e.target.closest('#eon-games-btn'))) return;
      this._toggleMenu(false);
    }, true);
  }
  _buildPanel() {
    if (document.getElementById('eon-game')) { this._panel = document.getElementById('eon-game'); return; }
    const p = document.createElement('div'); p.id = 'eon-game';
    p.innerHTML = `<div class="eg-h">🎮 <span class="eg-title" style="margin-left:6px">Games</span><span class="eg-x" title="Close">✕</span></div><div class="eg-b"></div>`;
    document.body.appendChild(p);
    this._panel = p; this._body = p.querySelector('.eg-b'); this._titleEl = p.querySelector('.eg-title');
    p.querySelector('.eg-x').onclick = (e) => { e.stopPropagation(); this._closePanel(); this._say(this._pick(['Good reset — ready for the next one? 💪', 'Back to it, boss. You\'ve got this. 🚀', 'Nice break! Let\'s get back to work. ✨']), 3400); this._emote('salute'); };
  }
  _positionPanel() { /* fixed via CSS; nothing to do */ }

  // ---------------- helpers ----------------
  _owner() { try { return !!window.EonBrain?.isOwner?.(); } catch { return false; } }
  _pick(a) { return a[(Math.random() * a.length) | 0]; }
}
