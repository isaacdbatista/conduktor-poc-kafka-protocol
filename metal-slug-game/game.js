'use strict';
// Operação Chumbo Grosso — protótipo de run-and-gun inspirado em Metal Slug.
// Tudo é desenhado proceduralmente no canvas: sem assets externos.

// ===== Configuração =====
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const W = canvas.width, H = canvas.height;
const GROUND = 470;
const GRAVITY = 1800;
const LEVEL_END = 6000;
const BOSS_ARENA = LEVEL_END - W;

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hash = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
// Entidades usam x = centro e y = pés (base).
const hitbox = e => ({ x: e.x - e.w / 2, y: e.y - e.h, w: e.w, h: e.h });
const pointIn = (px, py, b) => px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h;

// ===== Fase =====
const PLATFORMS = [
  { x: 700, y: 380, w: 160 }, { x: 1400, y: 360, w: 200 }, { x: 1650, y: 300, w: 140 },
  { x: 2600, y: 380, w: 220 }, { x: 3500, y: 350, w: 180 }, { x: 3750, y: 290, w: 160 },
  { x: 4600, y: 380, w: 200 },
];

// [posição da borda direita da câmera que dispara a onda, [[tipo, x, y?], ...]]
const SPAWNS = [
  [800, [['soldier', 1000], ['soldier', 1060]]],
  [1300, [['soldier', 1450], ['grenadier', 1500, 360]]],
  [1900, [['soldier', 2050], ['soldier', 2120], ['grenadier', 2200]]],
  [2500, [['soldier', 2650, 380], ['soldier', 2780], ['soldier', 2850]]],
  [3100, [['tank', 3350]]],
  [3500, [['grenadier', 3580, 350], ['soldier', 3800, 290], ['soldier', 3900]]],
  [4200, [['soldier', 4350], ['soldier', 4420], ['grenadier', 4650, 380], ['soldier', 4750]]],
  [4700, [['tank', 4950], ['soldier', 4880]]],
];

// Prisioneiros (POW): [x, item que entregam]
const POWS = [[1200, 'H'], [2350, 'B'], [3300, 'S'], [4450, 'H'], [5300, 'H']];

// ===== Entrada =====
const KEYMAP = {
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
  KeyZ: 'shoot', KeyJ: 'shoot', KeyX: 'jump', KeyK: 'jump', Space: 'jump',
  KeyC: 'grenade', KeyL: 'grenade', Enter: 'start', KeyP: 'pause', Escape: 'pause',
};
const keys = {}, pressed = {};
const TOUCH = matchMedia('(pointer: coarse)').matches;
function press(a) {
  if (!keys[a]) pressed[a] = true;
  keys[a] = true;
  initAudio();
}
function release(a) { keys[a] = false; }
addEventListener('keydown', e => {
  const a = KEYMAP[e.code];
  if (!a) return;
  e.preventDefault();
  press(a);
});
addEventListener('keyup', e => { const a = KEYMAP[e.code]; if (a) release(a); });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

// Controles de toque: direcional analógico + botões (vários dedos ao mesmo tempo).
const dpad = document.getElementById('dpad');
if (dpad) {
  const knob = dpad.querySelector('.dpad-knob');
  const DIRS = ['left', 'right', 'up', 'down'];
  let dpadId = null;
  const setDpad = e => {
    const r = dpad.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    const dead = r.width * 0.15;
    const want = {
      left: dx < -dead, right: dx > dead,
      up: dy < -dead && Math.abs(dy) > Math.abs(dx) * 0.5,
      down: dy > dead && Math.abs(dy) > Math.abs(dx) * 0.5,
    };
    for (const d of DIRS) want[d] ? press(d) : release(d);
    const lim = r.width * 0.3, len = Math.hypot(dx, dy) || 1, k = Math.min(1, lim / len);
    knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
  };
  const endDpad = e => {
    if (e.pointerId !== dpadId) return;
    dpadId = null;
    DIRS.forEach(release);
    knob.style.transform = '';
  };
  dpad.addEventListener('pointerdown', e => {
    e.preventDefault();
    dpadId = e.pointerId;
    dpad.setPointerCapture(e.pointerId);
    setDpad(e);
  });
  dpad.addEventListener('pointermove', e => { if (e.pointerId === dpadId) setDpad(e); });
  dpad.addEventListener('pointerup', endDpad);
  dpad.addEventListener('pointercancel', endDpad);
}
for (const btn of document.querySelectorAll('[data-key]')) {
  const a = btn.dataset.key;
  const up = () => { release(a); btn.classList.remove('on'); };
  btn.addEventListener('pointerdown', e => {
    e.preventDefault();
    btn.setPointerCapture(e.pointerId);
    btn.classList.add('on');
    press(a);
  });
  btn.addEventListener('pointerup', up);
  btn.addEventListener('pointercancel', up);
}
// Tocar no jogo inicia/recomeça a partida.
canvas.addEventListener('pointerdown', () => { if (state !== 'play') press(state === 'pause' ? 'pause' : 'start'); });
canvas.addEventListener('pointerup', () => { release('start'); release('pause'); });
addEventListener('contextmenu', e => { if (TOUCH) e.preventDefault(); });

// ===== Áudio (sintetizado com WebAudio) =====
let actx = null, noiseBuf = null;
function initAudio() {
  if (actx) return;
  try {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    noiseBuf = actx.createBuffer(1, actx.sampleRate * 0.6, actx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch { actx = null; }
}
const SFX = {
  shoot: ['square', 700, 200, 0.06, 0.04],
  hmg: ['sawtooth', 380, 120, 0.05, 0.035],
  enemy: ['square', 300, 150, 0.08, 0.03],
  jump: ['triangle', 300, 650, 0.12, 0.06],
  pickup: ['square', 600, 1400, 0.25, 0.06],
  hurt: ['sawtooth', 500, 50, 0.5, 0.1],
  die: ['triangle', 500, 120, 0.25, 0.06],
  knife: ['triangle', 1200, 300, 0.08, 0.06],
};
function sfx(name) {
  if (!actx) return;
  const t = actx.currentTime, g = actx.createGain();
  g.connect(actx.destination);
  if (name === 'boom') {
    const s = actx.createBufferSource(), f = actx.createBiquadFilter();
    s.buffer = noiseBuf;
    f.type = 'lowpass';
    f.frequency.setValueAtTime(1000, t);
    f.frequency.exponentialRampToValueAtTime(60, t + 0.55);
    s.connect(f); f.connect(g);
    g.gain.setValueAtTime(0.3, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
    s.start(t); s.stop(t + 0.6);
    return;
  }
  const [wave, f1, f2, dur, vol] = SFX[name];
  const o = actx.createOscillator();
  o.type = wave;
  o.connect(g);
  o.frequency.setValueAtTime(f1, t);
  o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.start(t); o.stop(t + dur);
}

// ===== Estado =====
let state = 'title'; // title | play | pause | over | win
let G = null;
let time = 0;

function makePlayer(x) {
  return {
    x, y: GROUND, w: 24, h: 46, vx: 0, vy: 0, onGround: true, facing: 1,
    crouch: false, aimUp: false, walking: false, drop: 0,
    fireCd: 0, knife: 0, weapon: 'pistol', ammo: 0, bombs: 10,
    lives: 3, inv: 2, dead: 0,
  };
}

function makeEnemy(kind, x, y = GROUND) {
  const base = {
    kind, x, y, vx: 0, vy: 0, onGround: false, facing: -1, flash: 0,
    alive: true, deathT: 0, fxT: 0, remove: false, t: rand(0.8, 1.8),
  };
  if (kind === 'soldier' || kind === 'grenadier') {
    return {
      ...base, kind: 'soldier', sub: kind, w: 24, h: 46, hp: 1, score: 100,
      speed: rand(60, 100), range: kind === 'grenadier' ? rand(220, 320) : rand(260, 420), shootAnim: 0,
    };
  }
  if (kind === 'tank') {
    return { ...base, y: GROUND, w: 150, h: 84, hp: 40, maxHp: 40, score: 2000, speed: 60, gunT: 1.5, burst: 0, burstT: 0, tread: 0 };
  }
  // helicóptero (chefe)
  return { ...base, y: 230, w: 220, h: 80, hp: 160, maxHp: 160, score: 10000, bombT: 2, gunT: 3, burst: 0, burstT: 0 };
}

function newGame() {
  G = {
    cam: 0, score: 0, shake: 0, spawnIdx: 0,
    msg: 'MISSÃO 1 — COMEÇAR!', msgT: 2.5,
    player: makePlayer(120),
    enemies: [], bullets: [], grenades: [], explosions: [], particles: [], items: [], popups: [],
    pows: POWS.map(([x, drop]) => ({ x, y: GROUND, w: 26, h: 40, drop, state: 'tied', t: 0 })),
    boss: null, endT: 0,
  };
}

// ===== Física =====
function physics(e, dt) {
  const prevY = e.y;
  e.vy += GRAVITY * dt;
  e.x += e.vx * dt;
  e.y += e.vy * dt;
  e.onGround = false;
  if (e.y >= GROUND) { e.y = GROUND; e.vy = 0; e.onGround = true; return; }
  if (e.vy < 0 || e.drop > 0) return;
  for (const p of PLATFORMS) {
    if (e.x + e.w / 2 > p.x && e.x - e.w / 2 < p.x + p.w && prevY <= p.y && e.y >= p.y) {
      e.y = p.y; e.vy = 0; e.onGround = true; return;
    }
  }
}

// ===== Efeitos =====
function burst(x, y, n, colors, speed = 250, size = 4) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2), s = rand(speed * 0.3, speed);
    G.particles.push({
      x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 100, life: rand(0.3, 0.8), max: 0.8,
      color: colors[(Math.random() * colors.length) | 0], size: rand(size * 0.5, size), grav: 900,
    });
  }
}
function popup(x, y, text, color = '#fff') { G.popups.push({ x, y, text, color, t: 1.2 }); }
function addBlast(x, y, r) {
  G.explosions.push({ x, y, r, t: 0 });
  G.shake = Math.max(G.shake, r / 8);
  burst(x, y, 10, ['#ffd23f', '#ff7b00', '#d62828', '#555'], r * 5, 6);
  sfx('boom');
}
function explode(x, y, r, from) {
  addBlast(x, y, r);
  if (from === 'player') {
    for (const e of G.enemies) {
      if (!e.alive) continue;
      const b = hitbox(e);
      if (Math.hypot(clamp(x, b.x, b.x + b.w) - x, clamp(y, b.y, b.y + b.h) - y) < r) damage(e, 10);
    }
  } else {
    const b = hitbox(G.player);
    if (Math.hypot(clamp(x, b.x, b.x + b.w) - x, clamp(y, b.y, b.y + b.h) - y) < r * 0.75) hurtPlayer();
  }
}

// ===== Combate =====
function damage(e, n) {
  if (!e.alive) return;
  e.hp -= n;
  e.flash = 0.06;
  if (e.hp <= 0) killEnemy(e);
}

function killEnemy(e) {
  e.alive = false;
  G.score += e.score;
  popup(e.x, e.y - e.h - 10, String(e.score), '#ffd23f');
  if (e.kind === 'soldier') {
    e.deathT = 0.8;
    e.vy = -320;
    e.vx = -e.facing * 90;
    e.y -= 1;
    sfx('die');
  } else {
    e.deathT = e.kind === 'heli' ? 2.8 : 1.4;
    e.vy = 0;
    e.vx = e.kind === 'heli' ? -40 : 0;
    G.shake = 12;
    if (e.kind === 'heli') { G.player.inv = 99; G.endT = 5.5; G.msg = 'MISSÃO CUMPRIDA!'; G.msgT = 5; }
  }
}

function hurtPlayer() {
  const p = G.player;
  if (p.dead > 0 || p.inv > 0 || state !== 'play') return;
  p.lives--;
  p.dead = 1.6;
  G.shake = 10;
  sfx('hurt');
  burst(p.x, p.y - 24, 24, ['#d6382f', '#f1c08f', '#3a5bbf', '#ffd23f'], 320, 5);
}

function fireBullet(x, y, angle, speed, from, big = false) {
  G.bullets.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, from, big, life: 1.6 });
}

function lob(x, y, dx, flight, kind) {
  G.grenades.push({
    x, y, vx: clamp(dx / flight, -420, 420), vy: -GRAVITY * flight / 2,
    from: 'enemy', kind, bounces: 1, t: 0, spin: 0,
  });
}

function freePow(w) {
  w.state = 'freed';
  w.t = 1;
  G.score += 100;
  popup(w.x, w.y - 60, 'OBRIGADO!', '#7cf');
  G.items.push({ x: w.x + 24, y: w.y - 30, vx: 0, vy: -300, w: 22, h: 22, kind: w.drop, onGround: false });
  sfx('pickup');
}

// ===== Atualização =====
function update(dt) {
  time += dt;
  if (state === 'title' || state === 'over' || state === 'win') {
    if (pressed.start) { newGame(); state = 'play'; }
    return;
  }
  if (pressed.pause) state = state === 'pause' ? 'play' : 'pause';
  if (state === 'pause') return;

  updatePlayer(dt);
  if (state !== 'play') return;
  updateCamera();
  updateSpawns();
  for (const e of G.enemies) {
    e.flash = Math.max(0, e.flash - dt);
    if (e.kind === 'soldier') updateSoldier(e, dt);
    else if (e.kind === 'tank') updateTank(e, dt);
    else updateHeli(e, dt);
  }
  G.enemies = G.enemies.filter(e => !e.remove && e.x > G.cam - 400);
  updatePows(dt);
  updateBullets(dt);
  updateGrenades(dt);
  updateItems(dt);
  updateFx(dt);

  G.shake = Math.max(0, G.shake - dt * 30);
  G.msgT -= dt;
  if (G.endT > 0) { G.endT -= dt; if (G.endT <= 0) state = 'win'; }
}

function updatePlayer(dt) {
  const p = G.player;
  if (p.dead > 0) {
    p.dead -= dt;
    if (p.dead <= 0) {
      if (p.lives <= 0) { state = 'over'; return; }
      Object.assign(p, {
        x: G.cam + 120, y: 60, vx: 0, vy: 0, inv: 2.5,
        weapon: 'pistol', ammo: 0, bombs: Math.max(p.bombs, 10),
      });
    }
    return;
  }
  p.inv = Math.max(0, p.inv - dt);
  p.drop = Math.max(0, p.drop - dt);
  p.knife = Math.max(0, p.knife - dt);
  p.fireCd -= dt;

  const dir = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  if (dir) p.facing = dir;
  p.crouch = !!keys.down && p.onGround;
  p.aimUp = !!keys.up && !p.crouch;
  p.vx = dir * (p.crouch ? 90 : 230);
  p.walking = dir !== 0 && p.onGround;
  p.h = p.crouch ? 30 : 46;

  if (pressed.jump && p.onGround) {
    if (keys.down && p.y < GROUND) p.drop = 0.25; // desce da plataforma
    else { p.vy = -700; sfx('jump'); }
  }
  physics(p, dt);
  p.x = clamp(p.x, G.cam + 14, G.cam + W - 14);

  if (keys.shoot) tryShoot(p);
  if (pressed.grenade && p.bombs > 0 && G.grenades.filter(g => g.from === 'player').length < 2) {
    p.bombs--;
    G.grenades.push({
      x: p.x + p.facing * 10, y: p.y - p.h + 10, vx: p.facing * 340 + p.vx * 0.3, vy: -560,
      from: 'player', bounces: 0, t: 0, spin: 0,
    });
  }
}

function tryShoot(p) {
  const hmg = p.weapon === 'hmg';
  // A pistola é semi-automática: tocar no botão permite disparar mais rápido do que segurar.
  if (p.fireCd > 0 && !(pressed.shoot && !hmg && p.fireCd < 0.12)) return;

  // Faca: inimigo colado no jogador
  const target = G.enemies.find(e => e.kind === 'soldier' && e.alive &&
    Math.abs(e.x - p.x) < 40 && Math.abs(e.y - p.y) < 30);
  if (target && !p.aimUp) {
    p.knife = 0.2;
    p.fireCd = 0.3;
    killEnemy(target);
    burst(target.x, target.y - 30, 8, ['#fff', '#ccc'], 200, 3);
    sfx('knife');
    return;
  }

  p.fireCd = hmg ? 0.07 : 0.2;
  let dx = p.facing, dy = 0;
  if (p.aimUp) { dx = 0; dy = -1; } else if (!p.onGround && keys.down) { dx = 0; dy = 1; }
  const top = p.y - p.h;
  const mx = dx === 0 ? p.x + p.facing * 6 : p.x + dx * 28;
  const my = dy < 0 ? top - 16 : dy > 0 ? p.y + 10 : top + 20;
  const angle = Math.atan2(dy, dx) + (hmg ? rand(-0.06, 0.06) : 0);
  fireBullet(mx, my, angle, hmg ? 950 : 800, 'player', hmg);
  G.particles.push({ x: mx, y: my, vx: 0, vy: 0, life: 0.05, max: 0.05, color: '#ffe066', size: hmg ? 14 : 10, grav: 0 });
  sfx(hmg ? 'hmg' : 'shoot');
  if (hmg && --p.ammo <= 0) p.weapon = 'pistol';
}

function updateCamera() {
  const p = G.player;
  if (p.dead > 0) return;
  // Como em Metal Slug, a tela trava enquanto um tanque estiver em cena.
  const locked = G.enemies.some(e => e.kind === 'tank' && e.alive && e.x - e.w / 2 < G.cam + W);
  if (!locked) G.cam = clamp(Math.max(G.cam, p.x - W * 0.45), 0, BOSS_ARENA);
}

function updateSpawns() {
  while (G.spawnIdx < SPAWNS.length && G.cam + W >= SPAWNS[G.spawnIdx][0]) {
    for (const [kind, x, y] of SPAWNS[G.spawnIdx][1]) G.enemies.push(makeEnemy(kind, x, y));
    G.spawnIdx++;
  }
  if (!G.boss && G.cam >= BOSS_ARENA - 1) {
    G.boss = makeEnemy('heli', LEVEL_END + 250);
    G.enemies.push(G.boss);
    G.msg = 'ALERTA! HELICÓPTERO INIMIGO';
    G.msgT = 2.5;
  }
}

function updateSoldier(e, dt) {
  const p = G.player;
  if (!e.alive) {
    e.deathT -= dt;
    physics(e, dt);
    if (e.onGround) e.vx = 0;
    if (e.deathT <= 0) e.remove = true;
    return;
  }
  const dx = p.x - e.x, dist = Math.abs(dx);
  e.facing = dx < 0 ? -1 : 1;
  e.vx = dist > e.range ? e.facing * e.speed : dist < 110 ? -e.facing * e.speed * 0.8 : 0;
  e.t -= dt;
  e.shootAnim = Math.max(0, e.shootAnim - dt);
  const onScreen = e.x > G.cam + 10 && e.x < G.cam + W - 10;
  if (e.t <= 0 && onScreen && p.dead <= 0) {
    e.t = rand(1.3, 2.6);
    e.shootAnim = 0.25;
    if (e.sub === 'grenadier') {
      lob(e.x, e.y - 40, dx, 0.9, 'grenade');
    } else {
      const sx = e.x + e.facing * 22, sy = e.y - 26;
      fireBullet(sx, sy, Math.atan2(p.y - p.h / 2 - sy, p.x - sx), 320, 'enemy');
      sfx('enemy');
    }
  }
  physics(e, dt);
}

function updateTank(e, dt) {
  const p = G.player;
  if (!e.alive) { vehicleDeath(e, dt); return; }
  const dx = p.x - e.x, dist = Math.abs(dx);
  e.facing = dx < 0 ? -1 : 1;
  const onScreen = e.x + e.w / 2 < G.cam + W;
  e.vx = !onScreen ? -e.speed : dist > 380 ? e.facing * e.speed : dist < 220 ? -e.facing * e.speed : 0;
  e.x += e.vx * dt;
  e.tread += e.vx * dt;
  if (onScreen) e.x = clamp(e.x, G.cam + e.w / 2, G.cam + W - e.w / 2);
  e.t -= dt;
  e.gunT -= dt;
  if (onScreen && p.dead <= 0) {
    if (e.t <= 0) {
      e.t = rand(2.2, 3.2);
      lob(e.x + e.facing * 60, e.y - 70, dx, 1.0, 'shell');
      sfx('boom');
    }
    if (e.gunT <= 0) { e.gunT = 2.2; e.burst = 4; }
  }
  if (e.burst > 0) {
    e.burstT -= dt;
    if (e.burstT <= 0) {
      e.burst--;
      e.burstT = 0.11;
      const sx = e.x + e.facing * 70, sy = e.y - 40;
      fireBullet(sx, sy, Math.atan2(p.y - p.h / 2 - sy, p.x - sx), 360, 'enemy');
      sfx('enemy');
    }
  }
  if (overlap(hitbox(e), hitbox(p))) hurtPlayer();
}

function updateHeli(e, dt) {
  const p = G.player;
  if (!e.alive) { vehicleDeath(e, dt); return; }
  e.t += dt;
  const fast = e.hp < e.maxHp / 2;
  const tx = BOSS_ARENA + W / 2 + Math.sin(e.t * (fast ? 0.9 : 0.55)) * (W / 2 - 150);
  const oldX = e.x;
  e.x += (tx - e.x) * Math.min(1, dt * 1.5);
  e.vx = (e.x - oldX) / dt;
  e.y = 230 + Math.sin(e.t * 2) * 15;
  e.facing = p.x < e.x ? -1 : 1;
  if (e.x > LEVEL_END - 60 || p.dead > 0) return; // ainda entrando em cena

  e.bombT -= dt;
  if (e.bombT <= 0) {
    e.bombT = fast ? 0.8 : 1.4;
    G.grenades.push({ x: e.x, y: e.y, vx: e.vx * 0.5, vy: 0, from: 'enemy', kind: 'bomb', bounces: 1, t: 0, spin: 0 });
  }
  e.gunT -= dt;
  if (e.gunT <= 0) { e.gunT = fast ? 1.6 : 2.4; e.burst = fast ? 3 : 2; }
  if (e.burst > 0) {
    e.burstT -= dt;
    if (e.burstT <= 0) {
      e.burst--;
      e.burstT = 0.25;
      const sx = e.x + e.facing * 60, sy = e.y - 20;
      const a = Math.atan2(p.y - p.h / 2 - sy, p.x - sx);
      for (const off of [-0.18, 0, 0.18]) fireBullet(sx, sy, a + off, 300, 'enemy');
      sfx('enemy');
    }
  }
}

function vehicleDeath(e, dt) {
  e.deathT -= dt;
  e.fxT -= dt;
  if (e.fxT <= 0) {
    e.fxT = 0.15;
    const b = hitbox(e);
    addBlast(rand(b.x, b.x + b.w), rand(b.y, b.y + b.h), rand(25, 45));
  }
  if (e.kind === 'heli') {
    e.vy += 250 * dt;
    e.x += e.vx * dt;
    e.y = Math.min(GROUND, e.y + e.vy * dt);
  }
  if (e.deathT <= 0) {
    e.remove = true;
    addBlast(e.x, e.y - e.h / 2, 90);
    burst(e.x, e.y - e.h / 2, 40, ['#444', '#666', '#5f7a3a', '#ff7b00'], 500, 8);
    G.shake = 18;
  }
}

function updatePows(dt) {
  const p = G.player;
  for (const w of G.pows) {
    if (w.state === 'tied') {
      if (p.dead <= 0 && overlap(hitbox(w), hitbox(p))) freePow(w);
    } else if (w.state === 'freed') {
      w.t -= dt;
      if (w.t <= 0) w.state = 'run';
    } else {
      w.x -= 220 * dt;
    }
  }
  G.pows = G.pows.filter(w => w.state !== 'run' || w.x > G.cam - 60);
}

function updateBullets(dt) {
  const p = G.player;
  for (const b of G.bullets) {
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.life -= dt;
    if (b.x < G.cam - 50 || b.x > G.cam + W + 50 || b.y < -50 || b.y > GROUND + 2) b.life = 0;
    if (b.life <= 0) continue;
    if (b.from === 'player') {
      for (const e of G.enemies) {
        if (e.alive && pointIn(b.x, b.y, hitbox(e))) {
          damage(e, 1);
          b.life = 0;
          burst(b.x, b.y, 3, ['#fff', '#ffd23f'], 150, 3);
          break;
        }
      }
      if (b.life > 0) {
        const w = G.pows.find(w => w.state === 'tied' && pointIn(b.x, b.y, hitbox(w)));
        if (w) { freePow(w); b.life = 0; }
      }
    } else if (pointIn(b.x, b.y, hitbox(p))) {
      if (p.dead <= 0 && p.inv <= 0) { hurtPlayer(); b.life = 0; }
    }
  }
  G.bullets = G.bullets.filter(b => b.life > 0);
}

function updateGrenades(dt) {
  const p = G.player;
  for (const gr of G.grenades) {
    const prevY = gr.y;
    gr.vy += GRAVITY * dt;
    gr.x += gr.vx * dt;
    gr.y += gr.vy * dt;
    gr.t += dt;
    gr.spin += dt * 14;
    let landed = gr.y >= GROUND;
    if (landed) gr.y = GROUND;
    else if (gr.vy > 0) {
      const plat = PLATFORMS.find(pl => gr.x > pl.x && gr.x < pl.x + pl.w && prevY <= pl.y && gr.y >= pl.y);
      if (plat) { gr.y = plat.y; landed = true; }
    }
    let boom = gr.t > 3;
    if (landed) {
      if (gr.bounces === 0) { gr.bounces++; gr.vy = -260; gr.vx *= 0.6; } else boom = true;
    }
    if (gr.from === 'player') {
      if (G.enemies.some(e => e.alive && pointIn(gr.x, gr.y, hitbox(e)))) boom = true;
    } else if (p.dead <= 0 && pointIn(gr.x, gr.y, hitbox(p))) {
      boom = true;
    }
    if (boom) {
      explode(gr.x, gr.y, gr.from === 'player' ? 75 : gr.kind === 'grenade' ? 55 : 65, gr.from);
      gr.dead = true;
    }
  }
  G.grenades = G.grenades.filter(g => !g.dead);
}

function updateItems(dt) {
  const p = G.player;
  for (const it of G.items) {
    physics(it, dt);
    if (p.dead <= 0 && overlap(hitbox(it), hitbox(p))) {
      it.taken = true;
      sfx('pickup');
      if (it.kind === 'H') {
        p.ammo = p.weapon === 'hmg' ? Math.min(p.ammo + 200, 400) : 200;
        p.weapon = 'hmg';
        popup(p.x, p.y - 70, 'HEAVY MACHINE GUN!', '#ff5');
      } else if (it.kind === 'B') {
        p.bombs += 10;
        popup(p.x, p.y - 70, '+10 BOMBAS', '#ff5');
      } else {
        G.score += 1000;
        popup(p.x, p.y - 70, '1000', '#ffd23f');
      }
    }
  }
  G.items = G.items.filter(it => !it.taken);
}

function updateFx(dt) {
  for (const pt of G.particles) {
    pt.vy += pt.grav * dt;
    pt.x += pt.vx * dt;
    pt.y += pt.vy * dt;
    pt.life -= dt;
  }
  G.particles = G.particles.filter(pt => pt.life > 0);
  for (const ex of G.explosions) ex.t += dt;
  G.explosions = G.explosions.filter(ex => ex.t < 0.45);
  for (const pp of G.popups) { pp.t -= dt; pp.y -= 40 * dt; }
  G.popups = G.popups.filter(pp => pp.t > 0);
}

// ===== Desenho =====
function rect(x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); }

function drawBackground(cam) {
  const sky = ctx.createLinearGradient(0, 0, 0, GROUND);
  sky.addColorStop(0, '#5b8fc7');
  sky.addColorStop(0.6, '#e9b97a');
  sky.addColorStop(1, '#f4d6a0');
  rect(0, 0, W, H, sky);

  ctx.fillStyle = '#fff3c4';
  ctx.beginPath();
  ctx.arc(760, 130, 46, 0, Math.PI * 2);
  ctx.fill();

  // Montanhas (parallax distante)
  const seg = 160, mOff = cam * 0.15;
  ctx.fillStyle = '#b98a5e';
  ctx.beginPath();
  ctx.moveTo(0, GROUND);
  for (let i = Math.floor(mOff / seg) - 1; i * seg - mOff < W + seg; i++) {
    ctx.lineTo(i * seg - mOff, GROUND - 60 - hash(i) * 140);
  }
  ctx.lineTo(W, GROUND);
  ctx.fill();

  // Prédios em ruínas (parallax médio)
  const bSeg = 220, bOff = cam * 0.45;
  for (let i = Math.floor(bOff / bSeg) - 1; i * bSeg - bOff < W + bSeg; i++) {
    if (hash(i + 7) < 0.35) continue;
    const bw = 90 + hash(i + 3) * 70, bh = 80 + hash(i + 5) * 130;
    const bx = i * bSeg - bOff, by = GROUND - bh;
    ctx.fillStyle = '#8a6a4c';
    ctx.beginPath();
    ctx.moveTo(bx, GROUND);
    ctx.lineTo(bx, by + 10);
    ctx.lineTo(bx + bw * 0.3, by);
    ctx.lineTo(bx + bw * 0.45, by + 18);
    ctx.lineTo(bx + bw * 0.7, by + 4);
    ctx.lineTo(bx + bw, by + 22);
    ctx.lineTo(bx + bw, GROUND);
    ctx.fill();
    ctx.fillStyle = '#4a3828';
    for (let wy = by + 30; wy < GROUND - 30; wy += 34) {
      for (let wx = bx + 14; wx < bx + bw - 20; wx += 28) {
        if (hash(wx * 0.1 + wy) > 0.25) ctx.fillRect(wx, wy, 12, 16);
      }
    }
  }

  // Chão
  rect(0, GROUND, W, H - GROUND, '#c99a5b');
  rect(0, GROUND, W, 6, '#8f6a3a');
  for (let i = Math.floor(cam / 60); i * 60 - cam < W; i++) {
    const sx = i * 60 - cam + hash(i) * 40;
    rect(sx, GROUND + 14 + hash(i + 1) * 40, 6 + hash(i + 2) * 10, 4, '#a87c45');
  }
}

function drawPlatforms() {
  for (const p of PLATFORMS) {
    rect(p.x + 10, p.y, 8, GROUND - p.y, '#5a4126');
    rect(p.x + p.w - 18, p.y, 8, GROUND - p.y, '#5a4126');
    rect(p.x, p.y, p.w, 14, '#7a5a35');
    rect(p.x, p.y, p.w, 4, '#a07a48');
    for (let x = p.x + 30; x < p.x + p.w; x += 30) rect(x, p.y + 4, 2, 10, '#5a4126');
  }
  // Sacos de areia decorativos e a barricada do fim da fase
  for (let x = 400; x < LEVEL_END; x += 900) {
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = '#b5a06a';
      ctx.beginPath();
      ctx.ellipse(x + i * 22, GROUND - 8, 13, 8, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  rect(LEVEL_END - 20, GROUND - 160, 20, 160, '#555');
}

const PAL_PLAYER = { pants: '#3a5bbf', shirt: '#d9b27a', vest: '#7a5a2a', hat: '#d6382f', skin: '#f1c08f', boots: '#3a2a1a' };
const PAL_ENEMY = { pants: '#5f7a3a', shirt: '#7f9a4a', vest: '#4a5a2a', hat: '#4f6a2f', skin: '#e0a878', boots: '#2a2a1a' };

function drawSoldier(e, pal, o) {
  ctx.save();
  ctx.translate(Math.round(e.x), Math.round(e.y));
  ctx.scale(e.facing, 1);
  if (o.rot) ctx.rotate(o.rot);
  const walk = o.walking ? Math.sin(time * 18) : 0;
  const top = o.crouch ? -30 : -46;
  if (o.crouch) {
    rect(-12, -12, 24, 12, pal.pants);
    rect(-14, -4, 12, 4, pal.boots);
    rect(4, -4, 12, 4, pal.boots);
  } else {
    rect(-9 + walk * 4, -20, 7, 20, pal.pants);
    rect(2 - walk * 4, -20, 7, 20, pal.pants);
    rect(-10 + walk * 4, -4, 9, 4, pal.boots);
    rect(1 - walk * 4, -4, 9, 4, pal.boots);
  }
  rect(-10, top + 13, 20, 19, pal.shirt);
  rect(-10, top + 16, 20, 8, pal.vest);
  rect(-7, top + 1, 14, 13, pal.skin);
  rect(-8, top - 1, 16, 5, pal.hat);
  if (pal === PAL_PLAYER) rect(-12, top + 1, 5, 3, pal.hat); // pontas da bandana
  rect(3, top + 6, 2, 2, '#111');
  const gunC = '#333', big = o.big;
  if (o.knife) {
    rect(6, top + 18, 18, 3, '#ddd');
  } else if (o.aim === 'up') {
    rect(1, top - (big ? 20 : 14), big ? 7 : 5, big ? 32 : 26, gunC);
    rect(-2, top + 16, 6, 6, pal.skin);
  } else if (o.aim === 'down') {
    rect(-2, top + 20, big ? 7 : 5, big ? 30 : 26, gunC);
  } else if (o.aim !== 'none') {
    rect(4, top + 17, big ? 26 : 20, big ? 7 : 5, gunC);
    if (big) rect(10, top + 24, 6, 5, gunC);
    rect(2, top + 18, 6, 6, pal.skin);
  }
  ctx.restore();
}

function drawPlayer() {
  const p = G.player;
  if (p.dead > 0) return;
  if (p.inv > 0 && Math.floor(time * 20) % 2) return;
  drawSoldier(p, PAL_PLAYER, {
    crouch: p.crouch, walking: p.walking, big: p.weapon === 'hmg', knife: p.knife > 0,
    aim: p.aimUp ? 'up' : (!p.onGround && keys.down) ? 'down' : 'side',
  });
}

function drawEnemy(e) {
  if (e.kind === 'soldier') {
    if (!e.alive && Math.floor(time * 16) % 2) return;
    drawSoldier(e, PAL_ENEMY, {
      walking: e.alive && e.vx !== 0 && e.onGround,
      aim: e.sub === 'grenadier' ? 'none' : 'side',
      rot: e.alive ? 0 : -0.8,
    });
    if (e.sub === 'grenadier' && e.alive) {
      rect(e.x + e.facing * (e.shootAnim > 0 ? 14 : 8) - 4, e.y - 34 - (e.shootAnim > 0 ? 12 : 0), 8, 8, '#3a4a20');
    }
  } else if (e.kind === 'tank') drawTank(e);
  else drawHeli(e);
}

function drawTank(e) {
  const fl = e.flash > 0;
  ctx.save();
  ctx.translate(Math.round(e.x), Math.round(e.y));
  ctx.scale(e.facing, 1);
  rect(-75, -26, 150, 26, '#2b2b2b');
  for (let i = 0; i < 6; i++) {
    const wx = -62 + i * 25;
    ctx.fillStyle = '#555';
    ctx.beginPath();
    ctx.arc(wx, -12, 9, 0, Math.PI * 2);
    ctx.fill();
    rect(wx - 1 + Math.sin(e.tread * 0.1 + i) * 4, -15, 3, 6, '#222');
  }
  rect(-70, -56, 140, 32, fl ? '#fff' : '#6b7b45');
  rect(-70, -56, 140, 6, fl ? '#fff' : '#8a9a5a');
  rect(-36, -82, 64, 28, fl ? '#fff' : '#5a6a38');
  const p = G.player;
  const a = clamp(Math.atan2(p.y - 30 - (e.y - 70), Math.abs(p.x - e.x)), -0.4, 0.3);
  ctx.save();
  ctx.translate(20, -70);
  ctx.rotate(a);
  rect(0, -5, 66, 10, '#3f4a28');
  ctx.restore();
  rect(-20, -76, 10, 8, '#d6c03a');
  ctx.restore();
}

function drawHeli(e) {
  const fl = e.flash > 0;
  ctx.save();
  ctx.translate(Math.round(e.x), Math.round(e.y));
  ctx.scale(e.facing, 1);
  if (!e.alive) ctx.rotate(0.25);
  rect(-150, -58, 90, 10, fl ? '#fff' : '#4f5f30');
  rect(-160, -78, 14, 30, fl ? '#fff' : '#4f5f30');
  ctx.fillStyle = fl ? '#fff' : '#62743a';
  ctx.beginPath();
  ctx.ellipse(0, -45, 75, 32, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#9fd3e8';
  ctx.beginPath();
  ctx.ellipse(40, -50, 28, 18, 0, -Math.PI / 2, Math.PI / 2);
  ctx.fill();
  rect(-40, -10, 90, 4, '#333');
  rect(-30, -14, 4, 8, '#333');
  rect(30, -14, 4, 8, '#333');
  rect(50, -28, 30, 8, '#333');
  rect(-6, -86, 12, 12, '#333');
  const blade = Math.abs(Math.sin(time * 40)) * 130 + 20;
  rect(-blade, -90, blade * 2, 4, '#222');
  const tail = Math.abs(Math.cos(time * 40)) * 18 + 4;
  rect(-155, -66 - tail, 4, tail * 2, '#222');
  ctx.restore();
}

function drawPow(w) {
  const x = Math.round(w.x), y = w.y;
  if (w.state === 'tied') {
    rect(x - 3, y - 70, 6, 70, '#6a4a2a');
    rect(x - 12, y - 20, 24, 20, '#c9b48a');
    rect(x - 11, y - 38, 22, 18, '#e8dcc0');
    rect(x - 7, y - 50, 14, 12, '#f1c08f');
    rect(x - 8, y - 52, 16, 4, '#555');
    rect(x - 12, y - 32, 24, 3, '#a33');
    if (Math.floor(time * 3) % 2) {
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 12px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('HELP!', x, y - 78);
    }
  } else {
    const salute = w.state === 'freed';
    const step = salute ? 0 : Math.sin(time * 20) * 4;
    rect(x - 8 + step, y - 18, 6, 18, '#c9b48a');
    rect(x + 2 - step, y - 18, 6, 18, '#c9b48a');
    rect(x - 10, y - 38, 20, 20, '#e8dcc0');
    rect(x - 7, y - 50, 14, 12, '#f1c08f');
    rect(x - 8, y - 52, 16, 4, '#555');
    if (salute) rect(x - 2, y - 56, 4, 18, '#f1c08f');
  }
}

function drawItem(it) {
  const bob = Math.sin(time * 6) * 2;
  const x = it.x - it.w / 2, y = it.y - it.h + bob;
  rect(x, y, it.w, it.h, it.kind === 'S' ? '#e74c3c' : '#ffd23f');
  rect(x + 2, y + 2, it.w - 4, it.h - 4, it.kind === 'S' ? '#ff7a6a' : '#b0302a');
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 14px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(it.kind === 'S' ? '★' : it.kind, it.x, y + 16);
}

function drawProjectiles() {
  for (const b of G.bullets) {
    if (b.from === 'player') {
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(Math.atan2(b.vy, b.vx));
      rect(-8, -2, b.big ? 16 : 10, b.big ? 4 : 3, '#fff6a0');
      ctx.restore();
    } else {
      ctx.fillStyle = '#ff7b00';
      ctx.beginPath();
      ctx.arc(b.x, b.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  for (const gr of G.grenades) {
    ctx.save();
    ctx.translate(gr.x, gr.y - 4);
    ctx.rotate(gr.spin);
    if (gr.kind === 'shell' || gr.kind === 'bomb') rect(-7, -4, 14, 8, '#333');
    else rect(-4, -5, 8, 10, gr.from === 'player' ? '#2f4f2f' : '#4a3a20');
    ctx.restore();
  }
}

function drawFx() {
  for (const ex of G.explosions) {
    const k = ex.t / 0.45, r = ex.r * (0.5 + k * 0.8);
    ctx.globalAlpha = 1 - k;
    ctx.fillStyle = '#d62828';
    ctx.beginPath(); ctx.arc(ex.x, ex.y, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ff9f1c';
    ctx.beginPath(); ctx.arc(ex.x, ex.y, r * 0.7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff3b0';
    ctx.beginPath(); ctx.arc(ex.x, ex.y, r * 0.35, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  for (const pt of G.particles) {
    ctx.globalAlpha = clamp(pt.life / pt.max * 1.5, 0, 1);
    rect(pt.x - pt.size / 2, pt.y - pt.size / 2, pt.size, pt.size, pt.color);
  }
  ctx.globalAlpha = 1;
  ctx.font = 'bold 16px monospace';
  ctx.textAlign = 'center';
  for (const pp of G.popups) {
    ctx.fillStyle = '#000';
    ctx.fillText(pp.text, pp.x + 2, pp.y + 2);
    ctx.fillStyle = pp.color;
    ctx.fillText(pp.text, pp.x, pp.y);
  }
}

function text(str, x, y, size, color = '#fff', align = 'center') {
  ctx.font = `bold ${size}px monospace`;
  ctx.textAlign = align;
  ctx.fillStyle = '#000';
  ctx.fillText(str, x + 3, y + 3);
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
}

function drawHud() {
  const p = G.player;
  text('1UP', 20, 34, 18, '#ffd23f', 'left');
  text(String(G.score).padStart(7, '0'), 70, 34, 18, '#fff', 'left');
  text('VIDAS ' + (p.lives > 5 ? '♥ x' + p.lives : '♥'.repeat(Math.max(0, p.lives))), 20, 60, 16, '#ff6b6b', 'left');
  rect(W - 230, 14, 210, 52, 'rgba(0,0,0,0.45)');
  text('ARMAS', W - 190, 34, 14, '#ffd23f');
  text(p.weapon === 'hmg' ? String(p.ammo) : '∞', W - 190, 58, 18);
  text('BOMBAS', W - 80, 34, 14, '#ffd23f');
  text(String(p.bombs), W - 80, 58, 18);

  const boss = G.boss;
  if (boss && boss.alive) {
    rect(W / 2 - 200, 80, 400, 14, '#000');
    rect(W / 2 - 198, 82, 396 * boss.hp / boss.maxHp, 10, '#e63946');
    text('HELICÓPTERO', W / 2, 74, 14, '#fff');
  }
  if (G.msgT > 0) text(G.msg, W / 2, 200, 34, '#ffd23f');

  const enemiesOnScreen = G.enemies.some(e => e.alive && e.x < G.cam + W);
  if (!enemiesOnScreen && !G.boss && G.cam < BOSS_ARENA && Math.floor(time * 2.5) % 2) {
    text('GO! ➜', W - 90, 260, 30, '#ffd23f');
  }
}

function drawOverlay(title, sub, color) {
  rect(0, 0, W, H, 'rgba(0,0,0,0.55)');
  text(title, W / 2, H / 2 - 30, 52, color);
  if (Math.floor(time * 2) % 2) text(sub, W / 2, H / 2 + 40, 20);
}

function draw() {
  if (state === 'title') {
    drawBackground(time * 40);
    rect(0, 0, W, H, 'rgba(0,0,0,0.35)');
    text('OPERAÇÃO', W / 2, 150, 44, '#fff');
    text('CHUMBO GROSSO', W / 2, 215, 64, '#ffd23f');
    text('um teste inspirado em Metal Slug', W / 2, 260, 18, '#ddd');
    text(TOUCH ? 'direcional: mover, mirar e agachar · TIRO · PULO · BOMBA'
      : '← → mover   ↑ mirar   ↓ agachar   Z atirar   X pular   C granada', W / 2, 340, 16, '#ccc');
    text('Liberte os prisioneiros para ganhar armas e bombas!', W / 2, 370, 16, '#7cf');
    if (Math.floor(time * 2) % 2) text(TOUCH ? 'TOQUE PARA COMEÇAR' : 'APERTE ENTER', W / 2, 440, 26, '#fff');
    return;
  }

  const s = G.shake;
  drawBackground(G.cam);
  ctx.save();
  ctx.translate(-Math.round(G.cam) + rand(-s, s), rand(-s, s));
  drawPlatforms();
  for (const w of G.pows) drawPow(w);
  for (const it of G.items) drawItem(it);
  for (const e of G.enemies) drawEnemy(e);
  drawPlayer();
  drawProjectiles();
  drawFx();
  ctx.restore();
  drawHud();

  if (state === 'pause') drawOverlay('PAUSA', TOUCH ? 'toque para continuar' : 'aperte P para continuar', '#fff');
  if (state === 'over') drawOverlay('GAME OVER', `pontos: ${G.score} — ${TOUCH ? 'toque' : 'ENTER'} para recomeçar`, '#e63946');
  if (state === 'win') drawOverlay('VITÓRIA!', `pontos: ${G.score} — ${TOUCH ? 'toque' : 'ENTER'} para jogar de novo`, '#ffd23f');
}

// ===== Loop principal =====
let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 1 / 30);
  last = now;
  update(dt);
  draw();
  for (const k in pressed) pressed[k] = false;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
