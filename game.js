/* =========================================================================
   VIRUS — a Zarch / Virus clone
   Hand-written software 3D renderer on a 2D canvas. No dependencies.
   ========================================================================= */
"use strict";

/* ----------------------------- math helpers ----------------------------- */
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => t * t * (3 - 2 * t);

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* --------------------------------- world -------------------------------- */
const N = 48;            // grid cells per side
const CELL = 7;          // world units per cell
const WORLD = N * CELL;
const WATER = 7;         // sea level
const HMAX = 34;         // peak height

let heights;             // (N+1)*(N+1) vertex heights
let infected;            // N*N land-cell infection (0=clean, >0 infected)
let isLand;              // N*N whether cell is above water
let landCount = 0;

const rng = mulberry32(1337);

function valueNoise(res) {
  const g = [];
  for (let j = 0; j <= res; j++) { g[j] = []; for (let i = 0; i <= res; i++) g[j][i] = rng(); }
  return (u, v) => {                       // u,v in 0..1
    const x = u * res, y = v * res;
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const tx = smooth(x - x0), ty = smooth(y - y0);
    const x1 = Math.min(x0 + 1, res), y1 = Math.min(y0 + 1, res);
    const a = lerp(g[y0][x0], g[y0][x1], tx);
    const b = lerp(g[y1][x0], g[y1][x1], tx);
    return lerp(a, b, ty);
  };
}

function buildTerrain() {
  const n1 = valueNoise(5), n2 = valueNoise(11), n3 = valueNoise(23);
  heights = new Float32Array((N + 1) * (N + 1));
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const u = i / N, v = j / N;
      const dx = u - 0.5, dz = v - 0.5;
      const r = Math.sqrt(dx * dx + dz * dz) * 2.05;       // 0 center -> ~1 edge
      const island = clamp(1 - smooth(clamp(r, 0, 1)), 0, 1);
      let h = island * HMAX * 0.9;
      h += (n1(u, v) - 0.5) * 26 * island;
      h += (n2(u, v) - 0.5) * 12 * island;
      h += (n3(u, v) - 0.5) * 5 * island;
      h -= 6;                                              // sink edges into the sea
      heights[j * (N + 1) + i] = Math.max(h, -5);
    }
  }
  // classify land cells (by their lowest corner) and clear infection
  infected = new Float32Array(N * N);
  isLand = new Uint8Array(N * N);
  landCount = 0;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const c = cellMaxHeight(i, j);
      if (c > WATER + 1.2) { isLand[j * N + i] = 1; landCount++; }
    }
  }
}

const H = (i, j) => heights[j * (N + 1) + i];
function cellMaxHeight(i, j) {
  return Math.max(H(i, j), H(i + 1, j), H(i, j + 1), H(i + 1, j + 1));
}

// bilinear terrain height at world x,z (clamped to map)
function groundAt(wx, wz) {
  const gx = clamp(wx / CELL, 0, N - 0.001);
  const gz = clamp(wz / CELL, 0, N - 0.001);
  const i = Math.floor(gx), j = Math.floor(gz);
  const tx = gx - i, tz = gz - j;
  const a = lerp(H(i, j), H(i + 1, j), tx);
  const b = lerp(H(i, j + 1), H(i + 1, j + 1), tx);
  return Math.max(lerp(a, b, tz), WATER);   // never below water surface for the ship
}

/* ------------------------------ rendering ------------------------------- */
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
let W = 0, Hh = 0, focal = 600;

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth; Hh = window.innerHeight;
  canvas.width = W * dpr; canvas.height = Hh * dpr;
  canvas.style.width = W + "px"; canvas.style.height = Hh + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  focal = (W * 0.5) / Math.tan((62 * Math.PI / 180) / 2);
}
window.addEventListener("resize", resize);

// camera basis (rebuilt each frame from cam position/orientation)
const cam = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0.32 };
let Fx, Fy, Fz, Rx, Ry, Rz, Ux, Uy, Uz;
function buildCamera() {
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
  Fx = cp * sy; Fy = -sp; Fz = cp * cy;              // forward
  // right = normalize(cross(worldUp, F)) with worldUp=(0,1,0) -> (F.z,0,-F.x)
  let rx = Fz, ry = 0, rz = -Fx; const rl = Math.hypot(rx, rz) || 1;
  Rx = rx / rl; Ry = 0; Rz = rz / rl;
  // up = cross(F, R)
  Ux = Fy * Rz - Fz * Ry; Uy = Fz * Rx - Fx * Rz; Uz = Fx * Ry - Fy * Rx;
}

const NEAR = 0.6;
// project world point -> {x,y,depth} (depth<=0 means behind camera)
function project(wx, wy, wz) {
  const dx = wx - cam.x, dy = wy - cam.y, dz = wz - cam.z;
  const cz = dx * Fx + dy * Fy + dz * Fz;
  const cx = dx * Rx + dy * Ry + dz * Rz;
  const cyc = dx * Ux + dy * Uy + dz * Uz;
  if (cz < NEAR) return { x: 0, y: 0, depth: cz };
  const inv = focal / cz;
  return { x: W * 0.5 + cx * inv, y: Hh * 0.5 - cyc * inv, depth: cz };
}

// face list filled every frame, depth-sorted, painted back-to-front
let faces = [];
function pushFace(pts, color, depth, stroke) {
  faces.push({ pts, color, depth, stroke });
}

const LIGHT = (() => { const l = [0.4, 0.78, 0.5]; const m = Math.hypot(...l); return [l[0] / m, l[1] / m, l[2] / m]; })();

function shade(nx, ny, nz, base) {
  const nl = Math.hypot(nx, ny, nz) || 1;
  let d = (nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]) / nl;
  d = clamp(0.35 + 0.75 * Math.max(d, 0), 0, 1.25);
  const r = clamp(base[0] * d, 0, 255) | 0;
  const g = clamp(base[1] * d, 0, 255) | 0;
  const b = clamp(base[2] * d, 0, 255) | 0;
  return `rgb(${r},${g},${b})`;
}

/* --------------------------- terrain face build ------------------------- */
const GREEN_A = [70, 150, 70], GREEN_B = [54, 124, 58];
const ROT_A = [120, 84, 40], ROT_B = [96, 64, 30];
const SAND = [120, 140, 92];
const WATER_COL = [28, 78, 132];

function buildTerrainFaces() {
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const idx = j * N + i;
      const x0 = i * CELL, x1 = (i + 1) * CELL, z0 = j * CELL, z1 = (j + 1) * CELL;
      const h00 = H(i, j), h10 = H(i + 1, j), h01 = H(i, j + 1), h11 = H(i + 1, j + 1);

      // frustum-ish: project corners, skip if all behind
      const p00 = project(x0, h00, z0), p10 = project(x1, h10, z0);
      const p11 = project(x1, h11, z1), p01 = project(x0, h01, z1);
      const anyFront = p00.depth >= NEAR || p10.depth >= NEAR || p11.depth >= NEAR || p01.depth >= NEAR;
      if (!anyFront) continue;
      if (p00.depth < NEAR || p10.depth < NEAR || p11.depth < NEAR || p01.depth < NEAR) continue;

      const depth = (p00.depth + p10.depth + p11.depth + p01.depth) * 0.25;

      // off-screen cull
      const minx = Math.min(p00.x, p10.x, p11.x, p01.x), maxx = Math.max(p00.x, p10.x, p11.x, p01.x);
      const miny = Math.min(p00.y, p10.y, p11.y, p01.y), maxy = Math.max(p00.y, p10.y, p11.y, p01.y);
      if (maxx < -40 || minx > W + 40 || maxy < -40 || miny > Hh + 40) continue;

      // normal from diagonals
      const ax = x1 - x0, ay = h11 - h00, az = z1 - z0;
      const bx = x1 - x0, by = h10 - h01, bz = z0 - z1;
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }

      const maxh = Math.max(h00, h10, h01, h11);
      const checker = (i + j) & 1;
      let base;
      if (maxh <= WATER + 1.2) base = checker ? SAND : [104, 124, 80];   // beach/shallow
      else if (infected[idx] > 0) base = checker ? ROT_A : ROT_B;
      else base = checker ? GREEN_A : GREEN_B;

      pushFace([p00, p10, p11, p01], shade(nx, ny, nz, base), depth, false);

      // water overlay where terrain dips below sea level
      if (Math.min(h00, h10, h01, h11) < WATER) {
        const w00 = project(x0, WATER, z0), w10 = project(x1, WATER, z0);
        const w11 = project(x1, WATER, z1), w01 = project(x0, WATER, z1);
        if (w00.depth >= NEAR && w10.depth >= NEAR && w11.depth >= NEAR && w01.depth >= NEAR) {
          const wd = (w00.depth + w10.depth + w11.depth + w01.depth) * 0.25;
          const wob = 1 + 0.06 * Math.sin(time * 1.5 + i * 0.6 + j * 0.4);
          const wc = `rgba(${(WATER_COL[0]*wob)|0},${(WATER_COL[1]*wob)|0},${(WATER_COL[2]*wob)|0},0.78)`;
          pushFace([w00, w10, w11, w01], wc, wd - 0.01, false);
        }
      }
    }
  }
}

/* --------------------------- generic mesh draw -------------------------- */
// transform local verts by yaw/pitch/roll + translation, then project
function drawMesh(verts, tris, pos, yaw, pitch, roll, baseColor, glow) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const cr = Math.cos(roll), sr = Math.sin(roll);
  const world = verts.map(v => {
    let [x, y, z] = v;
    // roll (Z)
    let x1 = x * cr - y * sr, y1 = x * sr + y * cr, z1 = z;
    // pitch (X)
    let y2 = y1 * cp - z1 * sp, z2 = y1 * sp + z1 * cp, x2 = x1;
    // yaw (Y)
    let x3 = x2 * cy + z2 * sy, z3 = -x2 * sy + z2 * cy, y3 = y2;
    return [x3 + pos.x, y3 + pos.y, z3 + pos.z];
  });
  for (const t of tris) {
    const A = world[t[0]], B = world[t[1]], C = world[t[2]];
    const pA = project(A[0], A[1], A[2]), pB = project(B[0], B[1], B[2]), pC = project(C[0], C[1], C[2]);
    if (pA.depth < NEAR || pB.depth < NEAR || pC.depth < NEAR) continue;
    const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2];
    const vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const col = glow ? baseColor : shade(nx, ny, nz, baseColor);
    pushFace([pA, pB, pC], col, (pA.depth + pB.depth + pC.depth) / 3, false);
  }
}

/* -------------------------------- ship ---------------------------------- */
const SHIP_VERTS = [
  [0, 0, 2.2],    // 0 nose
  [-1.6, 0, -1.6],// 1 back-left
  [1.6, 0, -1.6], // 2 back-right
  [0, 1.1, -0.4], // 3 top
  [0, -0.5, -0.6],// 4 belly
];
const SHIP_TRIS = [[0, 3, 2], [0, 1, 3], [1, 2, 3], [0, 2, 4], [0, 4, 1], [1, 4, 2]];
const SHIP_COL = [180, 205, 230];

const ship = {
  x: WORLD / 2, y: 30, z: WORLD / 2,
  vx: 0, vy: 0, vz: 0,
  yaw: 0, pitch: 0, roll: 0,
  cool: 0, alive: true, invuln: 0,
};

/* ------------------------------ entities -------------------------------- */
let bullets = [];     // {x,y,z,vx,vy,vz,life}
let enemies = [];     // seeders {x,y,z,vx,vy,vz,hp,seedT,target,bob}
let particles = [];   // {x,y,z,vx,vy,vz,life,max,color,size}

const SEED_VERTS = [
  [0, 1.4, 0], [0, -1.4, 0], [1.3, 0, 0], [-1.3, 0, 0], [0, 0, 1.3], [0, 0, -1.3],
];
const SEED_TRIS = [
  [0, 2, 4], [0, 4, 3], [0, 3, 5], [0, 5, 2],
  [1, 4, 2], [1, 3, 4], [1, 5, 3], [1, 2, 5],
];

function spawnExplosion(x, y, z, color, n, spd) {
  for (let k = 0; k < n; k++) {
    const a = rng() * Math.PI * 2, b = (rng() - 0.5) * Math.PI;
    const s = spd * (0.4 + rng());
    particles.push({
      x, y, z,
      vx: Math.cos(a) * Math.cos(b) * s,
      vy: Math.sin(b) * s + 4,
      vz: Math.sin(a) * Math.cos(b) * s,
      life: 0, max: 0.5 + rng() * 0.6, color, size: 1.5 + rng() * 2,
    });
  }
}

/* ------------------------------ game state ------------------------------ */
const GS = { START: 0, PLAY: 1, DEAD: 2, OVER: 3 };
let state = GS.START;
let score = 0, lives = 3, wave = 1;
let time = 0, spawnTimer = 0, spreadTimer = 0, infCount = 0, deadTimer = 0;
let waveTimer = 0;

const el = id => document.getElementById(id);
const ui = {
  hud: el("hud"), score: el("score"), wave: el("wave"), lives: el("livesIcons"),
  alt: el("alt"), infbar: el("infbar"), msg: el("msg"),
  start: el("start"), over: el("gameover"), final: el("final"), goTitle: el("goTitle"),
};

function resetGame() {
  buildTerrain();
  bullets = []; enemies = []; particles = [];
  score = 0; lives = 3; wave = 1; time = 0;
  spawnTimer = 1.5; spreadTimer = 0; waveTimer = 0; infCount = 0;
  respawnShip();
  ship.invuln = 1.5;
  state = GS.PLAY;
  ui.hud.classList.remove("hidden");
  ui.start.classList.add("hidden");
  ui.over.classList.add("hidden");
  flash("");
}

function respawnShip() {
  ship.x = WORLD / 2; ship.z = WORLD / 2;
  ship.y = groundAt(ship.x, ship.z) + 22;
  ship.vx = ship.vy = ship.vz = 0;
  ship.yaw = 0; ship.pitch = 0; ship.roll = 0;
  ship.alive = true; ship.cool = 0; ship.invuln = 2;
}

let flashTimer = 0;
function flash(t, dur = 1.6) { ui.msg.textContent = t; flashTimer = dur; }

/* ------------------------------- input ---------------------------------- */
const keys = {};
addEventListener("keydown", e => {
  if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
  keys[e.code] = true;
});
addEventListener("keyup", e => { keys[e.code] = false; });
let mouseFire = false;
canvas.addEventListener("mousedown", () => { mouseFire = true; });
addEventListener("mouseup", () => { mouseFire = false; });
canvas.addEventListener("contextmenu", e => e.preventDefault());

el("startBtn").onclick = resetGame;
el("restartBtn").onclick = resetGame;

/* ----------------------------- ship physics ----------------------------- */
const GRAV = 17, BOOST = 36, TURN = 2.3, DRAG = 0.72;
const HOVER = GRAV * 0.62;   // passive anti-grav: you sink slowly, but don't plummet
const MAX_TILT = 1.45;       // ~83deg: near-flat lean -> almost all thrust forward, lift dips below gravity so you sink toward the ground
const PITCH_RATE = 3.0;      // how fast tilt responds to W/S

function updateShip(dt) {
  if (!ship.alive) return;
  // turning (A/left rotates left, D/right rotates right)
  if (keys.KeyA || keys.ArrowLeft) ship.yaw -= TURN * dt;
  if (keys.KeyD || keys.ArrowRight) ship.yaw += TURN * dt;

  const fx = Math.sin(ship.yaw), fz = Math.cos(ship.yaw);

  // TILT (pitch): W tilts the nose down, S tilts it up. Tilting alone applies
  // NO motion — it only redirects the thruster when you boost.
  let tiltIn = 0;
  if (keys.KeyW || keys.ArrowUp) tiltIn += 1;
  if (keys.KeyS || keys.ArrowDown) tiltIn -= 1;
  if (tiltIn !== 0) ship.pitch = clamp(ship.pitch + tiltIn * PITCH_RATE * dt, -MAX_TILT, MAX_TILT);
  else ship.pitch = lerp(ship.pitch, 0, 5 * dt);   // ease back to level when released

  // gravity, partly cancelled by passive hover so you sink slowly, not plummet
  ship.vy -= (GRAV - HOVER) * dt;

  // BOOST: the single down-pointing thruster fires along the ship's up axis.
  // Tilt rotates that axis, so thrust splits between vertical (cos) and
  // horizontal (sin) — the more you tilt, the more it drives you forward.
  if (keys.Space) {
    const cp = Math.cos(ship.pitch), sp = Math.sin(ship.pitch);
    ship.vy += BOOST * cp * dt;                 // vertical share
    ship.vx += fx * BOOST * sp * dt;            // horizontal share (along nose)
    ship.vz += fz * BOOST * sp * dt;
  }
  if (keys.ShiftLeft || keys.ShiftRight) { ship.vy -= BOOST * 0.7 * dt; ship.vx *= (1 - 1.4 * dt); ship.vz *= (1 - 1.4 * dt); }

  // drag
  const d = Math.pow(DRAG, dt);
  ship.vx *= d; ship.vz *= d; ship.vy *= Math.pow(0.9, dt);

  ship.x += ship.vx * dt; ship.y += ship.vy * dt; ship.z += ship.vz * dt;

  // keep over the map
  const m = 4;
  if (ship.x < m) { ship.x = m; ship.vx = Math.abs(ship.vx) * 0.4; }
  if (ship.x > WORLD - m) { ship.x = WORLD - m; ship.vx = -Math.abs(ship.vx) * 0.4; }
  if (ship.z < m) { ship.z = m; ship.vz = Math.abs(ship.vz) * 0.4; }
  if (ship.z > WORLD - m) { ship.z = WORLD - m; ship.vz = -Math.abs(ship.vz) * 0.4; }
  if (ship.y > 140) { ship.y = 140; ship.vy = Math.min(ship.vy, 0); }

  // ground / water interaction
  const g = groundAt(ship.x, ship.z);
  const floor = g + 1.4;
  if (ship.y < floor) {
    const impact = -ship.vy;
    const overWater = g <= WATER + 0.05;
    if (overWater || impact > 22) {
      crash(overWater ? "SPLASHDOWN" : "CRASHED");
      return;
    }
    ship.y = floor; ship.vy = 0;
    ship.vx *= Math.pow(0.2, dt); ship.vz *= Math.pow(0.2, dt); // ground friction
  }

  // bank visually when turning (pitch is already set by the tilt controls)
  let bank = 0;
  if (keys.KeyA || keys.ArrowLeft) bank += 0.3;
  if (keys.KeyD || keys.ArrowRight) bank -= 0.3;
  ship.roll = lerp(ship.roll, bank, 5 * dt);

  if (ship.invuln > 0) ship.invuln -= dt;

  // firing
  ship.cool -= dt;
  if ((mouseFire || keys.ControlLeft || keys.ControlRight || keys.KeyL) && ship.cool <= 0) fire();
}

function fire() {
  ship.cool = 0.16;
  // shots follow the ship's nose vector, so pitch (tilt) aims them up/down
  const cp = Math.cos(ship.pitch), sp = Math.sin(ship.pitch);
  const sy = Math.sin(ship.yaw), cy = Math.cos(ship.yaw);
  const dx = cp * sy, dy = -sp, dz = cp * cy;   // forward/nose direction in world space
  const spd = 90;
  const mx = ship.x + dx * 2.6, my = ship.y + dy * 2.6, mz = ship.z + dz * 2.6;
  bullets.push({
    x: mx, y: my, z: mz,
    vx: dx * spd + ship.vx, vy: dy * spd, vz: dz * spd + ship.vz, life: 1.6,
  });
  spawnExplosion(mx, my, mz, [255, 230, 120], 2, 8);
}

function crash(reason) {
  ship.alive = false;
  spawnExplosion(ship.x, ship.y, ship.z, [255, 160, 60], 60, 26);
  spawnExplosion(ship.x, ship.y, ship.z, [255, 240, 180], 30, 16);
  lives--;
  flash(reason, 2);
  state = GS.DEAD; deadTimer = 1.8;
}

/* ------------------------------- bullets -------------------------------- */
function updateBullets(dt) {
  for (let k = bullets.length - 1; k >= 0; k--) {
    const b = bullets[k];
    b.vy -= GRAV * 0.5 * dt;
    b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
    b.life -= dt;
    let dead = b.life <= 0;

    // enemy hits
    for (let e = enemies.length - 1; e >= 0; e--) {
      const en = enemies[e];
      const dx = en.x - b.x, dy = en.y - b.y, dz = en.z - b.z;
      if (dx * dx + dy * dy + dz * dz < 9) {
        en.hp--; dead = true;
        spawnExplosion(b.x, b.y, b.z, [255, 200, 100], 6, 12);
        if (en.hp <= 0) {
          enemies.splice(e, 1);
          score += 100; addScore();
          spawnExplosion(en.x, en.y, en.z, [200, 120, 255], 36, 20);
          spawnExplosion(en.x, en.y, en.z, [255, 255, 200], 18, 12);
          flash("SEEDER DOWN  +100", 1);
        }
        break;
      }
    }
    if (dead) { bullets.splice(k, 1); continue; }

    // ground hit -> cure infected cell
    if (b.x > 0 && b.x < WORLD && b.z > 0 && b.z < WORLD && b.y <= groundAt(b.x, b.z) + 0.3) {
      const ci = clamp(Math.floor(b.x / CELL), 0, N - 1);
      const cj = clamp(Math.floor(b.z / CELL), 0, N - 1);
      cureArea(ci, cj);
      spawnExplosion(b.x, groundAt(b.x, b.z) + 0.5, b.z, [255, 220, 120], 8, 8);
      bullets.splice(k, 1);
    } else if (b.x < -20 || b.x > WORLD + 20 || b.z < -20 || b.z > WORLD + 20 || b.y < -10) {
      bullets.splice(k, 1);
    }
  }
}

function cureArea(ci, cj) {
  let cured = 0;
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
    const i = ci + di, j = cj + dj;
    if (i < 0 || j < 0 || i >= N || j >= N) continue;
    const idx = j * N + i;
    if (infected[idx] > 0) { infected[idx] = 0; cured++; }
  }
  if (cured) { score += cured * 8; addScore(); }
}

/* ------------------------------- enemies -------------------------------- */
function spawnSeeder() {
  // come in from a random edge, high up
  const edge = Math.floor(rng() * 4);
  let x, z;
  if (edge === 0) { x = 0; z = rng() * WORLD; }
  else if (edge === 1) { x = WORLD; z = rng() * WORLD; }
  else if (edge === 2) { x = rng() * WORLD; z = 0; }
  else { x = rng() * WORLD; z = WORLD; }
  enemies.push({
    x, y: 55 + rng() * 20, z,
    vx: 0, vy: 0, vz: 0,
    hp: 2, seedT: 1.5 + rng() * 2,
    target: pickTarget(), bob: rng() * 6.28,
  });
}

function pickTarget() {
  // aim for a clean land cell to infect
  for (let tries = 0; tries < 24; tries++) {
    const i = Math.floor(rng() * N), j = Math.floor(rng() * N);
    if (isLand[j * N + i] && infected[j * N + i] === 0) {
      return { x: (i + 0.5) * CELL, z: (j + 0.5) * CELL };
    }
  }
  return { x: WORLD * 0.5, z: WORLD * 0.5 };
}

function updateEnemies(dt) {
  const SPD = 16 + wave * 1.2;
  for (let e = enemies.length - 1; e >= 0; e--) {
    const en = enemies[e];
    en.bob += dt * 3;
    const tx = en.target.x, tz = en.target.z;
    const ty = groundAt(tx, tz) + 16 + Math.sin(en.bob) * 2;
    let dx = tx - en.x, dy = ty - en.y, dz = tz - en.z;
    const dist = Math.hypot(dx, dy, dz) || 1;
    const acc = SPD;
    en.vx = lerp(en.vx, (dx / dist) * acc, 2 * dt);
    en.vy = lerp(en.vy, (dy / dist) * acc, 2 * dt);
    en.vz = lerp(en.vz, (dz / dist) * acc, 2 * dt);
    en.x += en.vx * dt; en.y += en.vy * dt; en.z += en.vz * dt;

    // drop a seed when over a target
    en.seedT -= dt;
    if (dist < 10 && en.seedT <= 0) {
      dropSeed(tx, tz);
      en.seedT = 1.4 + rng() * 1.6;
      en.target = pickTarget();
    }

    // collide with ship
    if (ship.alive && ship.invuln <= 0) {
      const sdx = en.x - ship.x, sdy = en.y - ship.y, sdz = en.z - ship.z;
      if (sdx * sdx + sdy * sdy + sdz * sdz < 12) {
        crash("HIT BY SEEDER");
        enemies.splice(e, 1);
        spawnExplosion(en.x, en.y, en.z, [200, 120, 255], 24, 18);
      }
    }
  }
}

function dropSeed(x, z) {
  const i = clamp(Math.floor(x / CELL), 0, N - 1);
  const j = clamp(Math.floor(z / CELL), 0, N - 1);
  if (isLand[j * N + i]) infected[j * N + i] = 1;
  spawnExplosion((i + 0.5) * CELL, groundAt(x, z) + 1, (j + 0.5) * CELL, [150, 90, 50], 10, 7);
}

/* ----------------------------- virus spread ----------------------------- */
function spreadVirus() {
  const add = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const idx = j * N + i;
    if (infected[idx] <= 0 || !isLand[idx]) continue;
    // chance to infect a random orthogonal neighbour
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const d = dirs[Math.floor(rng() * 4)];
    const ni = i + d[0], nj = j + d[1];
    if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
    const nidx = nj * N + ni;
    if (isLand[nidx] && infected[nidx] === 0 && rng() < 0.6) add.push(nidx);
  }
  for (const idx of add) infected[idx] = 1;
}

function countInfection() {
  let c = 0;
  for (let k = 0; k < infected.length; k++) if (infected[k] > 0) c++;
  infCount = c;
  return landCount ? c / landCount : 0;
}

/* ----------------------------- particles -------------------------------- */
function updateParticles(dt) {
  for (let k = particles.length - 1; k >= 0; k--) {
    const p = particles[k];
    p.vy -= GRAV * 0.6 * dt;
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    p.life += dt;
    if (p.life >= p.max) particles.splice(k, 1);
  }
}

/* ------------------------------- camera --------------------------------- */
function updateCamera(dt) {
  const fx = Math.sin(ship.yaw), fz = Math.cos(ship.yaw);
  const targetYaw = ship.yaw;
  // smooth yaw toward ship heading (shortest path)
  let dyaw = targetYaw - cam.yaw;
  while (dyaw > Math.PI) dyaw -= Math.PI * 2;
  while (dyaw < -Math.PI) dyaw += Math.PI * 2;
  cam.yaw += dyaw * Math.min(1, 5 * dt);

  const dist = 15, height = 8;
  const desiredX = ship.x - fx * dist;
  const desiredZ = ship.z - fz * dist;
  const desiredY = ship.y + height;
  const k = Math.min(1, 6 * dt);
  cam.x = lerp(cam.x, desiredX, k);
  cam.y = lerp(cam.y, desiredY, k);
  cam.z = lerp(cam.z, desiredZ, k);
  // don't let camera sink into terrain
  const cg = groundAt(cam.x, cam.z) + 3;
  if (cam.y < cg) cam.y = cg;
  cam.pitch = 0.30;
}

/* -------------------------------- draw ---------------------------------- */
function drawShadow(x, z, r, alpha) {
  const gy = groundAt(x, z) + 0.15;
  const pts = [];
  const seg = 10;
  let ok = true;
  for (let s = 0; s < seg; s++) {
    const a = (s / seg) * Math.PI * 2;
    const p = project(x + Math.cos(a) * r, gy, z + Math.sin(a) * r);
    if (p.depth < NEAR) { ok = false; break; }
    pts.push(p);
  }
  if (ok) pushFace(pts, `rgba(0,0,0,${alpha})`, project(x, gy, z).depth - 0.02, false);
}

function drawEntities() {
  // ship shadow + ship
  if (ship.alive) {
    drawShadow(ship.x, ship.z, 2.2, 0.34);
    const blink = ship.invuln > 0 && (Math.floor(time * 12) & 1);
    const col = blink ? [120, 160, 200] : SHIP_COL;
    drawMesh(SHIP_VERTS, SHIP_TRIS, ship, ship.yaw, ship.pitch, ship.roll, col, false);
    // thruster glow
    if (keys.Space) {
      const fx = Math.sin(ship.yaw), fz = Math.cos(ship.yaw);
      spawnExplosion(ship.x - fx * 0.5, ship.y - 1, ship.z - fz * 0.5, [120, 200, 255], 1, 4);
    }
  }

  // seeders
  for (const en of enemies) {
    drawShadow(en.x, en.z, 2.4, 0.22);
    const pulse = 0.5 + 0.5 * Math.sin(en.bob * 2);
    drawMesh(SEED_VERTS, SEED_TRIS, en, en.bob, en.bob * 0.7, 0,
      [150 + pulse * 90 | 0, 70, 200], false);
  }

  // bullets
  for (const b of bullets) {
    const p = project(b.x, b.y, b.z);
    if (p.depth < NEAR) continue;
    const sz = clamp(focal / p.depth * 0.18, 1.5, 7);
    faces.push({ point: p, color: "rgb(255,235,140)", depth: p.depth, r: sz });
  }

  // particles
  for (const pa of particles) {
    const p = project(pa.x, pa.y, pa.z);
    if (p.depth < NEAR) continue;
    const t = 1 - pa.life / pa.max;
    const sz = clamp(focal / p.depth * pa.size * 0.05, 0.8, 14) * (0.4 + t);
    const c = pa.color;
    faces.push({ point: p, color: `rgba(${c[0]},${c[1]},${c[2]},${clamp(t, 0, 1)})`, depth: p.depth, r: sz });
  }
}

function render() {
  faces.length = 0;
  buildCamera();

  // sky gradient
  const sky = ctx.createLinearGradient(0, 0, 0, Hh);
  sky.addColorStop(0, "#0a1830");
  sky.addColorStop(0.55, "#22456b");
  sky.addColorStop(1, "#3b6f8c");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, Hh);

  buildTerrainFaces();
  drawEntities();

  faces.sort((a, b) => b.depth - a.depth);

  for (const f of faces) {
    if (f.point) { // sprite (bullet/particle)
      ctx.beginPath();
      ctx.fillStyle = f.color;
      ctx.arc(f.point.x, f.point.y, f.r, 0, 6.2832);
      ctx.fill();
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(f.pts[0].x, f.pts[0].y);
    for (let i = 1; i < f.pts.length; i++) ctx.lineTo(f.pts[i].x, f.pts[i].y);
    ctx.closePath();
    ctx.fillStyle = f.color;
    ctx.fill();
  }
}

/* ------------------------------ HUD update ------------------------------ */
let pendingScore = 0;
function addScore() { pendingScore = 1; }
function updateHUD() {
  ui.score.textContent = score;
  ui.wave.textContent = wave;
  ui.lives.textContent = lives > 0 ? "▲".repeat(lives) : "—";
  ui.alt.textContent = Math.max(0, (ship.y - groundAt(ship.x, ship.z)) | 0);
  const ratio = countInfection();
  ui.infbar.style.width = (ratio * 100).toFixed(0) + "%";
  ui.infbar.style.background = ratio > 0.45
    ? "linear-gradient(90deg,#e07b3a,#c0392b)"
    : "linear-gradient(90deg,#caa14a,#a35a2a)";
}

/* ------------------------------ main loop ------------------------------- */
let last = performance.now();
function loop(now) {
  let dt = (now - last) / 1000;
  last = now;
  dt = Math.min(dt, 0.05);
  time += dt;

  if (state === GS.PLAY || state === GS.DEAD) {
    updateBullets(dt);
    updateEnemies(dt);
    updateParticles(dt);

    if (state === GS.PLAY) {
      updateShip(dt);

      // spawning & waves
      spawnTimer -= dt;
      const maxEnemies = 2 + Math.floor(wave * 0.7);
      const interval = Math.max(1.0, 4.5 - wave * 0.35);
      if (spawnTimer <= 0 && enemies.length < maxEnemies) {
        spawnSeeder(); spawnTimer = interval;
      }
      waveTimer += dt;
      if (waveTimer > 26) { waveTimer = 0; wave++; flash("WAVE " + wave, 1.4); }

      // virus spread
      spreadTimer -= dt;
      if (spreadTimer <= 0) { spreadVirus(); spreadTimer = 1.1; }

      // lose by infection
      if (countInfection() >= 0.6) endGame(false, "THE ISLAND IS LOST");
    } else { // DEAD
      deadTimer -= dt;
      if (deadTimer <= 0) {
        if (lives <= 0) endGame(false, "GAME OVER");
        else { respawnShip(); state = GS.PLAY; flash("", 0); }
      }
    }
    updateCamera(dt);
  }

  if (flashTimer > 0) { flashTimer -= dt; if (flashTimer <= 0) ui.msg.textContent = ""; }

  render();
  if (state !== GS.START && state !== GS.OVER) updateHUD();

  requestAnimationFrame(loop);
}

function endGame(win, title) {
  state = GS.OVER;
  ui.goTitle.textContent = win ? "ISLAND SAVED" : title;
  ui.final.innerHTML = `SCORE <b style="color:#7fffd4">${score}</b> &nbsp;·&nbsp; WAVE ${wave}`;
  ui.over.classList.remove("hidden");
  ui.hud.classList.add("hidden");
}

/* -------------------------------- boot ---------------------------------- */
resize();
buildTerrain();
// idle camera drift for the start screen
cam.x = WORLD / 2 - 10; cam.y = 50; cam.z = WORLD / 2 - 30; cam.yaw = 0; cam.pitch = 0.45;
requestAnimationFrame(loop);
