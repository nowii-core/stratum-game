(() => {
'use strict';
const canvas = document.getElementById('c');
const scoreEl = document.getElementById('score');
const perfectEl = document.getElementById('perfect');
const card = document.getElementById('card');
const gl = canvas.getContext('webgl2', { antialias: true, alpha: true });
if (!gl) { card.innerHTML = '<h1>WebGL2 non disponibile</h1><p>Prova con un browser più recente.</p>'; return; }

/* ---------- shader ---------- */
const VS = `#version 300 es
in vec3 aPos; in vec3 aNor;
uniform mat4 uVP; uniform vec3 uCenter; uniform vec3 uSize;
out vec3 vN; out vec3 vL;
void main(){
  vL = aPos; vN = aNor;
  gl_Position = uVP * vec4(uCenter + aPos * uSize, 1.0);
}`;
const FS = `#version 300 es
precision mediump float;
in vec3 vN; in vec3 vL;
uniform vec3 uColor;
out vec4 o;
void main(){
  vec3 n = normalize(vN);
  float key = max(dot(n, normalize(vec3(0.55, 1.0, 0.35))), 0.0);
  float fill = max(dot(n, normalize(vec3(-0.8, 0.3, -0.5))), 0.0);
  vec3 c = uColor * (0.52 + 0.62 * key + 0.12 * fill);
  vec3 t = abs(vL) * (1.0 - abs(n));
  float edge = smoothstep(0.43, 0.5, max(t.x, max(t.y, t.z)));
  c *= 1.0 - 0.14 * edge;
  o = vec4(c, 1.0);
}`;
function sh(type, src) {
  const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}
const prog = gl.createProgram();
gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
gl.linkProgram(prog);
if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
gl.useProgram(prog);
const U = {};
['uVP', 'uCenter', 'uSize', 'uColor'].forEach(n => U[n] = gl.getUniformLocation(prog, n));

/* ---------- cubo ---------- */
const data = [];
const faceDefs = [
  [[1,0,0],[0,1,0],[0,0,1]], [[-1,0,0],[0,1,0],[0,0,1]],
  [[0,1,0],[0,0,1],[1,0,0]], [[0,-1,0],[0,0,1],[1,0,0]],
  [[0,0,1],[1,0,0],[0,1,0]], [[0,0,-1],[1,0,0],[0,1,0]]
];
const order = [[-1,-1],[1,-1],[1,1],[-1,-1],[1,1],[-1,1]];
for (const [n, u, v] of faceDefs) {
  for (const [a, b] of order) {
    for (let k = 0; k < 3; k++) data.push(n[k] * 0.5 + (u[k] * a + v[k] * b) * 0.5);
    data.push(n[0], n[1], n[2]);
  }
}
const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
const vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
const aPos = gl.getAttribLocation(prog, 'aPos'), aNor = gl.getAttribLocation(prog, 'aNor');
gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 24, 0);
gl.enableVertexAttribArray(aNor); gl.vertexAttribPointer(aNor, 3, gl.FLOAT, false, 24, 12);
gl.enable(gl.DEPTH_TEST);

/* ---------- matematica ---------- */
function perspective(fov, a, n, f) {
  const t = 1 / Math.tan(fov / 2);
  return [t / a,0,0,0, 0,t,0,0, 0,0,(f + n) / (n - f),-1, 0,0,2 * f * n / (n - f),0];
}
function lookAt(e, c, up) {
  let z = [e[0]-c[0], e[1]-c[1], e[2]-c[2]]; let l = Math.hypot(...z); z = z.map(v => v / l);
  let x = [up[1]*z[2]-up[2]*z[1], up[2]*z[0]-up[0]*z[2], up[0]*z[1]-up[1]*z[0]]; l = Math.hypot(...x); x = x.map(v => v / l);
  const y = [z[1]*x[2]-z[2]*x[1], z[2]*x[0]-z[0]*x[2], z[0]*x[1]-z[1]*x[0]];
  const d = (p, q) => p[0]*q[0] + p[1]*q[1] + p[2]*q[2];
  return [x[0],y[0],z[0],0, x[1],y[1],z[1],0, x[2],y[2],z[2],0, -d(x,e),-d(y,e),-d(z,e),1];
}
function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++)
    for (let k = 0; k < 4; k++) o[c*4 + r] += a[k*4 + r] * b[c*4 + k];
  return o;
}
function hsl(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360; s /= 100; l /= 100;
  const f = (n) => {
    const k = (n + h * 12) % 12, a = s * Math.min(l, 1 - l);
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

/* ---------- stato di gioco ---------- */
const H = 0.5, BASE = 3.0, RANGE = 4.2;
let blocks, debris, cur, level, score, streak, state, camY, overAt = 0, last = 0;
let best = 0;
try { best = +localStorage.getItem('stratum-best') || 0; } catch (e) {}

function colorFor(l) { return hsl(200 + l * 9, 68, 62); }
function setBg() {
  const h = 200 + level * 9;
  document.body.style.background = `linear-gradient(hsl(${h} 60% 78%), hsl(${h + 30} 70% 93%))`;
}
function spawn() {
  const prev = blocks[blocks.length - 1];
  const axis = level % 2 === 1 ? 0 : 1;
  cur = { x: prev.x, z: prev.z, w: prev.w, d: prev.d, y: level * H, axis, m: -RANGE, dir: 1, color: colorFor(level) };
  cur[axis === 0 ? 'x' : 'z'] = -RANGE;
}
function reset() {
  blocks = [{ x: 0, z: 0, w: BASE, d: BASE, y: -4.75, h: 10, color: colorFor(0) }];
  blocks[0].top = true;
  debris = []; level = 1; score = 0; streak = 0; camY = 0;
  scoreEl.textContent = '0'; setBg(); spawn();
}
function showCard(html) { card.innerHTML = html; card.classList.remove('hidden'); }
function hideCard() { card.classList.add('hidden'); }
function flashPerfect() {
  perfectEl.classList.remove('pop'); void perfectEl.offsetWidth; perfectEl.classList.add('pop');
}

function place() {
  const prev = blocks[blocks.length - 1];
  const i = cur.axis, key = i === 0 ? 'x' : 'z', sk = i === 0 ? 'w' : 'd';
  const delta = cur[key] - prev[key];
  const overlap = prev[sk] - Math.abs(delta);
  if (overlap <= 0) {
    debris.push({ x: cur.x, z: cur.z, w: cur.w, d: cur.d, y: cur.y, vy: 0, color: cur.color });
    state = 'over'; overAt = performance.now(); cur = null;
    if (score > best) { best = score; try { localStorage.setItem('stratum-best', best); } catch (e) {} }
    setTimeout(() => showCard(`<h1>Game over</h1><p>Punteggio: ${score}</p><p>Record: ${best}</p><p class="go">Tocca per riprovare</p>`), 550);
    return;
  }
  if (Math.abs(delta) < 0.1) {
    cur[key] = prev[key]; streak++; flashPerfect();
    if (streak >= 3) cur[sk] = Math.min(BASE, cur[sk] + 0.3);
  } else {
    streak = 0;
    const curL = cur[key] - cur[sk] / 2, curR = cur[key] + cur[sk] / 2;
    const pL = prev[key] - prev[sk] / 2, pR = prev[key] + prev[sk] / 2;
    const keepL = Math.max(curL, pL), keepR = Math.min(curR, pR);
    let dl, dr;
    if (delta > 0) { dl = pR; dr = curR; } else { dl = curL; dr = pL; }
    const dbr = { x: cur.x, z: cur.z, w: cur.w, d: cur.d, y: cur.y, vy: 0, color: cur.color };
    dbr[key] = (dl + dr) / 2; dbr[sk] = dr - dl;
    debris.push(dbr);
    cur[key] = (keepL + keepR) / 2; cur[sk] = keepR - keepL;
  }
  blocks.push({ x: cur.x, z: cur.z, w: cur.w, d: cur.d, y: cur.y, h: H, color: cur.color });
  score++; scoreEl.textContent = score;
  level++; setBg(); spawn();
}

function action() {
  const now = performance.now();
  if (state === 'start') { state = 'play'; hideCard(); }
  else if (state === 'play') place();
  else if (state === 'over' && now - overAt > 500) { reset(); state = 'play'; hideCard(); }
}
window.addEventListener('pointerdown', e => { e.preventDefault(); action(); });
window.addEventListener('keydown', e => {
  if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); if (!e.repeat) action(); }
});

/* ---------- ciclo ---------- */
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(innerWidth * dpr); canvas.height = Math.floor(innerHeight * dpr);
  gl.viewport(0, 0, canvas.width, canvas.height);
}
window.addEventListener('resize', resize); resize();

function drawBox(x, y, z, w, h, d, c) {
  gl.uniform3f(U.uCenter, x, y, z); gl.uniform3f(U.uSize, w, h, d); gl.uniform3f(U.uColor, c[0], c[1], c[2]);
  gl.drawArrays(gl.TRIANGLES, 0, 36);
}

function frame(t) {
  const dt = Math.min(0.05, (t - last) / 1000 || 0); last = t;

  if (cur) {
    const speed = Math.min(9, 4 + level * 0.1);
    cur.m += cur.dir * speed * dt;
    if (cur.m > RANGE) { cur.m = RANGE; cur.dir = -1; }
    if (cur.m < -RANGE) { cur.m = -RANGE; cur.dir = 1; }
    cur[cur.axis === 0 ? 'x' : 'z'] = cur.m;
  }
  for (const d of debris) { d.vy -= 28 * dt; d.y += d.vy * dt; }
  debris = debris.filter(d => d.y > camY - 22);

  const targetY = (state === 'over' ? level - 1 : level) * H;
  camY += (targetY - camY) * Math.min(1, dt * 3);

  const aspect = canvas.width / canvas.height;
  const D = Math.max(15, 17 / aspect);
  const look = [0, camY - 1.0, 0];
  const eye = [look[0] + D * 0.55, look[1] + D * 0.5, look[2] + D * 0.55];
  const vp = mul(perspective(0.62, aspect, 0.1, 200), lookAt(eye, look, [0, 1, 0]));

  gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.uniformMatrix4fv(U.uVP, false, new Float32Array(vp));

  for (const b of blocks) drawBox(b.x, b.y, b.z, b.w, b.h || H, b.d, b.color);
  if (cur) drawBox(cur.x, cur.y, cur.z, cur.w, H, cur.d, cur.color);
  for (const d of debris) drawBox(d.x, d.y, d.z, d.w, H, d.d, d.color);

  requestAnimationFrame(frame);
}

state = 'start';
reset();
requestAnimationFrame(frame);
})();
