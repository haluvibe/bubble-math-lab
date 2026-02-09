import { useState, useEffect, useCallback, useRef } from 'react';

/*
  ⚡ MATHSTORM: NUMBER SQUADRON ⚡

  A vertical scrolling shooter where your weapons are math operations.
  Blast enemies to transform your Power Number, then match boss shields!

  World 1-2: Addition (+) and Subtraction (−)

  Controls:
  - Arrow Keys / WASD: Move ship
  - Space / Z: Shoot
  - 1/2: Switch weapon (+, −)
  - Q/E: Cycle weapons
  - Mouse: Move + Click to shoot
*/

// =============== CONSTANTS ===============
const SHIP_SPEED = 5;
const SHOOT_COOLDOWNS = [130, 200];
const MAX_POWER = 99;
const MIN_POWER = 1;

const WEAPONS = [
  { id: 'add', symbol: '+', name: 'ADD', color: '#4ade80', glow: 'rgba(74,222,128,0.5)', bulletSpeed: 9, shotStyle: 'rapid' },
  { id: 'sub', symbol: '−', name: 'SUB', color: '#fb923c', glow: 'rgba(251,146,60,0.5)', bulletSpeed: 7, shotStyle: 'homing' },
];

// Boss configs per world
const WORLD_BOSSES = [
  { hp: 2, targets: [5, 8] },
  { hp: 3, targets: [8, 10, 6] },
  { hp: 5, targets: [12, 15, 7, 20, 10] },
];

// Continuous spawn: random interval between 0.1s and 2.0s (~6–120 frames at 60fps)
const SPAWN_INTERVAL_MIN = 6;
const SPAWN_INTERVAL_MAX = 120;
const ENEMIES_PER_BOSS = 3;

// =============== UTILITIES ===============
let _idCounter = 0;
const nextId = () => ++_idCounter;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, t) => a + (b - a) * t;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const rand = (lo, hi) => lo + Math.random() * (hi - lo);
const randInt = (lo, hi) => Math.floor(rand(lo, hi + 1));

function applyOp(power, opIndex, value) {
  if (opIndex === 0) return clamp(power + value, MIN_POWER, MAX_POWER);
  if (opIndex === 1) return clamp(power - value, MIN_POWER, MAX_POWER);
  return power;
}

function opSymbol(i) { return ['+', '\u2212'][i] || '?'; }

// =============== MAIN COMPONENT ===============
export default function MathStorm() {
  const [screen, setScreen] = useState('intro');
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const animRef = useRef(null);
  const gRef = useRef(null);
  const keysRef = useRef({});
  const mouseRef = useRef({ x: 0, y: 0, down: false, active: false });
  const prevTimeRef = useRef(0);

  // HUD state (updated periodically from game loop)
  const [hud, setHud] = useState({
    score: 0, lives: 3, power: 1, weapon: 0,
    world: 1, combo: 0, bossHP: 0, bossMaxHP: 0,
    bossTarget: 0, bossActive: false, powerMatch: false,
    msg: '', msgTimer: 0,
  });

  // ========== INIT ==========
  const initGame = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const W = wrap.clientWidth;
    const H = wrap.clientHeight;
    const cvs = canvasRef.current;
    cvs.width = W;
    cvs.height = H;

    // Starfield
    const stars = [];
    for (let layer = 0; layer < 3; layer++) {
      for (let i = 0; i < 35; i++) {
        stars.push({
          x: Math.random() * W, y: Math.random() * H,
          speed: (layer + 1) * 0.4,
          size: 0.4 + layer * 0.6,
          bright: 0.15 + layer * 0.25,
        });
      }
    }

    _idCounter = 0;

    gRef.current = {
      W, H, stars,
      ship: { x: W / 2, y: H - 90, invTimer: 0, flashTimer: 0 },
      bullets: [],
      enemies: [],
      eBullets: [],
      particles: [],
      texts: [],
      score: 0, lives: 3, power: 1, weapon: 0,
      worldIdx: 0,
      spawnCooldown: 60, enemiesSpawned: 0, nextBossAt: ENEMIES_PER_BOSS,
      shootTimer: 0, combo: 0, comboTimer: 0,
      boss: null,
      shake: 0, slowmo: 0,
      time: 0, hudTick: 0,
    };

    setHud({
      score: 0, lives: 3, power: 1, weapon: 0,
      world: 1, combo: 0, bossHP: 0, bossMaxHP: 0,
      bossTarget: 0, bossActive: false, powerMatch: false,
      msg: 'GET READY!', msgTimer: 80,
    });
  }, []);

  // ========== SPAWN SINGLE ENEMY ==========
  function spawnEnemy(g) {
    const diff = Math.min(g.enemiesSpawned / 20, 8);
    const minVal = 1;
    const maxVal = Math.min(3 + Math.floor(diff), 9);
    const val = randInt(minVal, maxVal);
    const speed = 1.2 + diff * 0.06;
    const shootRate = Math.max(80, 250 - diff * 15);
    const moveTypes = ['line', 'zigzag', 'stream', 'v'];

    g.enemies.push({
      id: nextId(),
      x: rand(50, g.W - 50),
      y: -35,
      value: val,
      hp: val > 7 ? 2 : 1,
      maxHP: val > 7 ? 2 : 1,
      speed: speed + Math.random() * 0.3,
      w: 34, h: 34, hitFlash: 0,
      moveType: moveTypes[randInt(0, 3)],
      moveT: Math.random() * Math.PI * 2,
      shootTimer: 80 + Math.random() * shootRate,
      shootRate: shootRate,
    });
    g.enemiesSpawned++;
  }

  // ========== GAME LOOP ==========
  useEffect(() => {
    if (screen !== 'playing') {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      return;
    }
    initGame();
    prevTimeRef.current = performance.now();

    const tick = (now) => {
      const raw = (now - prevTimeRef.current) / 16.667;
      prevTimeRef.current = now;
      const dt = Math.min(raw, 3);
      update(dt);
      draw();
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [screen, initGame]);

  // ========== UPDATE ==========
  function update(dt) {
    const g = gRef.current;
    if (!g) return;
    g.time += dt;
    if (g.shake > 0) { g.shake *= 0.88; if (g.shake < 0.3) g.shake = 0; }
    if (g.comboTimer > 0) { g.comboTimer -= dt; if (g.comboTimer <= 0) g.combo = 0; }

    // ---- ship ----
    const k = keysRef.current;
    const m = mouseRef.current;
    const s = g.ship;
    let dx = 0, dy = 0;
    if (k['ArrowLeft'] || k['a'] || k['A']) dx -= 1;
    if (k['ArrowRight'] || k['d'] || k['D']) dx += 1;
    if (k['ArrowUp'] || k['w'] || k['W']) dy -= 1;
    if (k['ArrowDown'] || k['s'] || k['S']) dy += 1;
    if (dx && dy) { dx *= 0.707; dy *= 0.707; }
    if (m.active && m.down) {
      const md = Math.hypot(m.x - s.x, m.y - s.y);
      if (md > 8) { dx = (m.x - s.x) / md; dy = (m.y - s.y) / md; }
    }
    s.x = clamp(s.x + dx * SHIP_SPEED * dt, 24, g.W - 24);
    s.y = clamp(s.y + dy * SHIP_SPEED * dt, 60, g.H - 40);
    if (s.invTimer > 0) s.invTimer -= dt;
    if (s.flashTimer > 0) s.flashTimer -= dt;

    // ---- weapon switch ----
    if (k['1']) g.weapon = 0;
    if (k['2']) g.weapon = 1;
    if (k['q'] || k['Q']) { k['q'] = k['Q'] = false; g.weapon = (g.weapon + WEAPONS.length - 1) % WEAPONS.length; }
    if (k['e'] || k['E']) { k['e'] = k['E'] = false; g.weapon = (g.weapon + 1) % WEAPONS.length; }

    // ---- shooting ----
    g.shootTimer -= dt * 16.667;
    const firing = k[' '] || k['z'] || k['Z'] || m.down;
    if (firing && g.shootTimer <= 0) {
      g.shootTimer = SHOOT_COOLDOWNS[g.weapon];
      const w = WEAPONS[g.weapon];
      if (g.weapon === 0) {
        g.bullets.push({ id: nextId(), x: s.x, y: s.y - 22, vx: 0, vy: -w.bulletSpeed, wep: 0, sz: 4, alive: true });
      } else {
        g.bullets.push({ id: nextId(), x: s.x - 8, y: s.y - 16, vx: -0.6, vy: -w.bulletSpeed, wep: 1, sz: 5, alive: true, homing: true });
        g.bullets.push({ id: nextId(), x: s.x + 8, y: s.y - 16, vx: 0.6, vy: -w.bulletSpeed, wep: 1, sz: 5, alive: true, homing: true });
      }
    }

    // ---- bullets ----
    g.bullets = g.bullets.filter(b => {
      if (!b.alive) return false;
      if (b.homing && g.enemies.length > 0) {
        let best = null, bestD = 280;
        for (const e of g.enemies) { const d = dist(b, e); if (d < bestD) { bestD = d; best = e; } }
        if (best) {
          const a = Math.atan2(best.y - b.y, best.x - b.x);
          b.vx += Math.cos(a) * 0.35 * dt;
          b.vy += Math.sin(a) * 0.35 * dt;
          const spd = Math.hypot(b.vx, b.vy);
          if (spd > 0.01) {
            const want = WEAPONS[1].bulletSpeed;
            b.vx = (b.vx / spd) * want;
            b.vy = (b.vy / spd) * want;
          }
        }
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      return b.x > -30 && b.x < g.W + 30 && b.y > -30 && b.y < g.H + 30;
    });

    // ---- continuous enemy spawning ----
    g.spawnCooldown -= dt;
    if (g.spawnCooldown <= 0) {
      g.spawnCooldown = rand(SPAWN_INTERVAL_MIN, SPAWN_INTERVAL_MAX);
      spawnEnemy(g);

      // Spawn boss after enough enemies, if no boss active
      if (g.enemiesSpawned >= g.nextBossAt && !g.boss) {
        const bossIdx = g.worldIdx % WORLD_BOSSES.length;
        const bossCfg = WORLD_BOSSES[bossIdx];
        const loopCount = Math.floor(g.worldIdx / WORLD_BOSSES.length);
        const hp = bossCfg.hp + loopCount * 2;
        g.boss = {
          x: g.W / 2, y: -100, targetY: 110,
          w: 130, h: 90, hp, maxHP: hp,
          targets: [...bossCfg.targets], targetIdx: 0,
          target: bossCfg.targets[0],
          phase: 'enter', shootTimer: 120, hitFlash: 0, angle: 0,
        };
        g.texts.push({ x: g.W / 2, y: g.H / 2 - 50, text: `WORLD ${g.worldIdx + 1}`, color: '#ffd700', life: 120, maxL: 120, vy: 0, sz: 48 });
        g.texts.push({ x: g.W / 2, y: g.H / 2 + 10, text: `Boss Shield: ${bossCfg.targets[0]}`, color: '#ef4444', life: 100, maxL: 100, vy: 0, sz: 22 });
      }
    }

    // ---- enemies ----
    g.enemies = g.enemies.filter(e => {
      e.moveT += dt * 0.05;
      e.y += e.speed * dt;
      if (e.moveType === 'v' || e.moveType === 'zigzag') e.x += Math.sin(e.moveT * 3) * 1.8 * dt;
      if (e.moveType === 'stream') e.x += Math.cos(e.moveT * 2) * 2.2 * dt;
      e.x = clamp(e.x, 20, g.W - 20);

      // e.shootTimer -= dt;
      // if (e.shootTimer <= 0 && e.y > 60 && e.y < g.H - 180 && e.shootRate > 0) {
      //   e.shootTimer = e.shootRate + Math.random() * 80;
      //   const a = Math.atan2(s.y - e.y, s.x - e.x);
      //   g.eBullets.push({ id: nextId(), x: e.x, y: e.y, vx: Math.cos(a) * 2.8, vy: Math.sin(a) * 2.8, sz: 4 });
      // }
      if (e.hitFlash > 0) e.hitFlash -= dt;
      return e.y < g.H + 50;
    });

    // ---- boss ----
    if (g.boss) {
      const b = g.boss;
      b.angle += dt * 0.02;
      if (b.phase === 'enter') {
        b.y += (b.targetY - b.y) * 0.04 * dt;
        if (Math.abs(b.y - b.targetY) < 3) { b.y = b.targetY; b.phase = 'fight'; }
      } else if (b.phase === 'fight') {
        b.x = g.W / 2 + Math.sin(b.angle) * (g.W * 0.25);
        b.shootTimer -= dt;
        if (b.shootTimer <= 0) {
          b.shootTimer = 55 + Math.random() * 25;
          const base = Math.atan2(s.y - b.y, s.x - b.x);
          for (let i = -1; i <= 1; i++) {
            const a = base + i * 0.28;
            g.eBullets.push({ id: nextId(), x: b.x, y: b.y + b.h / 2, vx: Math.cos(a) * 3.2, vy: Math.sin(a) * 3.2, sz: 6, boss: true });
          }
        }
      } else if (b.phase === 'dying') {
        b.hitFlash += dt;
        if (b.hitFlash > 50) {
          for (let i = 0; i < 35; i++) {
            g.particles.push({ x: b.x + rand(-60, 60), y: b.y + rand(-50, 50), vx: rand(-6, 6), vy: rand(-6, 6), life: 30 + Math.random() * 30, maxL: 60, color: ['#ff6b6b', '#ffd93d', '#ff8a5c', '#fff'][randInt(0, 3)], sz: 3 + Math.random() * 7 });
          }
          const pts = 500 * (g.worldIdx + 1);
          g.score += pts;
          g.shake = 18;
          g.texts.push({ x: b.x, y: b.y, text: `BOSS DEFEATED! +${pts}`, color: '#ffd700', life: 100, maxL: 100, vy: -1, sz: 22 });
          g.boss = null;
          g.worldIdx++;
          g.nextBossAt = g.enemiesSpawned + ENEMIES_PER_BOSS + g.worldIdx * 5;
          g.texts.push({ x: g.W / 2, y: g.H / 2, text: 'WORLD COMPLETE!', color: '#4ade80', life: 120, maxL: 120, vy: -0.5, sz: 36 });
        }
      }
      if (b && b.hitFlash > 0 && b.phase !== 'dying') b.hitFlash -= dt;
    }

    // ---- enemy bullets ----
    g.eBullets = g.eBullets.filter(b => {
      b.x += b.vx * dt; b.y += b.vy * dt;
      return b.x > -20 && b.x < g.W + 20 && b.y > -20 && b.y < g.H + 20;
    });

    // ---- collisions: player bullets vs enemies ----
    for (let bi = g.bullets.length - 1; bi >= 0; bi--) {
      const bul = g.bullets[bi];
      if (!bul.alive) continue;

      for (let ei = g.enemies.length - 1; ei >= 0; ei--) {
        const en = g.enemies[ei];
        if (dist(bul, en) < en.w / 2 + bul.sz + 4) {
          const oldP = g.power;
          const newP = applyOp(g.power, bul.wep, en.value);
          if (newP !== oldP) {
            g.power = newP;
            g.shake = Math.min(g.shake + 6, 15);
          } else {
            g.power = newP;
          }

          g.texts.push({ x: en.x, y: en.y - 28, text: `${oldP} ${opSymbol(bul.wep)} ${en.value} = ${newP}`, color: WEAPONS[bul.wep].color, life: 55, maxL: 55, vy: -1.6, sz: 17 });
          en.hp -= 1;
          en.hitFlash = 8;
          g.combo++;
          g.comboTimer = 100;

          if (en.hp <= 0) {
            const base = en.value * 10;
            const bonus = Math.floor(base * g.combo * 0.1);
            g.score += base + bonus;
            for (let p = 0; p < 10; p++) {
              g.particles.push({ x: en.x + rand(-12, 12), y: en.y + rand(-12, 12), vx: rand(-4, 4), vy: rand(-4, 4), life: 18 + Math.random() * 14, maxL: 32, color: WEAPONS[bul.wep].color, sz: 2 + Math.random() * 4 });
            }
            g.shake = Math.min(g.shake + 3, 10);
            g.enemies.splice(ei, 1);
          }
          bul.alive = false;
          break;
        }
      }

      // player bullets vs boss
      if (bul.alive && g.boss && g.boss.phase === 'fight') {
        const bo = g.boss;
        if (dist(bul, bo) < bo.w / 2 + bul.sz) {
          if (g.power === bo.target) {
            bo.hp--;
            bo.hitFlash = 15;
            g.shake = 10;
            g.texts.push({ x: bo.x, y: bo.y - 55, text: 'SHIELD BREAK!', color: '#ffd700', life: 60, maxL: 60, vy: -2, sz: 20 });
            for (let p = 0; p < 18; p++) {
              g.particles.push({ x: bo.x + rand(-45, 45), y: bo.y + rand(-35, 35), vx: rand(-5, 5), vy: rand(-5, 5), life: 22 + Math.random() * 18, maxL: 40, color: '#ffd700', sz: 3 + Math.random() * 5 });
            }
            if (bo.hp <= 0) {
              bo.phase = 'dying';
              bo.hitFlash = 0;
            } else {
              bo.targetIdx++;
              bo.target = bo.targets[bo.targetIdx % bo.targets.length];
              g.texts.push({ x: bo.x, y: bo.y + 25, text: `New shield: ${bo.target}`, color: '#38bdf8', life: 80, maxL: 80, vy: -0.5, sz: 15 });
            }
          } else {
            bo.hitFlash = 4;
            g.texts.push({ x: bo.x, y: bo.y - 45, text: `Need ${bo.target}!  You: ${g.power}`, color: '#94a3b8', life: 40, maxL: 40, vy: -1, sz: 13 });
            for (let p = 0; p < 4; p++) {
              g.particles.push({ x: bul.x, y: bul.y, vx: rand(-3, 3), vy: rand(1, 4), life: 12, maxL: 12, color: '#64748b', sz: 2 });
            }
          }
          bul.alive = false;
        }
      }
    }
    g.bullets = g.bullets.filter(b => b.alive);

    // ---- collisions: enemy bullets / enemies vs player ----
    if (s.invTimer <= 0) {
      for (let i = g.eBullets.length - 1; i >= 0; i--) {
        if (dist(g.eBullets[i], s) < 16 + g.eBullets[i].sz) {
          hitPlayer(g);
          g.eBullets.splice(i, 1);
          break;
        }
      }
      if (s.invTimer <= 0) {
        for (const en of g.enemies) {
          if (dist(en, s) < en.w / 2 + 14) { hitPlayer(g); break; }
        }
      }
    }

    // ---- particles ----
    g.particles = g.particles.filter(p => { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.97; p.vy *= 0.97; p.life -= dt; return p.life > 0; });

    // ---- text effects ----
    g.texts = g.texts.filter(t => { t.y += (t.vy || 0) * dt; t.life -= dt; return t.life > 0; });

    // ---- stars ----
    for (const st of g.stars) { st.y += st.speed * dt; if (st.y > g.H) { st.y = -2; st.x = Math.random() * g.W; } }

    // ---- hud update ----
    g.hudTick += dt;
    if (g.hudTick > 3) {
      g.hudTick = 0;
      setHud({
        score: g.score, lives: g.lives, power: g.power, weapon: g.weapon,
        world: g.worldIdx + 1, combo: g.combo,
        bossHP: g.boss?.hp || 0, bossMaxHP: g.boss?.maxHP || 0,
        bossTarget: g.boss?.target || 0, bossActive: !!g.boss,
        powerMatch: !!(g.boss && g.boss.phase === 'fight' && g.power === g.boss.target),
        msg: '', msgTimer: 0,
      });
    }

    // ---- game over ----
    if (g.lives <= 0) setScreen('gameover');
  }

  function hitPlayer(g) {
    g.lives--;
    g.ship.invTimer = 120;
    g.ship.flashTimer = 120;
    g.shake = 14;
    for (let p = 0; p < 14; p++) {
      g.particles.push({ x: g.ship.x + rand(-14, 14), y: g.ship.y + rand(-14, 14), vx: rand(-5, 5), vy: rand(-5, 5), life: 18 + Math.random() * 14, maxL: 32, color: '#ff6b6b', sz: 2 + Math.random() * 4 });
    }
  }

  // ========== DRAW ==========
  function draw() {
    const g = gRef.current;
    const cvs = canvasRef.current;
    if (!g || !cvs) return;
    const ctx = cvs.getContext('2d');
    if (!ctx) return;
    const { W, H } = g;

    const sx = g.shake > 0 ? (Math.random() - 0.5) * g.shake : 0;
    const sy = g.shake > 0 ? (Math.random() - 0.5) * g.shake : 0;
    ctx.save();
    ctx.translate(sx, sy);

    // bg
    ctx.fillStyle = '#070b14';
    ctx.fillRect(-10, -10, W + 20, H + 20);

    // stars
    for (const st of g.stars) {
      ctx.globalAlpha = st.bright;
      ctx.fillStyle = '#c8d6e5';
      ctx.beginPath();
      ctx.arc(st.x, st.y, st.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // enemies
    for (const e of g.enemies) {
      ctx.save();
      ctx.translate(e.x, e.y);
      // glow
      const hue = (e.value * 30) % 360;
      const gc = e.hitFlash > 0 ? 'rgba(255,120,120,0.5)' : `hsla(${hue},70%,50%,0.25)`;
      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, e.w);
      grad.addColorStop(0, gc);
      grad.addColorStop(1, 'transparent');
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(0, 0, e.w, 0, Math.PI * 2); ctx.fill();

      // body hex
      ctx.fillStyle = e.hitFlash > 0 ? '#ff6b6b' : `hsl(${hue},55%,35%)`;
      ctx.strokeStyle = e.hitFlash > 0 ? '#fff' : `hsl(${hue},65%,55%)`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
        const r = e.w / 2;
        i === 0 ? ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r) : ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();

      // number
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 15px Nunito, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(e.value, 0, 1);

      // hp bar
      if (e.maxHP > 1) {
        const ratio = e.hp / e.maxHP;
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(-e.w / 2, e.w / 2 + 3, e.w, 3);
        ctx.fillStyle = ratio > 0.5 ? '#4ade80' : '#ef4444';
        ctx.fillRect(-e.w / 2, e.w / 2 + 3, e.w * ratio, 3);
      }
      ctx.restore();
    }

    // boss
    if (g.boss) {
      const b = g.boss;
      const powerMatch = g.power === b.target && b.phase === 'fight';
      ctx.save();
      ctx.translate(b.x, b.y);

      // Entering phase — slight transparency
      if (b.phase === 'enter') ctx.globalAlpha = 0.7;

      // Power match pulsing glow
      if (powerMatch) {
        const pulseSize = b.w * 1.3 + Math.sin(g.time * 0.15) * 15;
        const matchGrad = ctx.createRadialGradient(0, 0, b.w * 0.3, 0, 0, pulseSize);
        matchGrad.addColorStop(0, 'rgba(255,215,0,0.5)');
        matchGrad.addColorStop(0.6, 'rgba(255,215,0,0.15)');
        matchGrad.addColorStop(1, 'transparent');
        ctx.fillStyle = matchGrad;
        ctx.beginPath(); ctx.arc(0, 0, pulseSize, 0, Math.PI * 2); ctx.fill();
      }

      // glow
      const bgc = b.hitFlash > 0 ? 'rgba(255,215,0,0.45)' : powerMatch ? 'rgba(255,215,0,0.35)' : 'rgba(220,38,38,0.25)';
      const bg = ctx.createRadialGradient(0, 0, 0, 0, 0, b.w);
      bg.addColorStop(0, bgc); bg.addColorStop(1, 'transparent');
      ctx.fillStyle = bg;
      ctx.beginPath(); ctx.arc(0, 0, b.w, 0, Math.PI * 2); ctx.fill();

      // body octagon
      ctx.fillStyle = b.hitFlash > 0 ? '#ffd700' : powerMatch ? '#b45309' : '#b91c1c';
      ctx.strokeStyle = b.hitFlash > 0 ? '#fff' : powerMatch ? '#ffd700' : '#ef4444';
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
        const r = b.w / 2;
        i === 0 ? ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r) : ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();

      // inner ring
      ctx.strokeStyle = powerMatch ? 'rgba(255,215,0,0.5)' : 'rgba(255,255,255,0.2)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, b.w / 3, 0, Math.PI * 2); ctx.stroke();

      // shield number
      ctx.fillStyle = powerMatch ? '#ffd700' : '#fff';
      ctx.font = 'bold 26px Nunito, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(b.target, 0, -3);
      ctx.fillStyle = powerMatch ? '#ffd700' : '#94a3b8';
      ctx.font = 'bold 10px Nunito, sans-serif';
      ctx.fillText(powerMatch ? 'HIT ME!' : 'SHIELD', 0, 18);

      // hp bar
      const bw = b.w * 0.8, bh = 7, by = b.h / 2 + 12;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(-bw / 2, by, bw, bh);
      const hr = b.hp / b.maxHP;
      ctx.fillStyle = hr > 0.5 ? '#4ade80' : hr > 0.25 ? '#fbbf24' : '#ef4444';
      ctx.fillRect(-bw / 2, by, bw * hr, bh);

      // Vulnerable text above boss
      if (powerMatch) {
        ctx.fillStyle = '#ffd700';
        ctx.font = 'bold 12px Orbitron, sans-serif';
        ctx.fillText('\u26A1 VULNERABLE \u26A1', 0, -b.h / 2 - 18);
      }

      ctx.globalAlpha = 1;
      ctx.restore();
    }

    // bullets
    for (const b of g.bullets) {
      const w = WEAPONS[b.wep];
      ctx.save();
      ctx.translate(b.x, b.y);
      // glow
      const bg = ctx.createRadialGradient(0, 0, 0, 0, 0, b.sz * 3);
      bg.addColorStop(0, w.glow); bg.addColorStop(1, 'transparent');
      ctx.fillStyle = bg;
      ctx.beginPath(); ctx.arc(0, 0, b.sz * 3, 0, Math.PI * 2); ctx.fill();

      ctx.fillStyle = w.color;
      ctx.shadowColor = w.color;
      ctx.shadowBlur = 8;
      if (b.wep === 0) {
        ctx.beginPath(); ctx.arc(0, 0, b.sz, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.beginPath();
        ctx.moveTo(0, -b.sz * 1.5);
        ctx.lineTo(-b.sz, b.sz);
        ctx.lineTo(b.sz, b.sz);
        ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    }

    // enemy bullets
    for (const b of g.eBullets) {
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.fillStyle = b.boss ? '#ff6b6b' : '#fbbf24';
      ctx.shadowColor = b.boss ? '#ff0000' : '#fbbf24';
      ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.arc(0, 0, b.sz, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    // ship
    const sh = g.ship;
    if (!(sh.flashTimer > 0 && Math.floor(sh.flashTimer) % 6 < 3)) {
      ctx.save();
      ctx.translate(sh.x, sh.y);
      const wc = WEAPONS[g.weapon];

      // thruster
      const tg = ctx.createRadialGradient(0, 20, 0, 0, 20, 22);
      tg.addColorStop(0, 'rgba(255,200,50,0.8)');
      tg.addColorStop(0.6, 'rgba(255,100,30,0.3)');
      tg.addColorStop(1, 'transparent');
      ctx.fillStyle = tg;
      ctx.beginPath(); ctx.arc(0, 18 + Math.random() * 5, 22, 0, Math.PI * 2); ctx.fill();

      // body glow
      const sg = ctx.createRadialGradient(0, 0, 0, 0, 0, 40);
      sg.addColorStop(0, wc.glow); sg.addColorStop(1, 'transparent');
      ctx.fillStyle = sg;
      ctx.beginPath(); ctx.arc(0, 0, 40, 0, Math.PI * 2); ctx.fill();

      // body
      ctx.fillStyle = '#e2e8f0';
      ctx.strokeStyle = wc.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, -22);
      ctx.lineTo(-12, -5);
      ctx.lineTo(-18, 15);
      ctx.lineTo(-8, 10);
      ctx.lineTo(-6, 18);
      ctx.lineTo(6, 18);
      ctx.lineTo(8, 10);
      ctx.lineTo(18, 15);
      ctx.lineTo(12, -5);
      ctx.closePath();
      ctx.fill(); ctx.stroke();

      // cockpit
      ctx.fillStyle = wc.color;
      ctx.beginPath();
      ctx.ellipse(0, -8, 4, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // particles
    for (const p of g.particles) {
      const a = p.life / p.maxL;
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.sz * a, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // text effects
    for (const t of g.texts) {
      const a = Math.min(1, t.life / (t.maxL * 0.3));
      ctx.globalAlpha = a;
      ctx.fillStyle = t.color;
      ctx.font = `bold ${t.sz}px Nunito, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(0,0,0,0.7)';
      ctx.shadowBlur = 4;
      ctx.fillText(t.text, t.x, t.y);
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;

    ctx.restore();
  }

  // ========== INPUT ==========
  useEffect(() => {
    const kd = (e) => {
      keysRef.current[e.key] = true;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
    };
    const ku = (e) => { keysRef.current[e.key] = false; };
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    return () => { window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); };
  }, []);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const mm = (e) => { const r = el.getBoundingClientRect(); mouseRef.current.x = e.clientX - r.left; mouseRef.current.y = e.clientY - r.top; mouseRef.current.active = true; };
    const md = (e) => { e.preventDefault(); mouseRef.current.down = true; };
    const mu = () => { mouseRef.current.down = false; };
    const ml = () => { mouseRef.current.active = false; mouseRef.current.down = false; };
    el.addEventListener('mousemove', mm);
    el.addEventListener('mousedown', md);
    window.addEventListener('mouseup', mu);
    el.addEventListener('mouseleave', ml);
    return () => { el.removeEventListener('mousemove', mm); el.removeEventListener('mousedown', md); window.removeEventListener('mouseup', mu); el.removeEventListener('mouseleave', ml); };
  }, [screen]);

  // ========== SCREENS ==========
  if (screen === 'intro') {
    return (
      <div className="ms-root">
        <style>{styles}</style>
        <div className="ms-intro">
          <div className="ms-intro-stars">
            {[...Array(40)].map((_, i) => (
              <div key={i} className="ms-star" style={{
                left: `${Math.random() * 100}%`, top: `${Math.random() * 100}%`,
                width: 1 + Math.random() * 3, height: 1 + Math.random() * 3,
                animationDelay: `${Math.random() * 4}s`, animationDuration: `${2 + Math.random() * 3}s`,
              }} />
            ))}
          </div>
          <div className="ms-intro-body">
            <div className="ms-logo-wrap">
              <span className="ms-logo-icon">⚡</span>
              <h1 className="ms-title">MATHSTORM</h1>
              <span className="ms-logo-icon flip">⚡</span>
            </div>
            <p className="ms-subtitle">NUMBER SQUADRON</p>

            <div className="ms-card">
              <h3>How to Play</h3>
              <div className="ms-rule">
                <span className="ms-rule-icon" style={{ background: 'rgba(74,222,128,0.2)', color: '#4ade80' }}>+</span>
                <div><strong style={{ color: '#4ade80' }}>ADD weapon</strong> — Rapid fire. Adds enemy's number to your Power Number.</div>
              </div>
              <div className="ms-rule">
                <span className="ms-rule-icon" style={{ background: 'rgba(251,146,60,0.2)', color: '#fb923c' }}>−</span>
                <div><strong style={{ color: '#fb923c' }}>SUB weapon</strong> — Homing shots. Subtracts enemy's number from your Power.</div>
              </div>
              <div className="ms-rule">
                <span className="ms-rule-icon" style={{ background: 'rgba(239,68,68,0.2)', color: '#ef4444' }}>💥</span>
                <div><strong style={{ color: '#ef4444' }}>Bosses</strong> have shields with a target number. Match your Power Number to break through!</div>
              </div>
            </div>

            <div className="ms-controls">
              <div className="ms-ctrl"><kbd>WASD</kbd> / <kbd>↑↓←→</kbd> Move</div>
              <div className="ms-ctrl"><kbd>Space</kbd> / <kbd>Z</kbd> Shoot</div>
              <div className="ms-ctrl"><kbd>1</kbd> <kbd>2</kbd> Switch weapon</div>
            </div>

            <button className="ms-start-btn" onClick={() => setScreen('playing')}>
              <span>⚡</span> LAUNCH MISSION <span>⚡</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (screen === 'gameover') {
    const finalScore = gRef.current?.score || 0;
    const finalWorld = (gRef.current?.worldIdx || 0);
    return (
      <div className="ms-root">
        <style>{styles}</style>
        <div className="ms-gameover">
          <div className="ms-intro-stars">
            {[...Array(25)].map((_, i) => (
              <div key={i} className="ms-star" style={{
                left: `${Math.random() * 100}%`, top: `${Math.random() * 100}%`,
                width: 1 + Math.random() * 3, height: 1 + Math.random() * 3,
                animationDelay: `${Math.random() * 4}s`, animationDuration: `${2 + Math.random() * 3}s`,
              }} />
            ))}
          </div>
          <div className="ms-go-body">
            <h1 className="ms-go-title">MISSION FAILED</h1>
            <div className="ms-go-stats">
              <div className="ms-go-stat"><span className="ms-go-label">Final Score</span><span className="ms-go-val">{finalScore}</span></div>
              <div className="ms-go-stat"><span className="ms-go-label">World Reached</span><span className="ms-go-val">{finalWorld}</span></div>
            </div>
            <div className="ms-go-btns">
              <button className="ms-start-btn" onClick={() => setScreen('playing')}>⚡ RETRY ⚡</button>
              <button className="ms-menu-btn" onClick={() => setScreen('intro')}>Main Menu</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ========== GAME SCREEN ==========
  return (
    <div className="ms-root">
      <style>{styles}</style>
      <div className="ms-game" ref={wrapRef}>
        <canvas ref={canvasRef} className="ms-canvas" />

        {/* HUD Overlay */}
        <div className="ms-hud-top">
          <div className="ms-hud-left">
            <div className="ms-wave-badge">W{hud.world}</div>
            <div className="ms-lives">
              {[...Array(Math.max(0, hud.lives))].map((_, i) => <span key={i} className="ms-heart">♥</span>)}
            </div>
          </div>
          <div className="ms-hud-center">
            <div className="ms-power-display">
              <span className="ms-power-label">POWER</span>
              <span className="ms-power-num" key={hud.power}>{hud.power}</span>
            </div>
          </div>
          <div className="ms-hud-right">
            <div className="ms-score-badge">
              <span className="ms-score-star">⭐</span> {hud.score}
            </div>
            {hud.combo > 2 && <div className="ms-combo">{hud.combo}x COMBO</div>}
          </div>
        </div>

        {/* Weapon Bar */}
        <div className="ms-weapon-bar">
          {WEAPONS.map((w, i) => (
            <button
              key={w.id}
              className={`ms-wep-btn ${hud.weapon === i ? 'active' : ''}`}
              style={{ '--wc': w.color, '--wg': w.glow }}
              onClick={() => { if (gRef.current) gRef.current.weapon = i; }}
            >
              <span className="ms-wep-sym">{w.symbol}</span>
              <span className="ms-wep-name">{w.name}</span>
              <kbd className="ms-wep-key">{i + 1}</kbd>
            </button>
          ))}
        </div>

        {/* Boss HP overlay */}
        {hud.bossActive && (
          <div className={`ms-boss-hud ${hud.powerMatch ? 'ms-boss-match' : ''}`}>
            <div className="ms-boss-label">
              {hud.powerMatch
                ? <span className="ms-match-text">{'\u26A1'} POWER MATCHED — FIRE! {'\u26A1'}</span>
                : <>BOSS — Shield: {hud.bossTarget}</>
              }
            </div>
            <div className="ms-boss-bar-bg">
              <div className="ms-boss-bar-fill" style={{ width: `${(hud.bossHP / hud.bossMaxHP) * 100}%` }} />
            </div>
            {!hud.powerMatch && hud.bossTarget > 0 && (
              <div className="ms-boss-hint">Get POWER to {hud.bossTarget} then attack!</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// =============== STYLES ===============
const styles = `
@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap');
@import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;500;600;700;800;900&display=swap');

* { box-sizing: border-box; margin: 0; padding: 0; }

.ms-root {
  width: 100%; height: 100vh;
  font-family: 'Nunito', sans-serif;
  overflow: hidden;
  background: #070b14;
  color: #e2e8f0;
}

/* ===== INTRO ===== */
.ms-intro, .ms-gameover {
  height: 100vh; display: flex; align-items: center; justify-content: center;
  position: relative; overflow: hidden;
  background: linear-gradient(180deg, #070b14 0%, #0f172a 50%, #070b14 100%);
}
.ms-intro-stars { position: absolute; inset: 0; pointer-events: none; }
.ms-star {
  position: absolute; border-radius: 50%; background: #fff;
  animation: msTwinkle 3s ease-in-out infinite alternate;
}
@keyframes msTwinkle {
  0% { opacity: 0.15; transform: scale(1); }
  100% { opacity: 0.8; transform: scale(1.3); }
}
.ms-intro-body, .ms-go-body {
  position: relative; z-index: 10; text-align: center;
  padding: 2rem; max-width: 520px; width: 100%;
}
.ms-logo-wrap {
  display: flex; align-items: center; justify-content: center; gap: 0.8rem; margin-bottom: 0.3rem;
}
.ms-logo-icon {
  font-size: 2rem; animation: msZap 1.5s ease-in-out infinite;
}
.ms-logo-icon.flip { animation-delay: 0.5s; }
@keyframes msZap {
  0%,100% { transform: translateY(0) rotate(0); opacity: 0.7; }
  50% { transform: translateY(-6px) rotate(10deg); opacity: 1; }
}
.ms-title {
  font-family: 'Orbitron', sans-serif;
  font-size: clamp(2.2rem, 8vw, 3.2rem);
  font-weight: 900;
  background: linear-gradient(135deg, #38bdf8, #818cf8, #f472b6);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  background-clip: text; letter-spacing: 2px;
}
.ms-subtitle {
  font-family: 'Orbitron', sans-serif;
  font-size: 1rem; color: #64748b; letter-spacing: 6px;
  margin-bottom: 1.8rem;
}
.ms-card {
  background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);
  border-radius: 20px; padding: 1.3rem 1.5rem; margin-bottom: 1.5rem;
  text-align: left;
}
.ms-card h3 { text-align: center; margin-bottom: 1rem; font-size: 1.05rem; color: #94a3b8; }
.ms-rule {
  display: flex; align-items: flex-start; gap: 0.8rem; margin-bottom: 0.9rem;
  font-size: 0.9rem; color: #cbd5e1; line-height: 1.4;
}
.ms-rule:last-child { margin-bottom: 0; }
.ms-rule-icon {
  flex-shrink: 0; width: 36px; height: 36px; border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  font-size: 1.2rem; font-weight: 900;
}
.ms-controls {
  display: flex; flex-wrap: wrap; justify-content: center; gap: 0.6rem 1.2rem;
  margin-bottom: 1.8rem; font-size: 0.85rem; color: #64748b;
}
.ms-ctrl { display: flex; align-items: center; gap: 0.3rem; }
.ms-ctrl kbd {
  padding: 0.15rem 0.45rem; background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255,255,255,0.15); border-radius: 5px;
  font-family: 'Orbitron', monospace; font-size: 0.75rem; color: #94a3b8;
}
.ms-start-btn {
  display: inline-flex; align-items: center; gap: 0.7rem;
  padding: 0.9rem 2.2rem;
  font-family: 'Orbitron', sans-serif; font-size: 1.05rem; font-weight: 700;
  color: white;
  background: linear-gradient(135deg, #3b82f6, #7c3aed);
  border: none; border-radius: 50px; cursor: pointer;
  box-shadow: 0 8px 30px rgba(59,130,246,0.4);
  transition: all 0.25s ease; letter-spacing: 1px;
}
.ms-start-btn:hover {
  transform: translateY(-3px);
  box-shadow: 0 12px 40px rgba(59,130,246,0.55);
}

/* ===== GAME OVER ===== */
.ms-go-title {
  font-family: 'Orbitron', sans-serif;
  font-size: clamp(1.6rem, 6vw, 2.4rem);
  font-weight: 900; color: #ef4444;
  margin-bottom: 1.5rem; letter-spacing: 3px;
}
.ms-go-stats { display: flex; justify-content: center; gap: 2.5rem; margin-bottom: 2rem; }
.ms-go-stat { display: flex; flex-direction: column; align-items: center; }
.ms-go-label { font-size: 0.8rem; color: #64748b; margin-bottom: 0.3rem; }
.ms-go-val { font-family: 'Orbitron', sans-serif; font-size: 2rem; font-weight: 900; color: white; }
.ms-go-btns { display: flex; flex-direction: column; gap: 0.8rem; align-items: center; }
.ms-menu-btn {
  padding: 0.7rem 2rem; font-family: 'Orbitron', sans-serif;
  font-size: 0.85rem; font-weight: 600; color: #94a3b8;
  background: transparent; border: 1px solid rgba(255,255,255,0.15);
  border-radius: 30px; cursor: pointer; transition: all 0.2s;
}
.ms-menu-btn:hover { border-color: rgba(255,255,255,0.3); color: #e2e8f0; }

/* ===== GAME ===== */
.ms-game {
  width: 100%; height: 100vh; position: relative; overflow: hidden;
  cursor: crosshair;
}
.ms-canvas { display: block; width: 100%; height: 100%; }

/* HUD */
.ms-hud-top {
  position: absolute; top: 0; left: 0; right: 0;
  display: flex; justify-content: space-between; align-items: center;
  padding: 0.6rem 0.8rem;
  background: linear-gradient(180deg, rgba(0,0,0,0.7) 0%, transparent 100%);
  pointer-events: none; z-index: 20;
}
.ms-hud-left, .ms-hud-right {
  display: flex; align-items: center; gap: 0.6rem;
}
.ms-wave-badge {
  font-family: 'Orbitron', sans-serif;
  padding: 0.35rem 0.8rem;
  background: linear-gradient(135deg, #3b82f6, #7c3aed);
  border-radius: 16px; font-size: 0.8rem; font-weight: 700; color: white;
}
.ms-lives { display: flex; gap: 0.25rem; }
.ms-heart { font-size: 1.1rem; color: #ef4444; }
.ms-hud-center { display: flex; flex-direction: column; align-items: center; }
.ms-power-display {
  display: flex; flex-direction: column; align-items: center;
  background: rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.12);
  border-radius: 14px; padding: 0.25rem 1rem;
}
.ms-power-label {
  font-family: 'Orbitron', sans-serif;
  font-size: 0.55rem; color: #64748b; letter-spacing: 2px;
}
.ms-power-num {
  font-family: 'Orbitron', sans-serif;
  font-size: 1.6rem; font-weight: 900; color: #fff;
  animation: msPowerPop 0.3s ease;
}
@keyframes msPowerPop {
  0% { transform: scale(1.4); color: #fbbf24; }
  100% { transform: scale(1); color: #fff; }
}
.ms-score-badge {
  display: flex; align-items: center; gap: 0.3rem;
  padding: 0.35rem 0.8rem;
  background: rgba(251,191,36,0.15);
  border-radius: 16px; font-weight: 700; font-size: 0.9rem; color: #fbbf24;
}
.ms-score-star { font-size: 0.9rem; }
.ms-combo {
  font-family: 'Orbitron', sans-serif;
  font-size: 0.7rem; font-weight: 700;
  color: #f472b6; animation: msCombo 0.5s ease;
}
@keyframes msCombo {
  0% { transform: scale(1.5); } 100% { transform: scale(1); }
}

/* Weapon bar */
.ms-weapon-bar {
  position: absolute; bottom: 0.6rem; left: 50%; transform: translateX(-50%);
  display: flex; gap: 0.4rem; z-index: 20; pointer-events: auto;
}
.ms-wep-btn {
  display: flex; flex-direction: column; align-items: center;
  gap: 0.1rem; padding: 0.4rem 0.9rem;
  background: rgba(255,255,255,0.06);
  border: 2px solid rgba(255,255,255,0.1);
  border-radius: 14px; cursor: pointer;
  transition: all 0.15s ease; position: relative;
  font-family: 'Nunito', sans-serif;
}
.ms-wep-btn.active {
  border-color: var(--wc);
  background: var(--wg);
  box-shadow: 0 4px 20px var(--wg);
}
.ms-wep-sym {
  font-size: 1.3rem; font-weight: 900; color: var(--wc);
}
.ms-wep-name {
  font-family: 'Orbitron', sans-serif;
  font-size: 0.55rem; font-weight: 700; color: #94a3b8;
  letter-spacing: 1px;
}
.ms-wep-btn.active .ms-wep-name { color: var(--wc); }
.ms-wep-key {
  position: absolute; top: -6px; right: -4px;
  padding: 0.05rem 0.3rem;
  background: rgba(0,0,0,0.7); border: 1px solid rgba(255,255,255,0.15);
  border-radius: 4px; font-size: 0.6rem; color: #64748b;
  font-family: 'Orbitron', monospace;
}
.ms-wep-btn.active .ms-wep-key { color: var(--wc); border-color: var(--wc); }

/* Boss HUD */
.ms-boss-hud {
  position: absolute; top: 50px; left: 50%; transform: translateX(-50%);
  display: flex; flex-direction: column; align-items: center; gap: 0.3rem;
  z-index: 20; pointer-events: none;
}
.ms-boss-label {
  font-family: 'Orbitron', sans-serif;
  font-size: 0.7rem; font-weight: 700; color: #ef4444; letter-spacing: 2px;
}
.ms-boss-bar-bg {
  width: 200px; height: 8px; background: rgba(0,0,0,0.6);
  border-radius: 4px; overflow: hidden;
  border: 1px solid rgba(255,255,255,0.1);
}
.ms-boss-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #ef4444, #fbbf24);
  border-radius: 4px; transition: width 0.3s ease;
}
.ms-boss-match {
  border: 1px solid rgba(255,215,0,0.4);
  background: rgba(255,215,0,0.08);
  border-radius: 12px; padding: 0.3rem 0.8rem;
}
.ms-match-text {
  color: #ffd700; font-weight: 800;
  animation: msMatchPulse 0.6s ease-in-out infinite alternate;
}
@keyframes msMatchPulse {
  0% { opacity: 0.7; transform: scale(1); }
  100% { opacity: 1; transform: scale(1.05); }
}
.ms-boss-hint {
  font-size: 0.6rem; color: #94a3b8; margin-top: 0.15rem;
  font-family: 'Orbitron', sans-serif; letter-spacing: 1px;
}

/* Responsive */
@media (max-width: 500px) {
  .ms-hud-top { padding: 0.4rem 0.5rem; }
  .ms-power-num { font-size: 1.2rem; }
  .ms-wave-badge { font-size: 0.7rem; padding: 0.25rem 0.6rem; }
  .ms-score-badge { font-size: 0.75rem; }
  .ms-wep-btn { padding: 0.3rem 0.6rem; }
  .ms-wep-sym { font-size: 1rem; }
}
`;
