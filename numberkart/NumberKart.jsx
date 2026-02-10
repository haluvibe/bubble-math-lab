// NumberKart: Equation Rally
// A Micro Machines-inspired top-down racer with math mechanics.
// Single-component architecture following MathStorm patterns.

import React, { useState, useRef, useEffect, useCallback } from 'react';

// ── Constants ───────────────────────────────────────────────────────────────

const TRACK_HALF_WIDTH = 80;
const CAR_LEN = 22;
const CAR_WID = 12;
const STEER_SPEED = 0.045;
const ACCEL = 0.12;
const BRAKE_DECEL = 0.08;
const FRICTION = 0.015;
const OFF_TRACK_FRICTION = 0.06;
const MAX_SPEED = 5.5;
const FUEL_DRAIN = 0.004; // per tick (~0.25/sec at 60fps)
const PICKUP_RADIUS = 20;
const CHECKPOINT_COUNT = 4;
const TOTAL_LAPS = 3;
const AI_COUNT = 3;
const LOOKAHEAD = 80;
const CAM_LERP = 0.06;
const COUNTDOWN_TICKS = 240; // 4 seconds (3-2-1-GO)
const HUD_SYNC_INTERVAL = 3;

const AI_COLORS = ['#ef4444', '#fbbf24', '#10b981'];
const AI_NAMES = ['RED', 'GOLD', 'JADE'];

// Operand types for pickups
const OP_TYPES = [
  { symbol: '+', fn: (a, b) => a + b },
  { symbol: '-', fn: (a, b) => a - b },
  { symbol: '\u00d7', fn: (a, b) => a * b },
  { symbol: '\u00f7', fn: (a, b) => b === 0 ? a : Math.round(a / b) },
];

// ── Utilities ───────────────────────────────────────────────────────────────

let _id = 0;
const nextId = () => ++_id;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (lo, hi) => Math.random() * (hi - lo) + lo;
const randInt = (lo, hi) => Math.floor(rand(lo, hi + 1));
const dist2 = (ax, ay, bx, by) => (ax - bx) ** 2 + (ay - by) ** 2;
const angleDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
const normAngle = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

// Catmull-Rom spline interpolation
function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return {
    x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
  };
}

// Sample a closed-loop track from control points into a dense spine
function buildSpine(controlPoints, spacing) {
  const n = controlPoints.length;
  const raw = [];
  for (let i = 0; i < n; i++) {
    const p0 = controlPoints[(i - 1 + n) % n];
    const p1 = controlPoints[i];
    const p2 = controlPoints[(i + 1) % n];
    const p3 = controlPoints[(i + 2) % n];
    const segSteps = 60;
    for (let s = 0; s < segSteps; s++) {
      raw.push(catmullRom(p0, p1, p2, p3, s / segSteps));
    }
  }
  // Resample at even spacing
  const spine = [{ ...raw[0], dist: 0, segIdx: 0 }];
  let accDist = 0;
  let lastAdded = 0;
  for (let i = 1; i < raw.length; i++) {
    const dx = raw[i].x - raw[i - 1].x;
    const dy = raw[i].y - raw[i - 1].y;
    accDist += Math.sqrt(dx * dx + dy * dy);
    if (accDist - lastAdded >= spacing) {
      spine.push({ x: raw[i].x, y: raw[i].y, dist: accDist, segIdx: spine.length });
      lastAdded = accDist;
    }
  }
  // Compute normals
  for (let i = 0; i < spine.length; i++) {
    const next = spine[(i + 1) % spine.length];
    const prev = spine[(i - 1 + spine.length) % spine.length];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    spine[i].nx = -dy / len;
    spine[i].ny = dx / len;
    spine[i].tx = dx / len;
    spine[i].ty = dy / len;
  }
  return { spine, trackLength: accDist };
}

// Find closest spine point to a world position
function closestSpineIdx(spine, wx, wy) {
  let bestIdx = 0, bestD = Infinity;
  // Coarse search every 10th
  for (let i = 0; i < spine.length; i += 10) {
    const d = dist2(spine[i].x, spine[i].y, wx, wy);
    if (d < bestD) { bestD = d; bestIdx = i; }
  }
  // Fine search around best
  const lo = Math.max(0, bestIdx - 15);
  const hi = Math.min(spine.length - 1, bestIdx + 15);
  for (let i = lo; i <= hi; i++) {
    const d = dist2(spine[i].x, spine[i].y, wx, wy);
    if (d < bestD) { bestD = d; bestIdx = i; }
  }
  return bestIdx;
}

// Get track distance for a spine index
function spineDistAt(spine, trackLength, idx) {
  return spine[idx].dist;
}

// Is a world position on the track?
function isOnTrack(spine, wx, wy, halfWidth) {
  const idx = closestSpineIdx(spine, wx, wy);
  const sp = spine[idx];
  const dx = wx - sp.x, dy = wy - sp.y;
  const lateral = Math.abs(dx * sp.nx + dy * sp.ny);
  return lateral < halfWidth;
}

// Generate a fuel zone target range
function generateZone(lap) {
  const center = randInt(20 + lap * 5, 60 + lap * 5);
  const halfRange = Math.max(5, 12 - lap * 2);
  return { lo: Math.max(0, center - halfRange), hi: Math.min(99, center + halfRange) };
}

// Generate equation for fork: a OP ? = result
function generateForkEquation(lap) {
  const difficulty = clamp(lap, 0, 3);
  const opIdx = randInt(0, difficulty === 0 ? 1 : 3);
  let a, correctAnswer, result;
  if (opIdx === 0) { // addition: a + ? = result
    correctAnswer = randInt(2, 8 + difficulty * 3);
    a = randInt(3, 30 + difficulty * 10);
    result = a + correctAnswer;
  } else if (opIdx === 1) { // subtraction: a - ? = result
    correctAnswer = randInt(2, 8 + difficulty * 3);
    result = randInt(3, 30 + difficulty * 10);
    a = result + correctAnswer;
  } else if (opIdx === 2) { // multiplication: a * ? = result
    correctAnswer = randInt(2, 6 + difficulty);
    a = randInt(2, 10 + difficulty * 3);
    result = a * correctAnswer;
  } else { // division: a / ? = result
    correctAnswer = randInt(2, 6 + difficulty);
    result = randInt(2, 10 + difficulty * 2);
    a = result * correctAnswer;
  }
  const opSymbols = ['+', '-', '\u00d7', '\u00f7'];
  const eqText = `${a} ${opSymbols[opIdx]} ? = ${result}`;
  // Generate wrong answers
  const wrongs = [];
  const tries = new Set([correctAnswer]);
  while (wrongs.length < 2) {
    const w = correctAnswer + randInt(-5, 5);
    if (w > 0 && !tries.has(w)) { wrongs.push(w); tries.add(w); }
  }
  // Shuffle paths: index 0-2, one is correct
  const paths = [correctAnswer, ...wrongs];
  // Shuffle
  for (let i = paths.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [paths[i], paths[j]] = [paths[j], paths[i]];
  }
  const correctIdx = paths.indexOf(correctAnswer);
  return { eqText, paths, correctIdx, correctAnswer };
}

// Generate operand pickups along the track
function generatePickups(spine, trackLength, count) {
  const pickups = [];
  for (let i = 0; i < count; i++) {
    const distAlong = (i / count) * trackLength + rand(-20, 20);
    const idx = Math.floor((distAlong / trackLength) * spine.length) % spine.length;
    const sp = spine[Math.abs(idx) % spine.length];
    const lateralOff = rand(-TRACK_HALF_WIDTH * 0.6, TRACK_HALF_WIDTH * 0.6);
    const opIdx = randInt(0, 3);
    const value = opIdx >= 2 ? randInt(2, 4) : randInt(2, 8);
    pickups.push({
      id: nextId(),
      x: sp.x + sp.nx * lateralOff,
      y: sp.y + sp.ny * lateralOff,
      opIdx,
      value,
      collected: false,
      respawnTimer: 0,
    });
  }
  return pickups;
}

// ── Track Definition ────────────────────────────────────────────────────────

// Oval track with a chicane, roughly 3000x2000 world units
const CONTROL_POINTS = [
  { x: 0, y: -800 },
  { x: 500, y: -750 },
  { x: 900, y: -500 },
  { x: 1050, y: -100 },
  { x: 1000, y: 300 },
  { x: 800, y: 550 },
  // chicane
  { x: 500, y: 650 },
  { x: 200, y: 600 },
  { x: -100, y: 650 },
  { x: -400, y: 550 },
  { x: -650, y: 300 },
  { x: -750, y: -100 },
  { x: -650, y: -450 },
  { x: -350, y: -700 },
];

// Fork definitions: placed at specific track distance fractions
const FORK_DEFS = [
  { distFrac: 0.35, lenFrac: 0.08 }, // fork around 35% of track
];

// ── Component ───────────────────────────────────────────────────────────────

export default function NumberKart() {
  const [screen, setScreen] = useState('intro');
  const [hud, setHud] = useState({
    lap: 1,
    totalLaps: TOTAL_LAPS,
    position: 1,
    fuelNumber: 50,
    zoneLo: 20,
    zoneHi: 35,
    zoneStatus: 'optimal', // optimal | overheat | stalling
    speed: 0,
    raceTime: 0,
    countdown: 0,
    countdownText: '',
    forkEquation: null,
    showFork: false,
    finalPosition: 1,
    finalTime: 0,
    aiNames: AI_NAMES,
    aiPositions: [2, 3, 4],
  });

  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const animRef = useRef(null);
  const gRef = useRef(null);
  const keysRef = useRef({});
  const prevTimeRef = useRef(0);

  // ── Build Track (once) ──────────────────────────────────────────────────

  const trackDataRef = useRef(null);
  if (!trackDataRef.current) {
    const { spine, trackLength } = buildSpine(CONTROL_POINTS, 2);
    // Pre-compute checkpoint distances
    const checkpointDists = [];
    for (let i = 0; i < CHECKPOINT_COUNT; i++) {
      checkpointDists.push((i / CHECKPOINT_COUNT) * trackLength);
    }
    // Build fork data
    const forks = FORK_DEFS.map(fd => {
      const startDist = fd.distFrac * trackLength;
      const endDist = (fd.distFrac + fd.lenFrac) * trackLength;
      const startIdx = Math.floor((fd.distFrac) * spine.length) % spine.length;
      const endIdx = Math.floor((fd.distFrac + fd.lenFrac) * spine.length) % spine.length;
      // The fork creates 3 path options: left, center, right
      // For rendering, offset from the main spine
      return { startDist, endDist, startIdx, endIdx, equation: null, paths: [], active: false };
    });
    trackDataRef.current = { spine, trackLength, checkpointDists, forks };
  }

  // ── Init Game ─────────────────────────────────────────────────────────────

  const initGame = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const W = wrap.clientWidth;
    const H = wrap.clientHeight;
    canvas.width = W;
    canvas.height = H;

    const td = trackDataRef.current;
    const { spine, trackLength, checkpointDists, forks } = td;

    // Start position: spine[0]
    const startSp = spine[0];
    const startAngle = Math.atan2(spine[1].y - spine[0].y, spine[1].x - spine[0].x);

    // Zone for lap 1
    const zone = generateZone(0);

    // Generate fork equations
    forks.forEach(f => {
      const eq = generateForkEquation(0);
      f.equation = eq;
      f.active = true;
      // Build fork branch spines: offset versions of the main spine between start/end
      f.paths = eq.paths.map((val, pi) => {
        const isCorrect = pi === eq.correctIdx;
        const lateralOffset = (pi - 1) * TRACK_HALF_WIDTH * 1.2;
        const branchSpine = [];
        const len = ((f.endIdx - f.startIdx + spine.length) % spine.length);
        for (let i = 0; i <= len; i++) {
          const si = (f.startIdx + i) % spine.length;
          const sp = spine[si];
          // Bell curve for lateral offset (max at middle, zero at ends)
          const t = i / len;
          const blend = Math.sin(t * Math.PI);
          const offX = sp.nx * lateralOffset * blend;
          const offY = sp.ny * lateralOffset * blend;
          branchSpine.push({
            x: sp.x + offX,
            y: sp.y + offY,
            nx: sp.nx,
            ny: sp.ny,
          });
        }
        return {
          value: val,
          correct: isCorrect,
          spine: branchSpine,
          lateralOffset,
          halfWidth: isCorrect ? TRACK_HALF_WIDTH * 0.9 : TRACK_HALF_WIDTH * 0.6,
        };
      });
    });

    // Generate pickups along the track
    const pickups = generatePickups(spine, trackLength, 28);

    // AI cars
    const aiCars = [];
    for (let i = 0; i < AI_COUNT; i++) {
      // Stagger start positions behind player (small offset backwards on spine)
      const staggerBack = (i + 1) * 15; // 15, 30, 45 spine points behind
      const aiIdx = ((spine.length - staggerBack) + spine.length) % spine.length;
      const aiSp = spine[aiIdx];
      const nextSp = spine[(aiIdx + 1) % spine.length];
      const aiAngle = Math.atan2(nextSp.y - aiSp.y, nextSp.x - aiSp.x);
      // Lateral offset for grid formation
      const lateralOff = (i === 0 ? -30 : i === 1 ? 30 : 0);
      aiCars.push({
        x: aiSp.x + aiSp.nx * lateralOff,
        y: aiSp.y + aiSp.ny * lateralOff,
        angle: aiAngle,
        speed: 0,
        trackDist: spine[aiIdx].dist,
        spineIdx: aiIdx,
        lap: 0,
        checkpoints: new Array(CHECKPOINT_COUNT).fill(false),
        color: AI_COLORS[i],
        name: AI_NAMES[i],
        forkChoice: -1,
        inFork: false,
        forkBranchIdx: -1,
        forkProgress: 0,
        lateralNoise: rand(-15, 15),
        noiseTimer: 0,
        baseSpeed: 3.0 + rand(-0.3, 0.3),
        finished: false,
        finishTime: 0,
      });
    }

    // Scenery objects
    const scenery = [];
    for (let i = 0; i < 40; i++) {
      const idx = randInt(0, spine.length - 1);
      const sp = spine[idx];
      const side = Math.random() < 0.5 ? -1 : 1;
      const offDist = TRACK_HALF_WIDTH + rand(30, 200);
      scenery.push({
        x: sp.x + sp.nx * side * offDist,
        y: sp.y + sp.ny * side * offDist,
        type: randInt(0, 3), // 0=rock, 1=neon sign, 2=barrel, 3=cone
        size: rand(5, 15),
        hue: randInt(180, 340),
      });
    }

    gRef.current = {
      W, H,
      // Player car
      car: {
        x: startSp.x,
        y: startSp.y,
        angle: startAngle,
        speed: 0,
        fuelNumber: 50,
        lap: 0,
        checkpoints: new Array(CHECKPOINT_COUNT).fill(false),
        trackDist: 0,
        onTrack: true,
        spineIdx: 0,
        inFork: false,
        forkBranchIdx: -1,
        forkProgress: 0,
      },
      // Camera
      camera: { x: startSp.x, y: startSp.y, scale: 1.1 },
      // AI
      aiCars,
      // Game state
      zone,
      zoneStatus: 'optimal',
      pickups,
      forks,
      scenery,
      // Race state
      countdown: COUNTDOWN_TICKS,
      goTimer: 0, // ticks to show GO! after countdown
      raceTime: 0,
      raceFinished: false,
      positions: [0, 1, 2, 3], // indices: 0=player, 1-3=AI
      // Effects
      particles: [],
      texts: [],
      tireMarks: [],
      shake: 0,
      // Tick
      tick: 0,
      alive: true,
    };

    setHud({
      lap: 1,
      totalLaps: TOTAL_LAPS,
      position: 1,
      fuelNumber: 50,
      zoneLo: zone.lo,
      zoneHi: zone.hi,
      zoneStatus: 'optimal',
      speed: 0,
      raceTime: 0,
      countdown: COUNTDOWN_TICKS,
      countdownText: '3',
      forkEquation: null,
      showFork: false,
      finalPosition: 1,
      finalTime: 0,
      aiNames: AI_NAMES,
      aiPositions: [2, 3, 4],
    });
  }, []);

  // ── Helpers ───────────────────────────────────────────────────────────────

  function getZoneStatus(fuelNumber, zone) {
    if (fuelNumber >= zone.lo && fuelNumber <= zone.hi) return 'optimal';
    if (fuelNumber > zone.hi) return 'overheat';
    return 'stalling';
  }

  function getSpeedMultiplier(status) {
    if (status === 'optimal') return 1.2;
    if (status === 'overheat') return 0.75;
    return 0.6;
  }

  // ── Update ────────────────────────────────────────────────────────────────

  function update(dt) {
    const g = gRef.current;
    if (!g || !g.alive) return;
    const td = trackDataRef.current;
    const { spine, trackLength, checkpointDists, forks } = td;
    const keys = keysRef.current;

    g.tick++;

    // Shake decay
    g.shake *= 0.9;
    if (g.shake < 0.3) g.shake = 0;

    // ── Countdown ────────────────────────────────────────────────────
    if (g.countdown > 0) {
      g.countdown -= dt;
      if (g.countdown <= 0) {
        g.countdown = 0;
        g.goTimer = 90; // Show GO! for 1.5 seconds
      }
      // Don't run physics during countdown
      if (g.tick % HUD_SYNC_INTERVAL === 0) {
        const secs = Math.ceil(g.countdown / 60);
        setHud(prev => ({
          ...prev,
          countdown: g.countdown,
          countdownText: g.countdown <= 0 ? 'GO!' : String(Math.min(3, secs)),
        }));
      }
      return;
    }

    // Decay GO timer
    if (g.goTimer > 0) g.goTimer -= dt;

    // Race time
    if (!g.raceFinished) {
      g.raceTime += dt / 60;
    }

    // ── Player Input & Physics ───────────────────────────────────────
    const car = g.car;

    // Steering (continuous hold)
    const steerLeft = keys['ArrowLeft'] || keys['a'] || keys['A'];
    const steerRight = keys['ArrowRight'] || keys['d'] || keys['D'];
    const accelKey = keys['ArrowUp'] || keys['w'] || keys['W'];
    const brakeKey = keys['ArrowDown'] || keys['s'] || keys['S'];

    if (steerLeft) car.angle -= STEER_SPEED * dt * (0.5 + 0.5 * Math.min(1, car.speed / 2));
    if (steerRight) car.angle += STEER_SPEED * dt * (0.5 + 0.5 * Math.min(1, car.speed / 2));
    car.angle = normAngle(car.angle);

    // Zone speed multiplier
    const status = getZoneStatus(car.fuelNumber, g.zone);
    g.zoneStatus = status;
    const speedMul = getSpeedMultiplier(status);

    // Acceleration
    if (accelKey) {
      car.speed += ACCEL * dt * speedMul;
    }
    if (brakeKey) {
      car.speed -= BRAKE_DECEL * dt;
    }

    // Friction
    const frictionRate = car.onTrack ? FRICTION : OFF_TRACK_FRICTION;
    car.speed -= car.speed * frictionRate * dt;
    car.speed = clamp(car.speed, -1, MAX_SPEED * speedMul);

    // Move car
    const vx = Math.cos(car.angle) * car.speed * dt;
    const vy = Math.sin(car.angle) * car.speed * dt;
    car.x += vx;
    car.y += vy;

    // Track detection
    car.onTrack = isOnTrack(spine, car.x, car.y, TRACK_HALF_WIDTH + 10);
    car.spineIdx = closestSpineIdx(spine, car.x, car.y);
    car.trackDist = spine[car.spineIdx].dist;

    // Tire marks on hard turns
    if (Math.abs(steerLeft ? -1 : steerRight ? 1 : 0) > 0 && car.speed > 2 && car.onTrack) {
      if (g.tick % 2 === 0) {
        const sp = spine[car.spineIdx];
        g.tireMarks.push({
          x: car.x - Math.cos(car.angle) * 8,
          y: car.y - Math.sin(car.angle) * 8,
          alpha: 0.3,
        });
        if (g.tireMarks.length > 300) g.tireMarks.shift();
      }
    }

    // ── Fuel Drain ────────────────────────────────────────────────────
    car.fuelNumber -= FUEL_DRAIN * dt;
    car.fuelNumber = clamp(car.fuelNumber, 0, 99);

    // ── Pickup Collection ─────────────────────────────────────────────
    g.pickups.forEach(p => {
      if (p.collected) {
        p.respawnTimer -= dt;
        if (p.respawnTimer <= 0) {
          p.collected = false;
          // Rerandomize
          p.opIdx = randInt(0, 3);
          p.value = p.opIdx >= 2 ? randInt(2, 4) : randInt(2, 8);
        }
        return;
      }
      const d2 = dist2(car.x, car.y, p.x, p.y);
      if (d2 < PICKUP_RADIUS * PICKUP_RADIUS) {
        p.collected = true;
        p.respawnTimer = 600; // 10 seconds
        const oldFuel = Math.round(car.fuelNumber);
        const op = OP_TYPES[p.opIdx];
        car.fuelNumber = clamp(Math.round(op.fn(car.fuelNumber, p.value)), 0, 99);
        const newFuel = Math.round(car.fuelNumber);
        const eqText = `${oldFuel} ${op.symbol} ${p.value} = ${newFuel}`;
        // Floating text
        g.texts.push({
          id: nextId(),
          x: p.x, y: p.y - 15,
          text: eqText,
          color: '#fff',
          life: 90, maxLife: 90,
          vy: -0.8, size: 14,
        });
        // Particles
        const pColor = ['#4ade80', '#fb923c', '#a78bfa', '#38bdf8'][p.opIdx];
        for (let i = 0; i < 6; i++) {
          g.particles.push({
            id: nextId(),
            x: p.x, y: p.y,
            vx: rand(-2, 2), vy: rand(-2, 2),
            life: rand(15, 30), maxLife: 30,
            color: pColor, r: rand(2, 4),
          });
        }
      }
    });

    // ── Checkpoint / Lap Detection ────────────────────────────────────
    for (let ci = 0; ci < CHECKPOINT_COUNT; ci++) {
      const cpDist = checkpointDists[ci];
      const diff = Math.abs(car.trackDist - cpDist);
      if (diff < 30 && !car.checkpoints[ci]) {
        // Must pass in order (except first can be passed anytime after all others)
        if (ci === 0) {
          // Check if all other checkpoints passed
          const allOther = car.checkpoints.slice(1).every(c => c);
          if (allOther || car.lap === 0) {
            car.checkpoints[ci] = true;
          }
        } else {
          // Previous checkpoint must be passed
          if (car.checkpoints[ci - 1] || (ci === 1 && car.checkpoints[0])) {
            car.checkpoints[ci] = true;
          }
        }
      }
    }

    // Lap completion: all checkpoints passed, crossing start line again
    if (car.checkpoints.every(c => c)) {
      // Check if near start
      const startDist = Math.abs(car.trackDist);
      if (startDist < 40 || car.trackDist > trackLength - 40) {
        car.lap++;
        car.checkpoints.fill(false);
        // Shift zone
        g.zone = generateZone(car.lap);
        // Floating text
        if (car.lap < TOTAL_LAPS) {
          g.texts.push({
            id: nextId(),
            x: car.x, y: car.y - 40,
            text: `LAP ${car.lap + 1}/${TOTAL_LAPS}`,
            color: '#ffd700',
            life: 120, maxLife: 120,
            vy: -0.5, size: 20,
          });
        }
        // Regenerate fork equations
        forks.forEach(f => {
          const eq = generateForkEquation(car.lap);
          f.equation = eq;
          f.paths.forEach((p, pi) => {
            p.value = eq.paths[pi];
            p.correct = pi === eq.correctIdx;
          });
        });
        // Race finished?
        if (car.lap >= TOTAL_LAPS && !g.raceFinished) {
          g.raceFinished = true;
          const pos = g.positions.indexOf(0) + 1;
          g.texts.push({
            id: nextId(),
            x: car.x, y: car.y - 60,
            text: `FINISH! ${pos === 1 ? '1ST' : pos === 2 ? '2ND' : pos === 3 ? '3RD' : '4TH'}`,
            color: pos === 1 ? '#ffd700' : '#fff',
            life: 180, maxLife: 180,
            vy: -0.3, size: 26,
          });
          setTimeout(() => setScreen('gameover'), 2500);
        }
      }
    }

    // ── Fork Detection ────────────────────────────────────────────────
    forks.forEach(f => {
      if (!f.active) return;
      // Check if player is approaching fork
      const distToFork = f.startDist - car.trackDist;
      if (distToFork > 0 && distToFork < 300) {
        // Show equation
      }
      // Check if player entered fork zone
      const inZone = car.trackDist >= f.startDist - 10 && car.trackDist <= f.endDist + 10;
      if (inZone && !car.inFork) {
        // Determine which branch the car is closest to
        let bestBranch = 0, bestDist = Infinity;
        f.paths.forEach((p, pi) => {
          if (p.spine.length > 0) {
            const md = Math.min(...p.spine.map(s => dist2(car.x, car.y, s.x, s.y)));
            if (md < bestDist) { bestDist = md; bestBranch = pi; }
          }
        });
        car.inFork = true;
        car.forkBranchIdx = bestBranch;
      }
      if (!inZone && car.inFork) {
        car.inFork = false;
        car.forkBranchIdx = -1;
      }
    });

    // ── AI Cars ──────────────────────────────────────────────────────
    g.aiCars.forEach((ai, aiIdx) => {
      if (ai.finished) return;

      // Target spine point ahead
      const lookAhead = 20 + Math.floor(ai.speed * 3);
      const targetIdx = (ai.spineIdx + lookAhead) % spine.length;
      const target = spine[targetIdx];

      // Add lateral noise
      ai.noiseTimer -= dt;
      if (ai.noiseTimer <= 0) {
        ai.lateralNoise = rand(-20, 20);
        ai.noiseTimer = randInt(60, 180);
      }
      const tgtX = target.x + target.nx * ai.lateralNoise;
      const tgtY = target.y + target.ny * ai.lateralNoise;

      // Steer toward target
      const desiredAngle = Math.atan2(tgtY - ai.y, tgtX - ai.x);
      const diff = angleDiff(ai.angle, desiredAngle);
      ai.angle += clamp(diff, -STEER_SPEED * 1.5, STEER_SPEED * 1.5) * dt;
      ai.angle = normAngle(ai.angle);

      // Rubber-band speed
      const playerDist = car.lap * trackLength + car.trackDist;
      const aiDist = ai.lap * trackLength + ai.trackDist;
      let targetSpeed = ai.baseSpeed;
      const gap = playerDist - aiDist;
      if (gap > 200) targetSpeed += 0.8; // Behind player, speed up
      if (gap < -200) targetSpeed -= 0.5; // Ahead, slow down
      targetSpeed += rand(-0.1, 0.1); // Jitter

      ai.speed = lerp(ai.speed, targetSpeed, 0.02 * dt);
      ai.speed = clamp(ai.speed, 0.5, MAX_SPEED * 1.1);

      // Move
      ai.x += Math.cos(ai.angle) * ai.speed * dt;
      ai.y += Math.sin(ai.angle) * ai.speed * dt;

      // Update spine tracking
      ai.spineIdx = closestSpineIdx(spine, ai.x, ai.y);
      ai.trackDist = spine[ai.spineIdx].dist;

      // AI Checkpoints & Laps
      for (let ci = 0; ci < CHECKPOINT_COUNT; ci++) {
        const cpDist = checkpointDists[ci];
        const diff2 = Math.abs(ai.trackDist - cpDist);
        if (diff2 < 40 && !ai.checkpoints[ci]) {
          if (ci === 0) {
            const allOther = ai.checkpoints.slice(1).every(c => c);
            if (allOther || ai.lap === 0) ai.checkpoints[ci] = true;
          } else {
            if (ai.checkpoints[ci - 1] || (ci === 1 && ai.checkpoints[0])) {
              ai.checkpoints[ci] = true;
            }
          }
        }
      }

      if (ai.checkpoints.every(c => c)) {
        const startD = Math.abs(ai.trackDist);
        if (startD < 50 || ai.trackDist > trackLength - 50) {
          ai.lap++;
          ai.checkpoints.fill(false);
          if (ai.lap >= TOTAL_LAPS) {
            ai.finished = true;
            ai.finishTime = g.raceTime;
          }
        }
      }

      // Fork path selection for AI
      forks.forEach(f => {
        if (!f.active) return;
        const inZone = ai.trackDist >= f.startDist - 20 && ai.trackDist <= f.endDist + 20;
        if (inZone && !ai.inFork) {
          ai.inFork = true;
          // 70% chance correct
          ai.forkBranchIdx = Math.random() < 0.7 ? f.equation.correctIdx : randInt(0, 2);
          ai.forkChoice = f.paths[ai.forkBranchIdx]?.value || 0;
        }
        if (inZone && ai.inFork && f.paths[ai.forkBranchIdx]) {
          // Steer toward chosen branch
          const branch = f.paths[ai.forkBranchIdx];
          if (branch.spine.length > 0) {
            // Find closest point on branch
            let bestBI = 0, bestBD = Infinity;
            for (let bi = 0; bi < branch.spine.length; bi += 3) {
              const bd = dist2(ai.x, ai.y, branch.spine[bi].x, branch.spine[bi].y);
              if (bd < bestBD) { bestBD = bd; bestBI = bi; }
            }
            const bTarget = branch.spine[Math.min(bestBI + 5, branch.spine.length - 1)];
            const bAngle = Math.atan2(bTarget.y - ai.y, bTarget.x - ai.x);
            const bDiff = angleDiff(ai.angle, bAngle);
            ai.angle += clamp(bDiff, -STEER_SPEED * 2, STEER_SPEED * 2) * dt;
          }
        }
        if (!inZone && ai.inFork) {
          ai.inFork = false;
          ai.forkBranchIdx = -1;
        }
      });
    });

    // ── Race Positions ────────────────────────────────────────────────
    const allCars = [
      { idx: 0, totalDist: car.lap * trackLength + car.trackDist, finished: g.raceFinished, finishTime: g.raceFinished ? g.raceTime : Infinity },
      ...g.aiCars.map((ai, i) => ({
        idx: i + 1,
        totalDist: ai.lap * trackLength + ai.trackDist,
        finished: ai.finished,
        finishTime: ai.finished ? ai.finishTime : Infinity,
      })),
    ];
    allCars.sort((a, b) => {
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      return b.totalDist - a.totalDist;
    });
    g.positions = allCars.map(c => c.idx);

    // ── Camera ────────────────────────────────────────────────────────
    const lookX = car.x + Math.cos(car.angle) * LOOKAHEAD * (car.speed / MAX_SPEED);
    const lookY = car.y + Math.sin(car.angle) * LOOKAHEAD * (car.speed / MAX_SPEED);
    g.camera.x = lerp(g.camera.x, lookX, CAM_LERP * dt);
    g.camera.y = lerp(g.camera.y, lookY, CAM_LERP * dt);

    // ── Particles ────────────────────────────────────────────────────
    g.particles = g.particles.filter(p => {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.96;
      p.vy *= 0.96;
      p.life -= dt;
      return p.life > 0;
    });

    // Zone-based particles
    if (status === 'overheat' && g.tick % 4 === 0) {
      g.particles.push({
        id: nextId(),
        x: car.x + rand(-8, 8), y: car.y + rand(-8, 8),
        vx: rand(-1, 1), vy: rand(-2, 0),
        life: rand(10, 20), maxLife: 20,
        color: '#ef4444', r: rand(1, 3),
      });
    }
    if (status === 'stalling' && g.tick % 6 === 0) {
      g.particles.push({
        id: nextId(),
        x: car.x + rand(-6, 6), y: car.y + rand(-6, 6),
        vx: rand(-0.5, 0.5), vy: rand(-1, 0),
        life: rand(15, 30), maxLife: 30,
        color: '#888', r: rand(2, 5),
      });
    }
    if (status === 'optimal' && car.speed > 3 && g.tick % 3 === 0) {
      g.particles.push({
        id: nextId(),
        x: car.x - Math.cos(car.angle) * 12 + rand(-3, 3),
        y: car.y - Math.sin(car.angle) * 12 + rand(-3, 3),
        vx: -Math.cos(car.angle) * rand(1, 2),
        vy: -Math.sin(car.angle) * rand(1, 2),
        life: rand(8, 15), maxLife: 15,
        color: '#4ade80', r: rand(1, 3),
      });
    }

    // ── Texts ────────────────────────────────────────────────────────
    g.texts = g.texts.filter(t => {
      t.y += t.vy * dt;
      t.life -= dt;
      return t.life > 0;
    });

    // ── Tire marks decay ─────────────────────────────────────────────
    g.tireMarks.forEach(tm => {
      tm.alpha *= 0.998;
    });
    g.tireMarks = g.tireMarks.filter(tm => tm.alpha > 0.02);

    // ── HUD Sync ────────────────────────────────────────────────────
    if (g.tick % HUD_SYNC_INTERVAL === 0) {
      const pos = g.positions.indexOf(0) + 1;
      const showFork = forks.some(f => {
        const d = f.startDist - car.trackDist;
        return d > 0 && d < 300 && f.active;
      });
      const activeFork = forks.find(f => f.startDist - car.trackDist > 0 && f.startDist - car.trackDist < 300 && f.active);
      setHud({
        lap: Math.min(car.lap + 1, TOTAL_LAPS),
        totalLaps: TOTAL_LAPS,
        position: pos,
        fuelNumber: Math.round(car.fuelNumber),
        zoneLo: g.zone.lo,
        zoneHi: g.zone.hi,
        zoneStatus: status,
        speed: Math.round(car.speed * 20),
        raceTime: g.raceTime,
        countdown: 0,
        countdownText: g.goTimer > 0 ? 'GO!' : '',
        forkEquation: activeFork ? activeFork.equation : null,
        showFork,
        finalPosition: pos,
        finalTime: g.raceTime,
        aiNames: AI_NAMES,
        aiPositions: g.positions.slice(),
      });
    }
  }

  // ── Draw ──────────────────────────────────────────────────────────────────

  function draw() {
    const g = gRef.current;
    if (!g) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const { W, H } = g;
    const td = trackDataRef.current;
    const { spine, trackLength, checkpointDists, forks } = td;
    const cam = g.camera;

    // World-to-screen transform
    const scale = cam.scale;
    const toScreenX = (wx) => (wx - cam.x) * scale + W / 2;
    const toScreenY = (wy) => (wy - cam.y) * scale + H / 2;

    ctx.save();

    // Screen shake
    if (g.shake > 0.3) {
      ctx.translate((Math.random() - 0.5) * g.shake * 2, (Math.random() - 0.5) * g.shake * 2);
    }

    // ── Background ──────────────────────────────────────────────────
    ctx.fillStyle = '#04060e';
    ctx.fillRect(0, 0, W, H);

    // Grid pattern on ground
    ctx.strokeStyle = 'rgba(100, 140, 255, 0.03)';
    ctx.lineWidth = 1;
    const gridSize = 100 * scale;
    const gridOffX = -(cam.x * scale) % gridSize;
    const gridOffY = -(cam.y * scale) % gridSize;
    for (let gx = gridOffX; gx < W; gx += gridSize) {
      ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke();
    }
    for (let gy = gridOffY; gy < H; gy += gridSize) {
      ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
    }

    // ── Scenery ─────────────────────────────────────────────────────
    g.scenery.forEach(s => {
      const sx = toScreenX(s.x), sy = toScreenY(s.y);
      if (sx < -50 || sx > W + 50 || sy < -50 || sy > H + 50) return;
      const sz = s.size * scale;
      if (s.type === 0) {
        // Rock
        ctx.fillStyle = `hsla(${s.hue}, 10%, 20%, 0.5)`;
        ctx.beginPath();
        ctx.arc(sx, sy, sz, 0, Math.PI * 2);
        ctx.fill();
      } else if (s.type === 1) {
        // Neon sign
        ctx.fillStyle = `hsla(${s.hue}, 80%, 60%, 0.3)`;
        ctx.shadowBlur = 10 * scale;
        ctx.shadowColor = `hsla(${s.hue}, 80%, 60%, 0.5)`;
        ctx.fillRect(sx - sz * 0.6, sy - sz, sz * 1.2, sz * 2);
        ctx.shadowBlur = 0;
      } else if (s.type === 2) {
        // Barrel
        ctx.fillStyle = `hsla(30, 60%, 30%, 0.5)`;
        ctx.beginPath();
        ctx.arc(sx, sy, sz * 0.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = `hsla(30, 60%, 50%, 0.3)`;
        ctx.lineWidth = 1;
        ctx.stroke();
      } else {
        // Cone
        ctx.fillStyle = 'rgba(255, 150, 50, 0.4)';
        ctx.beginPath();
        ctx.moveTo(sx, sy - sz);
        ctx.lineTo(sx - sz * 0.5, sy + sz * 0.5);
        ctx.lineTo(sx + sz * 0.5, sy + sz * 0.5);
        ctx.closePath();
        ctx.fill();
      }
    });

    // ── Track Surface ────────────────────────────────────────────────
    // Draw filled track polygon
    ctx.beginPath();
    for (let i = 0; i < spine.length; i += 3) {
      const sp = spine[i];
      const sx = toScreenX(sp.x + sp.nx * TRACK_HALF_WIDTH);
      const sy = toScreenY(sp.y + sp.ny * TRACK_HALF_WIDTH);
      if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
    }
    for (let i = spine.length - 1; i >= 0; i -= 3) {
      const sp = spine[i];
      const sx = toScreenX(sp.x - sp.nx * TRACK_HALF_WIDTH);
      const sy = toScreenY(sp.y - sp.ny * TRACK_HALF_WIDTH);
      ctx.lineTo(sx, sy);
    }
    ctx.closePath();
    ctx.fillStyle = '#151530';
    ctx.fill();

    // ── Fork Branches ────────────────────────────────────────────────
    forks.forEach(f => {
      if (!f.active) return;
      f.paths.forEach((p, pi) => {
        if (p.spine.length < 2) return;
        // Draw branch surface
        ctx.beginPath();
        for (let i = 0; i < p.spine.length; i += 2) {
          const bs = p.spine[i];
          const sx = toScreenX(bs.x + bs.nx * p.halfWidth);
          const sy = toScreenY(bs.y + bs.ny * p.halfWidth);
          if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
        }
        for (let i = p.spine.length - 1; i >= 0; i -= 2) {
          const bs = p.spine[i];
          const sx = toScreenX(bs.x - bs.nx * p.halfWidth);
          const sy = toScreenY(bs.y - bs.ny * p.halfWidth);
          ctx.lineTo(sx, sy);
        }
        ctx.closePath();
        ctx.fillStyle = p.correct ? '#1a2040' : '#12101e';
        ctx.fill();

        // Path number label at middle of branch
        const midIdx = Math.floor(p.spine.length / 2);
        if (midIdx < p.spine.length) {
          const ms = p.spine[midIdx];
          const msx = toScreenX(ms.x);
          const msy = toScreenY(ms.y);
          ctx.font = `bold ${18 * scale}px Orbitron, monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = p.correct ? '#4ade80' : '#888';
          ctx.fillText(String(p.value), msx, msy);
        }
      });
    });

    // ── Track Edges (neon glow) ──────────────────────────────────────
    ctx.shadowBlur = 8 * scale;
    ctx.shadowColor = '#6c8cff';
    ctx.strokeStyle = '#6c8cff';
    ctx.lineWidth = 2 * scale;

    // Left edge
    ctx.beginPath();
    for (let i = 0; i < spine.length; i += 3) {
      const sp = spine[i];
      const sx = toScreenX(sp.x + sp.nx * TRACK_HALF_WIDTH);
      const sy = toScreenY(sp.y + sp.ny * TRACK_HALF_WIDTH);
      if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
    }
    ctx.closePath();
    ctx.stroke();

    // Right edge
    ctx.beginPath();
    for (let i = 0; i < spine.length; i += 3) {
      const sp = spine[i];
      const sx = toScreenX(sp.x - sp.nx * TRACK_HALF_WIDTH);
      const sy = toScreenY(sp.y - sp.ny * TRACK_HALF_WIDTH);
      if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.shadowBlur = 0;

    // ── Centerline Dashes ────────────────────────────────────────────
    ctx.strokeStyle = 'rgba(108, 140, 255, 0.15)';
    ctx.lineWidth = 1 * scale;
    ctx.setLineDash([10 * scale, 10 * scale]);
    ctx.beginPath();
    for (let i = 0; i < spine.length; i += 3) {
      const sp = spine[i];
      const sx = toScreenX(sp.x);
      const sy = toScreenY(sp.y);
      if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);

    // ── Start/Finish Line ────────────────────────────────────────────
    const sf = spine[0];
    const sfx1 = toScreenX(sf.x + sf.nx * TRACK_HALF_WIDTH);
    const sfy1 = toScreenY(sf.y + sf.ny * TRACK_HALF_WIDTH);
    const sfx2 = toScreenX(sf.x - sf.nx * TRACK_HALF_WIDTH);
    const sfy2 = toScreenY(sf.y - sf.ny * TRACK_HALF_WIDTH);

    // Checkered pattern
    const sfLen = Math.sqrt((sfx2 - sfx1) ** 2 + (sfy2 - sfy1) ** 2);
    const sfAngle = Math.atan2(sfy2 - sfy1, sfx2 - sfx1);
    const checks = 10;
    const checkW = sfLen / checks;
    for (let ci = 0; ci < checks; ci++) {
      const cx = sfx1 + Math.cos(sfAngle) * (ci + 0.5) * checkW;
      const cy = sfy1 + Math.sin(sfAngle) * (ci + 0.5) * checkW;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(sfAngle);
      ctx.fillStyle = ci % 2 === 0 ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)';
      ctx.fillRect(-checkW / 2, -3 * scale, checkW, 3 * scale);
      ctx.fillStyle = ci % 2 === 0 ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.7)';
      ctx.fillRect(-checkW / 2, 0, checkW, 3 * scale);
      ctx.restore();
    }

    // ── Checkpoint Lines ─────────────────────────────────────────────
    for (let ci = 1; ci < CHECKPOINT_COUNT; ci++) {
      const cpDist = checkpointDists[ci];
      const cpIdx = Math.floor((cpDist / trackLength) * spine.length) % spine.length;
      const cp = spine[cpIdx];
      const cpx1 = toScreenX(cp.x + cp.nx * TRACK_HALF_WIDTH);
      const cpy1 = toScreenY(cp.y + cp.ny * TRACK_HALF_WIDTH);
      const cpx2 = toScreenX(cp.x - cp.nx * TRACK_HALF_WIDTH);
      const cpy2 = toScreenY(cp.y - cp.ny * TRACK_HALF_WIDTH);
      ctx.strokeStyle = 'rgba(108, 140, 255, 0.1)';
      ctx.lineWidth = 1 * scale;
      ctx.setLineDash([4 * scale, 4 * scale]);
      ctx.beginPath();
      ctx.moveTo(cpx1, cpy1);
      ctx.lineTo(cpx2, cpy2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // ── Tire Marks ──────────────────────────────────────────────────
    g.tireMarks.forEach(tm => {
      const sx = toScreenX(tm.x), sy = toScreenY(tm.y);
      if (sx < -20 || sx > W + 20 || sy < -20 || sy > H + 20) return;
      ctx.globalAlpha = tm.alpha;
      ctx.fillStyle = '#222';
      ctx.beginPath();
      ctx.arc(sx, sy, 2 * scale, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    // ── Pickups ─────────────────────────────────────────────────────
    g.pickups.forEach(p => {
      if (p.collected) return;
      const sx = toScreenX(p.x), sy = toScreenY(p.y);
      if (sx < -30 || sx > W + 30 || sy < -30 || sy > H + 30) return;

      const colors = ['#4ade80', '#fb923c', '#a78bfa', '#38bdf8'];
      const c = colors[p.opIdx];
      const r = 10 * scale;

      // Hex shape
      ctx.shadowBlur = 8 * scale;
      ctx.shadowColor = c;
      ctx.fillStyle = c;
      ctx.globalAlpha = 0.3;
      ctx.beginPath();
      for (let hi = 0; hi < 6; hi++) {
        const ha = (Math.PI / 3) * hi - Math.PI / 6;
        ctx.lineTo(sx + Math.cos(ha) * r * 1.3, sy + Math.sin(ha) * r * 1.3);
      }
      ctx.closePath();
      ctx.fill();

      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      for (let hi = 0; hi < 6; hi++) {
        const ha = (Math.PI / 3) * hi - Math.PI / 6;
        ctx.lineTo(sx + Math.cos(ha) * r, sy + Math.sin(ha) * r);
      }
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;

      // Label
      ctx.globalAlpha = 1;
      ctx.font = `bold ${9 * scale}px Orbitron, monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff';
      const opSym = ['+', '-', '\u00d7', '\u00f7'][p.opIdx];
      ctx.fillText(`${opSym}${p.value}`, sx, sy);
    });

    // ── Fork Equation Sign ───────────────────────────────────────────
    forks.forEach(f => {
      if (!f.active || !f.equation) return;
      const signIdx = Math.max(0, f.startIdx - 40);
      const signSp = spine[signIdx % spine.length];
      const sx = toScreenX(signSp.x);
      const sy = toScreenY(signSp.y - 30);
      // Draw sign bg
      ctx.fillStyle = 'rgba(8, 12, 24, 0.85)';
      ctx.strokeStyle = '#ffd700';
      ctx.lineWidth = 2 * scale;
      const sw = 120 * scale, sh = 30 * scale;
      ctx.beginPath();
      ctx.roundRect(sx - sw / 2, sy - sh / 2, sw, sh, 6 * scale);
      ctx.fill();
      ctx.stroke();
      // Text
      ctx.font = `bold ${12 * scale}px Orbitron, monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffd700';
      ctx.fillText(f.equation.eqText, sx, sy);
    });

    // ── AI Cars ─────────────────────────────────────────────────────
    g.aiCars.forEach((ai) => {
      const sx = toScreenX(ai.x), sy = toScreenY(ai.y);
      if (sx < -50 || sx > W + 50 || sy < -50 || sy > H + 50) return;

      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(ai.angle);

      // Car body
      const cl = CAR_LEN * scale;
      const cw = CAR_WID * scale;

      ctx.fillStyle = ai.color;
      ctx.globalAlpha = 0.3;
      ctx.shadowBlur = 10 * scale;
      ctx.shadowColor = ai.color;
      ctx.beginPath();
      ctx.moveTo(cl * 0.6, 0);
      ctx.lineTo(cl * 0.2, -cw * 0.55);
      ctx.lineTo(-cl * 0.5, -cw * 0.5);
      ctx.lineTo(-cl * 0.5, cw * 0.5);
      ctx.lineTo(cl * 0.2, cw * 0.55);
      ctx.closePath();
      ctx.fill();

      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
      // Dark body
      ctx.fillStyle = '#1a1a2e';
      ctx.beginPath();
      ctx.moveTo(cl * 0.5, 0);
      ctx.lineTo(cl * 0.15, -cw * 0.45);
      ctx.lineTo(-cl * 0.45, -cw * 0.4);
      ctx.lineTo(-cl * 0.45, cw * 0.4);
      ctx.lineTo(cl * 0.15, cw * 0.45);
      ctx.closePath();
      ctx.fill();

      // Color stripe
      ctx.strokeStyle = ai.color;
      ctx.lineWidth = 2 * scale;
      ctx.beginPath();
      ctx.moveTo(cl * 0.5, 0);
      ctx.lineTo(cl * 0.15, -cw * 0.45);
      ctx.lineTo(-cl * 0.45, -cw * 0.4);
      ctx.lineTo(-cl * 0.45, cw * 0.4);
      ctx.lineTo(cl * 0.15, cw * 0.45);
      ctx.closePath();
      ctx.stroke();

      // Engine glow
      ctx.fillStyle = ai.color;
      ctx.globalAlpha = 0.5 + Math.sin(g.tick * 0.2) * 0.2;
      ctx.beginPath();
      ctx.moveTo(-cl * 0.45, -cw * 0.2);
      ctx.lineTo(-cl * 0.45, cw * 0.2);
      ctx.lineTo(-cl * 0.7, 0);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;

      ctx.restore();
    });

    // ── Player Car ──────────────────────────────────────────────────
    const car = g.car;
    const pcx = toScreenX(car.x), pcy = toScreenY(car.y);

    ctx.save();
    ctx.translate(pcx, pcy);
    ctx.rotate(car.angle);

    const cl = CAR_LEN * scale;
    const cw = CAR_WID * scale;

    // Status color
    let carGlow = '#6c8cff';
    if (g.zoneStatus === 'optimal') carGlow = '#4ade80';
    else if (g.zoneStatus === 'overheat') carGlow = '#ef4444';
    else if (g.zoneStatus === 'stalling') carGlow = '#888';

    // Glow
    ctx.shadowBlur = 15 * scale;
    ctx.shadowColor = carGlow;
    ctx.fillStyle = carGlow;
    ctx.globalAlpha = 0.2;
    ctx.beginPath();
    ctx.arc(0, 0, cl * 0.8, 0, Math.PI * 2);
    ctx.fill();

    // Engine flame
    if (car.speed > 0.5) {
      const flameLen = (8 + car.speed * 4) * scale;
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = g.zoneStatus === 'optimal' ? '#4ade80' : '#ff6b00';
      ctx.beginPath();
      ctx.moveTo(-cl * 0.5, -cw * 0.15);
      ctx.lineTo(-cl * 0.5, cw * 0.15);
      ctx.lineTo(-cl * 0.5 - flameLen + Math.sin(g.tick * 0.5) * 3 * scale, 0);
      ctx.closePath();
      ctx.fill();
    }

    // Car body
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#1a1a3e';
    ctx.beginPath();
    ctx.moveTo(cl * 0.6, 0);
    ctx.lineTo(cl * 0.2, -cw * 0.55);
    ctx.lineTo(-cl * 0.5, -cw * 0.5);
    ctx.lineTo(-cl * 0.5, cw * 0.5);
    ctx.lineTo(cl * 0.2, cw * 0.55);
    ctx.closePath();
    ctx.fill();

    // Body outline
    ctx.strokeStyle = carGlow;
    ctx.lineWidth = 1.5 * scale;
    ctx.stroke();

    // Cockpit
    ctx.fillStyle = 'rgba(100, 140, 255, 0.3)';
    ctx.beginPath();
    ctx.ellipse(cl * 0.05, 0, cl * 0.15, cw * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();

    // Fuel number on car
    ctx.font = `bold ${8 * scale}px Orbitron, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.shadowBlur = 4 * scale;
    ctx.shadowColor = carGlow;
    ctx.fillText(Math.round(car.fuelNumber), cl * 0.05, 0);
    ctx.shadowBlur = 0;

    ctx.restore();

    // ── Particles ───────────────────────────────────────────────────
    g.particles.forEach(p => {
      const sx = toScreenX(p.x), sy = toScreenY(p.y);
      if (sx < -20 || sx > W + 20 || sy < -20 || sy > H + 20) return;
      const alpha = p.life / p.maxLife;
      ctx.globalAlpha = alpha * alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(sx, sy, p.r * scale, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    // ── Text Effects ────────────────────────────────────────────────
    g.texts.forEach(t => {
      const sx = toScreenX(t.x), sy = toScreenY(t.y);
      const alpha = t.life / t.maxLife;
      ctx.globalAlpha = alpha;
      ctx.font = `bold ${t.size * scale}px Exo 2, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillText(t.text, sx + 1, sy + 1);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, sx, sy);
    });
    ctx.globalAlpha = 1;

    ctx.restore();
  }

  // ── Input ───────────────────────────────────────────────────────────────

  useEffect(() => {
    const onDown = (e) => {
      keysRef.current[e.key] = true;
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(e.key)) {
        e.preventDefault();
      }
    };
    const onUp = (e) => { keysRef.current[e.key] = false; };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, []);

  // ── Game Loop ─────────────────────────────────────────────────────────────

  useEffect(() => {
    if (screen !== 'playing') {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      return;
    }
    initGame();
    prevTimeRef.current = performance.now();

    const tick = (now) => {
      const raw = (now - prevTimeRef.current) / 16.667;
      const dt = Math.min(raw, 3);
      prevTimeRef.current = now;
      update(dt);
      draw();
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [screen, initGame]);

  // ── Resize ────────────────────────────────────────────────────────────────

  useEffect(() => {
    const onResize = () => {
      const g = gRef.current;
      if (!g || !wrapRef.current || !canvasRef.current) return;
      const W = wrapRef.current.clientWidth;
      const H = wrapRef.current.clientHeight;
      canvasRef.current.width = W;
      canvasRef.current.height = H;
      g.W = W;
      g.H = H;
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // ── Format Time ───────────────────────────────────────────────────────────

  function formatTime(secs) {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    const ms = Math.floor((secs % 1) * 10);
    return `${m}:${String(s).padStart(2, '0')}.${ms}`;
  }

  function positionSuffix(pos) {
    if (pos === 1) return '1ST';
    if (pos === 2) return '2ND';
    if (pos === 3) return '3RD';
    return '4TH';
  }

  // ── Screens ───────────────────────────────────────────────────────────────

  // ── INTRO ──────────────────────────────────────────────────────────────
  if (screen === 'intro') {
    return (
      <div className="nk-root">
        <style>{styles}</style>
        <div className="nk-intro">
          {Array.from({ length: 50 }, (_, i) => (
            <div key={i} className="nk-star" style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              width: `${1 + Math.random() * 2}px`,
              height: `${1 + Math.random() * 2}px`,
              animationDelay: `${Math.random() * 3}s`,
              animationDuration: `${2 + Math.random() * 2}s`,
            }} />
          ))}
          <div className="nk-scanlines" />

          <div className="nk-logo-wrap">
            <div className="nk-deco-line nk-deco-left" />
            <h1 className="nk-title">NUMBERKART</h1>
            <div className="nk-deco-line nk-deco-right" />
          </div>
          <p className="nk-subtitle">EQUATION RALLY</p>

          <div className="nk-card">
            <h2 className="nk-card-title">HOW TO RACE</h2>
            <div className="nk-info-grid">
              <div className="nk-info-item">
                <span className="nk-info-icon" style={{ color: '#4ade80' }}>&#x26FD;</span>
                <div>
                  <strong>Fuel is a Formula</strong>
                  <span>Your fuel is a number (0-99) that drains over time. Collect math pickups to adjust it!</span>
                </div>
              </div>
              <div className="nk-info-item">
                <span className="nk-info-icon" style={{ color: '#ffd700' }}>&#x1F3AF;</span>
                <div>
                  <strong>Target Zone</strong>
                  <span>Keep fuel IN the target zone for a speed boost. Above = overheat, below = stalling!</span>
                </div>
              </div>
              <div className="nk-info-item">
                <span className="nk-info-icon" style={{ color: '#a78bfa' }}>&#x1F500;</span>
                <div>
                  <strong>Split Paths</strong>
                  <span>Solve equations at track forks. Correct answer = shortcut!</span>
                </div>
              </div>
              <div className="nk-info-item">
                <span className="nk-info-icon" style={{ color: '#ef4444' }}>&#x1F3CE;</span>
                <div>
                  <strong>Race to Win</strong>
                  <span>3 laps, 3 AI opponents. Zone shifts each lap!</span>
                </div>
              </div>
            </div>
          </div>

          <div className="nk-card nk-ops-card">
            <h2 className="nk-card-title">CONTROLS</h2>
            <div className="nk-controls">
              <span><kbd>W</kbd>/<kbd>&#x2191;</kbd> Accelerate</span>
              <span><kbd>S</kbd>/<kbd>&#x2193;</kbd> Brake</span>
              <span><kbd>A</kbd>/<kbd>&#x2190;</kbd> Steer Left</span>
              <span><kbd>D</kbd>/<kbd>&#x2192;</kbd> Steer Right</span>
            </div>
          </div>

          <button className="nk-btn nk-btn-primary" onClick={() => setScreen('playing')}>
            START RACE
          </button>
        </div>
      </div>
    );
  }

  // ── GAME OVER ──────────────────────────────────────────────────────────
  if (screen === 'gameover') {
    const posColors = ['#ffd700', '#c0c0c0', '#cd7f32', '#888'];
    return (
      <div className="nk-root">
        <style>{styles}</style>
        <div className="nk-gameover">
          {Array.from({ length: 35 }, (_, i) => (
            <div key={i} className="nk-star" style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              width: `${1 + Math.random() * 2}px`,
              height: `${1 + Math.random() * 2}px`,
              animationDelay: `${Math.random() * 3}s`,
              animationDuration: `${2 + Math.random() * 2}s`,
            }} />
          ))}
          <div className="nk-scanlines" />

          <h1 className="nk-go-title" style={{ color: hud.finalPosition === 1 ? '#ffd700' : '#ef4444' }}>
            {hud.finalPosition === 1 ? 'VICTORY!' : 'RACE COMPLETE'}
          </h1>

          <div className="nk-card nk-results-card">
            <h2 className="nk-card-title">RESULTS</h2>
            <div className="nk-results-table">
              {hud.aiPositions.map((carIdx, rank) => {
                const isPlayer = carIdx === 0;
                const name = isPlayer ? 'YOU' : AI_NAMES[carIdx - 1];
                const color = isPlayer ? '#6c8cff' : AI_COLORS[carIdx - 1];
                return (
                  <div key={rank} className={`nk-result-row ${isPlayer ? 'nk-result-player' : ''}`}>
                    <span className="nk-result-pos" style={{ color: posColors[rank] }}>
                      {positionSuffix(rank + 1)}
                    </span>
                    <span className="nk-result-name" style={{ color }}>{name}</span>
                    <span className="nk-result-time">
                      {isPlayer ? formatTime(hud.finalTime) : '--:--.--'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="nk-card nk-stats-card">
            <div className="nk-stat">
              <span className="nk-stat-label">POSITION</span>
              <span className="nk-stat-value" style={{ color: posColors[hud.finalPosition - 1] }}>
                {positionSuffix(hud.finalPosition)}
              </span>
            </div>
            <div className="nk-stat-divider" />
            <div className="nk-stat">
              <span className="nk-stat-label">TIME</span>
              <span className="nk-stat-value">{formatTime(hud.finalTime)}</span>
            </div>
          </div>

          <div className="nk-go-btns">
            <button className="nk-btn nk-btn-primary" onClick={() => setScreen('playing')}>
              RACE AGAIN
            </button>
            <button className="nk-btn nk-btn-secondary" onClick={() => setScreen('intro')}>
              Back to Menu
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── PLAYING ────────────────────────────────────────────────────────────
  const zoneColor = hud.zoneStatus === 'optimal' ? '#4ade80' : hud.zoneStatus === 'overheat' ? '#ef4444' : '#888';
  const zonePct = clamp((hud.fuelNumber - 0) / 99 * 100, 0, 100);
  const zoneLoFrac = hud.zoneLo / 99 * 100;
  const zoneHiFrac = hud.zoneHi / 99 * 100;

  return (
    <div className="nk-root">
      <style>{styles}</style>
      <div className="nk-game" ref={wrapRef}>
        <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />

        {/* Countdown overlay */}
        {hud.countdown > 0 && (
          <div className="nk-countdown">
            <span className="nk-countdown-text" key={hud.countdownText}>
              {hud.countdownText}
            </span>
          </div>
        )}

        {/* GO! flash */}
        {hud.countdown <= 0 && hud.countdownText === 'GO!' && (
          <div className="nk-countdown nk-go-flash">
            <span className="nk-countdown-text nk-go-text">GO!</span>
          </div>
        )}

        {/* HUD Top */}
        <div className="nk-hud-top">
          <div className="nk-hud-left">
            <div className="nk-lap-badge">
              <span className="nk-lap-label">LAP</span>
              <span className="nk-lap-value">{hud.lap}/{hud.totalLaps}</span>
            </div>
            <div className="nk-pos-badge" style={{ '--pc': hud.position === 1 ? '#ffd700' : hud.position === 2 ? '#c0c0c0' : '#cd7f32' }}>
              {positionSuffix(hud.position)}
            </div>
          </div>

          {/* Fuel Gauge */}
          <div className="nk-hud-center">
            <div className="nk-fuel-gauge">
              <span className="nk-fuel-label">FUEL</span>
              <span className="nk-fuel-num" style={{ color: zoneColor, textShadow: `0 0 15px ${zoneColor}` }}>
                {hud.fuelNumber}
              </span>
              <div className="nk-zone-bar">
                <div className="nk-zone-fill" style={{ width: `${zonePct}%`, background: zoneColor }} />
                <div className="nk-zone-target" style={{ left: `${zoneLoFrac}%`, width: `${zoneHiFrac - zoneLoFrac}%` }} />
              </div>
              <div className="nk-zone-labels">
                <span>{hud.zoneLo}</span>
                <span className="nk-zone-status" style={{ color: zoneColor }}>
                  {hud.zoneStatus === 'optimal' ? 'OPTIMAL' : hud.zoneStatus === 'overheat' ? 'OVERHEAT' : 'STALLING'}
                </span>
                <span>{hud.zoneHi}</span>
              </div>
            </div>
          </div>

          {/* Mini-map */}
          <div className="nk-hud-right">
            <MiniMap trackData={trackDataRef.current} gRef={gRef} />
            <div className="nk-time-display">
              {formatTime(hud.raceTime)}
            </div>
          </div>
        </div>

        {/* Fork equation banner */}
        {hud.showFork && hud.forkEquation && (
          <div className="nk-fork-banner">
            <span className="nk-fork-eq">{hud.forkEquation.eqText}</span>
          </div>
        )}

        {/* Speed bar */}
        <div className="nk-speed-bar-wrap">
          <div className="nk-speed-bar-fill" style={{ width: `${clamp(hud.speed / 100 * 100, 0, 100)}%`, background: zoneColor }} />
          <span className="nk-speed-bar-text">{hud.speed} km/h</span>
        </div>
      </div>
    </div>
  );
}

// ── Mini-Map Component ──────────────────────────────────────────────────────

function MiniMap({ trackData, gRef }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !trackData) return;
    const ctx = canvas.getContext('2d');
    const size = 100;
    canvas.width = size;
    canvas.height = size;

    const { spine } = trackData;
    // Find bounds
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const sp of spine) {
      if (sp.x < minX) minX = sp.x;
      if (sp.x > maxX) maxX = sp.x;
      if (sp.y < minY) minY = sp.y;
      if (sp.y > maxY) maxY = sp.y;
    }
    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const scale = (size - 16) / Math.max(rangeX, rangeY);
    const offX = (size - rangeX * scale) / 2;
    const offY = (size - rangeY * scale) / 2;

    const drawMap = () => {
      const g = gRef.current;
      if (!g) return;

      ctx.clearRect(0, 0, size, size);
      ctx.fillStyle = 'rgba(8, 12, 24, 0.8)';
      ctx.fillRect(0, 0, size, size);

      // Track outline
      ctx.strokeStyle = 'rgba(108, 140, 255, 0.4)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < spine.length; i += 10) {
        const sx = (spine[i].x - minX) * scale + offX;
        const sy = (spine[i].y - minY) * scale + offY;
        if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
      }
      ctx.closePath();
      ctx.stroke();

      // AI dots
      g.aiCars.forEach(ai => {
        const ax = (ai.x - minX) * scale + offX;
        const ay = (ai.y - minY) * scale + offY;
        ctx.fillStyle = ai.color;
        ctx.beginPath();
        ctx.arc(ax, ay, 3, 0, Math.PI * 2);
        ctx.fill();
      });

      // Player dot
      const px = (g.car.x - minX) * scale + offX;
      const py = (g.car.y - minY) * scale + offY;
      ctx.fillStyle = '#fff';
      ctx.shadowBlur = 4;
      ctx.shadowColor = '#6c8cff';
      ctx.beginPath();
      ctx.arc(px, py, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    };

    const interval = setInterval(drawMap, 100);
    return () => clearInterval(interval);
  }, [trackData, gRef]);

  return (
    <canvas ref={canvasRef} className="nk-minimap" width={100} height={100} />
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = `
@import url('https://fonts.googleapis.com/css2?family=Exo+2:wght@300;400;500;600;700;800;900&family=Orbitron:wght@400;500;600;700;800;900&family=Rajdhani:wght@400;500;600;700&display=swap');

:root {
  --nk-bg: #04060e;
  --nk-surface: rgba(255,255,255,0.03);
  --nk-border: rgba(255,255,255,0.06);
  --nk-glass: rgba(8,12,24,0.7);
  --nk-glass-border: rgba(100,140,255,0.12);
  --nk-text: #c8d6e5;
  --nk-text-dim: #4a5568;
  --nk-accent: #6c8cff;
}

.nk-root {
  width: 100%; height: 100%;
  font-family: 'Exo 2', sans-serif;
  color: var(--nk-text);
  background: var(--nk-bg);
  overflow: hidden;
}

/* Stars */
.nk-star {
  position: absolute;
  background: #c8d6e5;
  border-radius: 50%;
  animation: nkTwinkle 2s ease-in-out infinite alternate;
  pointer-events: none;
}
@keyframes nkTwinkle {
  0% { opacity: 0.2; transform: scale(0.8); }
  100% { opacity: 1; transform: scale(1.2); }
}
.nk-scanlines {
  position: absolute; inset: 0;
  background: repeating-linear-gradient(0deg, transparent 0px, transparent 2px, rgba(0,0,0,0.03) 2px, rgba(0,0,0,0.03) 4px);
  pointer-events: none; z-index: 1;
}

/* Intro / Gameover */
.nk-intro, .nk-gameover {
  position: relative;
  width: 100%; height: 100%;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: 16px; padding: 20px;
  overflow-y: auto;
  animation: nkFadeUp 0.8s ease;
}
@keyframes nkFadeUp {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}

.nk-logo-wrap { display: flex; align-items: center; gap: 16px; }
.nk-deco-line {
  width: 60px; height: 2px;
  background: linear-gradient(90deg, transparent, var(--nk-accent), transparent);
  animation: nkDecoGlow 2s ease-in-out infinite alternate;
}
@keyframes nkDecoGlow {
  0% { opacity: 0.3; box-shadow: 0 0 6px var(--nk-accent); }
  100% { opacity: 1; box-shadow: 0 0 16px var(--nk-accent); }
}

.nk-title {
  font-family: 'Orbitron', monospace;
  font-size: clamp(28px, 6vw, 56px);
  font-weight: 900; letter-spacing: 4px; color: #fff;
  text-shadow: 0 0 30px var(--nk-accent), 0 0 60px rgba(108,140,255,0.3);
  animation: nkTitleShimmer 4s ease-in-out infinite;
}
@keyframes nkTitleShimmer {
  0%, 100% { text-shadow: 0 0 30px #6c8cff, 0 0 60px rgba(108,140,255,0.3); }
  33% { text-shadow: 0 0 30px #a78bfa, 0 0 60px rgba(167,139,250,0.3); }
  66% { text-shadow: 0 0 30px #38bdf8, 0 0 60px rgba(56,189,248,0.3); }
}
.nk-subtitle {
  font-family: 'Rajdhani', sans-serif;
  font-size: clamp(14px, 2.5vw, 22px);
  font-weight: 600; letter-spacing: 8px;
  color: var(--nk-text-dim); margin-top: -8px;
}

/* Cards */
.nk-card {
  background: var(--nk-glass);
  border: 1px solid var(--nk-glass-border);
  border-radius: 12px; padding: 16px 20px;
  backdrop-filter: blur(12px);
  max-width: 480px; width: 100%;
}
.nk-card-title {
  font-family: 'Rajdhani', sans-serif;
  font-size: 13px; font-weight: 700;
  letter-spacing: 3px; color: var(--nk-accent);
  margin-bottom: 12px; text-align: center;
}
.nk-info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.nk-info-item { display: flex; gap: 8px; align-items: flex-start; }
.nk-info-icon { font-size: 18px; flex-shrink: 0; margin-top: 1px; }
.nk-info-item strong {
  display: block; font-family: 'Rajdhani', sans-serif;
  font-size: 13px; font-weight: 700; color: #fff;
}
.nk-info-item span { font-size: 11px; color: var(--nk-text-dim); line-height: 1.3; }

.nk-ops-card { max-width: 400px; }
.nk-controls {
  display: grid; grid-template-columns: 1fr 1fr; gap: 8px;
  font-size: 12px; color: var(--nk-text-dim);
}
.nk-controls kbd {
  display: inline-block; padding: 2px 7px;
  font-family: 'Orbitron', monospace; font-size: 10px;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 4px; color: var(--nk-text);
}

/* Buttons */
.nk-btn {
  font-family: 'Rajdhani', sans-serif;
  font-weight: 700; letter-spacing: 2px;
  border: none; border-radius: 8px;
  cursor: pointer; transition: all 0.2s;
  position: relative; overflow: hidden;
}
.nk-btn-primary {
  font-size: 16px; padding: 12px 40px;
  background: linear-gradient(135deg, #6c8cff, #a78bfa);
  color: #fff; box-shadow: 0 0 20px rgba(108,140,255,0.3);
}
.nk-btn-primary:hover {
  box-shadow: 0 0 30px rgba(108,140,255,0.5);
  transform: translateY(-2px);
}
.nk-btn-primary::after {
  content: ''; position: absolute; inset: 0;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.15), transparent);
  transform: translateX(-100%);
  animation: nkBtnShine 3s linear infinite;
}
@keyframes nkBtnShine {
  0% { transform: translateX(-100%); }
  50%, 100% { transform: translateX(100%); }
}
.nk-btn-secondary {
  font-size: 13px; padding: 8px 24px;
  background: var(--nk-surface);
  color: var(--nk-text-dim);
  border: 1px solid var(--nk-border);
}
.nk-btn-secondary:hover {
  color: var(--nk-text);
  border-color: var(--nk-glass-border);
}

/* Game Over */
.nk-go-title {
  font-family: 'Orbitron', monospace;
  font-size: clamp(24px, 5vw, 42px);
  font-weight: 900;
  text-shadow: 0 0 30px currentColor;
}
.nk-go-btns { display: flex; flex-direction: column; gap: 8px; align-items: center; }

/* Results */
.nk-results-card { max-width: 400px; }
.nk-results-table { display: flex; flex-direction: column; gap: 6px; }
.nk-result-row {
  display: flex; align-items: center; gap: 12px;
  padding: 6px 10px; border-radius: 6px;
  background: rgba(255,255,255,0.02);
}
.nk-result-player { background: rgba(108,140,255,0.08); border: 1px solid rgba(108,140,255,0.15); }
.nk-result-pos {
  font-family: 'Orbitron', monospace;
  font-size: 14px; font-weight: 700; width: 40px;
}
.nk-result-name {
  font-family: 'Rajdhani', sans-serif;
  font-size: 14px; font-weight: 700; flex: 1;
}
.nk-result-time {
  font-family: 'Orbitron', monospace;
  font-size: 12px; color: var(--nk-text-dim);
}

/* Stats */
.nk-stats-card {
  display: flex; align-items: center; justify-content: center;
  gap: 20px; max-width: 320px;
}
.nk-stat { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.nk-stat-label {
  font-family: 'Rajdhani', sans-serif;
  font-size: 11px; font-weight: 600;
  letter-spacing: 2px; color: var(--nk-text-dim);
}
.nk-stat-value {
  font-family: 'Orbitron', monospace;
  font-size: 28px; font-weight: 700; color: #fff;
}
.nk-stat-divider {
  width: 1px; height: 40px;
  background: linear-gradient(transparent, var(--nk-glass-border), transparent);
}

/* Playing Screen */
.nk-game { position: relative; width: 100%; height: 100%; }

/* Countdown */
.nk-countdown {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  pointer-events: none; z-index: 30;
}
.nk-countdown-text {
  font-family: 'Orbitron', monospace;
  font-size: clamp(48px, 12vw, 120px);
  font-weight: 900; color: #fff;
  text-shadow: 0 0 40px var(--nk-accent), 0 0 80px rgba(108,140,255,0.4);
  animation: nkCountPop 0.6s cubic-bezier(0.17, 0.89, 0.32, 1.5);
}
.nk-go-flash {
  animation: nkGoFlash 1.5s ease forwards;
}
.nk-go-text { color: #4ade80; text-shadow: 0 0 40px #4ade80, 0 0 80px rgba(74,222,128,0.4); }
@keyframes nkCountPop {
  0% { transform: scale(2); opacity: 0; }
  50% { transform: scale(0.9); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
}
@keyframes nkGoFlash {
  0% { opacity: 1; }
  70% { opacity: 1; }
  100% { opacity: 0; }
}

/* HUD */
.nk-hud-top {
  position: absolute; top: 0; left: 0; right: 0;
  display: flex; justify-content: space-between;
  align-items: flex-start; padding: 12px 16px;
  pointer-events: none; z-index: 20;
}
.nk-hud-left, .nk-hud-right { display: flex; flex-direction: column; gap: 6px; }
.nk-hud-center { display: flex; flex-direction: column; align-items: center; }

/* Lap badge */
.nk-lap-badge {
  background: var(--nk-glass);
  border: 1px solid var(--nk-glass-border);
  border-radius: 8px; padding: 4px 10px;
  backdrop-filter: blur(8px);
}
.nk-lap-label {
  font-family: 'Rajdhani', sans-serif;
  font-size: 9px; font-weight: 600;
  letter-spacing: 2px; color: var(--nk-text-dim); display: block;
}
.nk-lap-value {
  font-family: 'Orbitron', monospace;
  font-size: 18px; font-weight: 700; color: #fff;
}

/* Position badge */
.nk-pos-badge {
  background: var(--nk-glass);
  border: 1px solid var(--nk-glass-border);
  border-radius: 8px; padding: 4px 10px;
  backdrop-filter: blur(8px);
  font-family: 'Orbitron', monospace;
  font-size: 16px; font-weight: 800;
  color: var(--pc);
  text-shadow: 0 0 10px var(--pc);
}

/* Fuel gauge */
.nk-fuel-gauge {
  background: var(--nk-glass);
  border: 1px solid var(--nk-glass-border);
  border-radius: 12px; padding: 6px 16px;
  backdrop-filter: blur(12px); text-align: center;
  min-width: 160px;
}
.nk-fuel-label {
  font-family: 'Rajdhani', sans-serif;
  font-size: 9px; font-weight: 600;
  letter-spacing: 3px; color: var(--nk-text-dim); display: block;
}
.nk-fuel-num {
  font-family: 'Orbitron', monospace;
  font-size: 32px; font-weight: 900;
  display: block; line-height: 1;
}
.nk-zone-bar {
  position: relative; width: 100%; height: 8px;
  background: rgba(255,255,255,0.05);
  border-radius: 4px; margin-top: 6px; overflow: hidden;
}
.nk-zone-fill {
  position: absolute; left: 0; top: 0; height: 100%;
  border-radius: 4px; transition: width 0.1s, background 0.3s;
}
.nk-zone-target {
  position: absolute; top: -1px; height: 10px;
  border: 1px solid rgba(255,255,255,0.3);
  border-radius: 2px;
  background: rgba(255,255,255,0.08);
}
.nk-zone-labels {
  display: flex; justify-content: space-between;
  font-family: 'Orbitron', monospace;
  font-size: 8px; color: var(--nk-text-dim);
  margin-top: 2px;
}
.nk-zone-status {
  font-family: 'Rajdhani', sans-serif;
  font-size: 10px; font-weight: 700;
  letter-spacing: 2px;
}

/* Mini-map */
.nk-minimap {
  border: 1px solid var(--nk-glass-border);
  border-radius: 8px;
  width: 100px; height: 100px;
}

/* Time */
.nk-time-display {
  background: var(--nk-glass);
  border: 1px solid var(--nk-glass-border);
  border-radius: 8px; padding: 3px 8px;
  backdrop-filter: blur(8px);
  font-family: 'Orbitron', monospace;
  font-size: 12px; color: var(--nk-text-dim);
  text-align: center;
}

/* Fork banner */
.nk-fork-banner {
  position: absolute; top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  background: rgba(8, 12, 24, 0.9);
  border: 2px solid #ffd700;
  border-radius: 12px; padding: 12px 24px;
  z-index: 25; pointer-events: none;
  animation: nkForkPulse 1s ease-in-out infinite alternate;
}
@keyframes nkForkPulse {
  0% { box-shadow: 0 0 10px rgba(255,215,0,0.3); }
  100% { box-shadow: 0 0 25px rgba(255,215,0,0.6); }
}
.nk-fork-eq {
  font-family: 'Orbitron', monospace;
  font-size: clamp(18px, 3vw, 28px);
  font-weight: 700; color: #ffd700;
  text-shadow: 0 0 10px rgba(255,215,0,0.4);
}

/* Speed bar */
.nk-speed-bar-wrap {
  position: absolute; bottom: 12px; left: 50%;
  transform: translateX(-50%);
  width: 200px; height: 20px;
  background: var(--nk-glass);
  border: 1px solid var(--nk-glass-border);
  border-radius: 10px; overflow: hidden;
  z-index: 20;
}
.nk-speed-bar-fill {
  height: 100%; border-radius: 10px;
  transition: width 0.1s, background 0.3s;
}
.nk-speed-bar-text {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  font-family: 'Orbitron', monospace;
  font-size: 10px; font-weight: 600; color: #fff;
  text-shadow: 0 0 4px rgba(0,0,0,0.8);
}

/* Responsive */
@media (max-width: 500px) {
  .nk-info-grid { grid-template-columns: 1fr; }
  .nk-deco-line { display: none; }
  .nk-controls { grid-template-columns: 1fr; gap: 4px; }
  .nk-fuel-num { font-size: 24px; }
  .nk-fuel-gauge { min-width: 120px; padding: 4px 10px; }
  .nk-minimap { width: 70px; height: 70px; }
  .nk-stats-card { gap: 12px; }
  .nk-stat-value { font-size: 22px; }
  .nk-speed-bar-wrap { width: 150px; }
}
`;
