/* Twitch Putt - vFinal (Leaderboard: realistic golf scoring + realistic seagull + rounds)
   - Full merged script: adds round capture timer, winners screen, hole-in-one leaderboard
   - Drop this in place of your existing script.js (copy/paste)
*/

console.log("Twitch Putt: script.js loaded");

// optional local WebSocket relay connection (keeps your previous behavior)
try {
  const ws = new WebSocket("ws://localhost:3000");
  ws.onmessage = event => {
    const data = JSON.parse(event.data);
    handleChat(data);
  };
  ws.onopen = () => console.log("🟢 Connected to local server");
  ws.onclose = () => console.log("🔴 Disconnected from local server");
} catch (e) {
  // fail silently if no local server
}

window.addEventListener("load", () => {
  if (typeof tmi === "undefined") {
    console.error("⚠️ tmi.js not found — ensure tmi.min.js is loaded *before* script.js");
    // don't block; user may be using websocket relay
  } else {
    console.log("✅ tmi.js detected successfully");
  }
});

console.log('Twitch Putt - vFinal (Golf Leaderboard + realistic seagull) loaded');

/* ---------- CONFIG ---------- */
const WIDTH = 1920, HEIGHT = 1080;
const ROUGH_ZONE = 60;
const START_Y = HEIGHT - 120;
const BALL_RADIUS = 12;
const HOLE_RADIUS = 16;
const POWER_MAX = 999;
const LOCATIONS = Array.from({length:26},(_,i)=>String.fromCharCode(97+i));

const AIR_DRAG = 0.986;
const SAND_DRAG = 0.88;
const STOP_SPEED = 0.2;
const MAX_LIFE = 4.0;

/* ---------- SAFE DOM CREATION ---------- */
function ensureEl(id, tag='div', styles={}) {
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement(tag);
    el.id = id;
    Object.assign(el.style, styles);
    document.body.appendChild(el);
    console.log(`Created missing element #${id}`);
  }
  return el;
}

// Canvas (create if missing)
let canvas = document.getElementById('gameCanvas');
if (!canvas) {
  canvas = document.createElement('canvas');
  canvas.id = 'gameCanvas';
  document.body.insertBefore(canvas, document.body.firstChild);
}
canvas.width = WIDTH; canvas.height = HEIGHT;
const ctx = canvas.getContext('2d');
if (!ctx) throw new Error('Canvas context not available');

// UI container (create fallback)
const uiRoot = ensureEl('ui', 'div', { position:'absolute', left:'12px', top:'12px', zIndex:2000, color:'#fff', fontFamily:'Arial, sans-serif' });

// Status
const statusEl = ensureEl('status', 'div', { marginBottom: '6px', color:'#ffe36e' });
uiRoot.appendChild(statusEl);

// Test command input + test button (create if missing)
if (!document.getElementById('testCommand')) {
  const tc = document.createElement('div');
  tc.innerHTML = `<input id="testCommand" placeholder="!putt a 50" style="padding:6px;border-radius:6px;border:1px solid #ccc;width:220px"/>
  <button id="testBtn" style="margin-left:6px;padding:6px 8px;">Test Cmd</button>`;
  uiRoot.appendChild(tc);
}

// Connect UI placeholders (if not provided by HTML)
if (!document.getElementById('channelName')) {
  const cwrap = document.createElement('div');
  cwrap.innerHTML = `
    <input id="channelName" placeholder="channel name" style="width:220px;margin-top:8px;padding:6px;border-radius:6px;border:1px solid #ccc;">
    <input id="botName" placeholder="bot username" style="width:220px;margin-top:6px;padding:6px;border-radius:6px;border:1px solid #ccc;">
    <input id="oauthToken" placeholder="oauth token (oauth:...)" style="width:220px;margin-top:6px;padding:6px;border-radius:6px;border:1px solid #ccc;">
    <div style="margin-top:6px;">
      <button id="connectBtn">Connect</button>
      <button id="disconnectBtn">Disconnect</button>
      <button id="resetScores" style="margin-left:6px;">Reset Scores</button>
    </div>
  `;
  uiRoot.appendChild(cwrap);
}

// Banner (center top)
const bannerWrap = ensureEl('banner', 'div', { position:'absolute', top:'10px', left:'50%', transform:'translateX(-50%)', zIndex:3000, padding:'8px 12px', borderRadius:'8px', background:'rgba(0,0,0,0.7)', color:'#fff', opacity:0, transition:'opacity .3s' });
if (!document.getElementById('bannerText')) {
  const bt = document.createElement('div');
  bt.id = 'bannerText';
  bannerWrap.appendChild(bt);
}
const bannerText = document.getElementById('bannerText');

// Scoreboard (create fallback)
const scoreboardPanel = ensureEl('scoreboard', 'div', { position:'absolute', left:'18px', top:'80px', width:'300px', background:'rgba(255,255,255,0.95)', padding:'8px', borderRadius:'8px', zIndex:2500, boxShadow:'0 6px 18px rgba(0,0,0,0.2)' });
if (!scoreboardPanel.querySelector('.title')) {
  scoreboardPanel.innerHTML = `<div class="title" style="font-weight:700;margin-bottom:6px;cursor:grab">Leaderboard</div><div id="lbList"></div>`;
}
const lbList = ensureEl('lbList');

/* ---------- HOLE-IN-ONE PANEL (matches main leaderboard style) ---------- */
const hiPanel = ensureEl('hiLeaderboard', 'div', {
  position: 'absolute',
  left: '340px',
  top: '80px',
  width: '300px',
  background: 'rgba(255,255,255,0.95)',
  padding: '8px',
  borderRadius: '8px',
  zIndex: 2500,
  boxShadow: '0 6px 18px rgba(0,0,0,0.2)',
  fontFamily: 'Fredoka, Arial, sans-serif'
});

hiPanel.innerHTML = `
  <div class="title"
       style="font-weight:700;
              font-size:20px;
              margin-bottom:6px;
              cursor:grab;
              color:#222;
              text-shadow:0 1px 2px rgba(255,255,255,0.4);">
    🏅 Hole-in-One Leaderboard
  </div>
  <div id="hiList"
       style="font-size:16px;
              line-height:1.4;
              color:#222;
              background:rgba(255,255,255,0.85);
              border-radius:6px;
              overflow:hidden;">
  </div>
`;

/* same drag + resize handling as main leaderboard */
(function enableDragForHiPanel() {
  const el = hiPanel;
  const title = el.querySelector('.title');
  let dragging = false, offX = 0, offY = 0;
  title.addEventListener('pointerdown', e => {
    dragging = true;
    offX = e.clientX - el.offsetLeft;
    offY = e.clientY - el.offsetTop;
    title.setPointerCapture?.(e.pointerId);
    title.style.cursor = 'grabbing';
  });
  document.addEventListener('pointermove', e => {
    if (!dragging) return;
    el.style.left = (e.clientX - offX) + 'px';
    el.style.top = (e.clientY - offY) + 'px';
  });
  document.addEventListener('pointerup', e => {
    if (dragging) {
      dragging = false;
      title.style.cursor = 'grab';
      try { title.releasePointerCapture?.(e.pointerId); } catch {}
    }
  });
  el.style.resize = 'both';
  el.style.overflow = 'auto';
})();

/* ---------- STATE ---------- */
let client = null, connectedChannel = null;
const balls = {};  // user -> { user, color, x,y, inHole, moving }
const shots = [];  // moving shots
// scoreboard map: user -> { strokes: n, holes: m } (cumulative)
let scoreboard = {};
// hole-in-one counts: user -> count (persistent)
let holeInOnes = {};
let hole = { x: WIDTH/2, y: 200, r: HOLE_RADIUS };
let sandTraps = [], waterHazards = [], hills = [];
let wind = { angle: 0, speed: 0 };
let seagull = null;
let seagullProbPerFrame = 0.00002; // default conservative

// ROUND: state for "first sink starts 30s window"
let roundActive = false;
let roundWinners = [];      // in-memory current round winners order
let lastRoundWinners = [];  // persisted last winners (shows when no active round)
let perHoleStrokes = {};    // strokes per user for the current hole (reset after round)
let roundTimer = null;
let ROUND_DURATION = 30000; // 30 seconds

/* ---------- STORAGE ---------- */
function saveScores(){ try { localStorage.setItem('twitchGolfScores', JSON.stringify(scoreboard)); } catch(e) { console.warn(e); } }
function loadScores(){ const raw = localStorage.getItem('twitchGolfScores'); if (raw) try { scoreboard = JSON.parse(raw); } catch(e){ console.warn('loadScores failed', e); } }
function saveHoleInOnes(){ try { localStorage.setItem('twitchHI', JSON.stringify(holeInOnes)); } catch(e){} }
function loadHoleInOnes(){ const raw = localStorage.getItem('twitchHI'); if (raw) try { holeInOnes = JSON.parse(raw); } catch(e){ console.warn('loadHI failed', e); } }
function saveLastWinners(){ try { localStorage.setItem('twitchLastWinners', JSON.stringify(lastRoundWinners)); } catch(e){} }
function loadLastWinners(){ const raw = localStorage.getItem('twitchLastWinners'); if (raw) try { lastRoundWinners = JSON.parse(raw); } catch(e){ console.warn('loadLastWinners failed', e); } }
loadScores(); loadHoleInOnes(); loadLastWinners();

/* ---------- UTILS ---------- */
const rand = (a,b) => a + Math.random() * (b - a);
const randInt = (a,b) => Math.floor(rand(a,b+1));
const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
const START_SAFE_RADIUS = 400;
function tooCloseToStart(y){ return y > HEIGHT - START_SAFE_RADIUS; }

/* ---------- TERRAIN ---------- */
function randomizeCourse(){
  hole.x = rand(300, WIDTH - 300);
  hole.y = rand(140, 360);

  hills = [];
  for (let i=0;i<7;i++){
    hills.push({ x: rand(200, WIDTH-200), y: rand(HEIGHT/3, HEIGHT-120), r: rand(120,260), h: rand(0.12,0.35) });
  }

  sandTraps = [];
  for (let i=0;i<4;i++){
    let t, tries=0;
    do {
      t = { x: rand(200, WIDTH-200), y: rand(HEIGHT/2, HEIGHT-220), r: rand(70,110) };
      tries++;
    } while ((tooCloseToStart(t.y) || Math.hypot(t.x - hole.x, t.y - hole.y) < 180) && tries < 40);
    sandTraps.push(t);
  }

  waterHazards = [];
  const waterCount = 1 + Math.floor(Math.random()*2);
  for (let i=0;i<waterCount;i++){
    let w, tries=0;
    do {
      w = { x: rand(300, WIDTH-300), y: rand(HEIGHT/3, HEIGHT-260), r: rand(90,150) };
      tries++;
    } while ((tooCloseToStart(w.y) || Math.hypot(w.x - hole.x, w.y - hole.y) < 220) && tries < 50);
    waterHazards.push(w);
  }

  wind.angle = rand(0, Math.PI*2);
  wind.speed = rand(0.5, 5);

  for (const u in balls){
    balls[u].x = WIDTH/2; balls[u].y = START_Y; balls[u].inHole = false; balls[u].moving = false;
  }
}
randomizeCourse();

function heightAt(x, y) {
  // more dramatic vertical height variation
  const nx = (x - ROUGH_ZONE) / (WIDTH - 2 * ROUGH_ZONE);
  let base = Math.sin(nx * 2.5) * 22 + Math.sin(nx * 5.2) * 9; // increased amplitude
  for (const h of hills) {
    const dx = x - h.x, dy = y - h.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < h.r) base += h.h * (1 - d / h.r) * 38; // stronger hills
  }
  return base;
}

function slopeAt(x, y) {
  const e = 6; // wider slope sampling for smoother but stronger rolls
  return (heightAt(x + e, y) - heightAt(x - e, y)) / (2 * e);
}


/* ---------- BALLS & CHAT ---------- */
function ensureBall(user){
  if (balls[user]) return balls[user];
  const color = `hsl(${Math.floor(Math.random()*360)},70%,60%)`;
  balls[user] = { user, color, x: WIDTH/2, y: START_Y, inHole:false, moving:false };
  refreshUI();
  return balls[user];
}

// Each !putt adds 1 stroke to player's total (real golf: each stroke counts)
function addStrokeToPlayer(user){
  if (!scoreboard[user]) scoreboard[user] = { strokes: 0, holes: 0 };
  scoreboard[user].strokes += 1;
  // per-hole strokes tracking (for hole-in-one detection)
  perHoleStrokes[user] = (perHoleStrokes[user] || 0) + 1;
  saveScores();
}

function handleChat({ username, message }){
  if (!username) return;
  const user = username.toLowerCase();
  const msg = (message||'').trim();
  if (!msg.toLowerCase().startsWith('!putt')) return;
  const parts = msg.split(/\s+/);
  if (parts.length < 3) return;
  const aim = parts[1].toLowerCase();
  if (!LOCATIONS.includes(aim)) return;
  let power = parseInt(parts[2].replace(/[^\-0-9]/g,''),10);
  if (isNaN(power)) power = 1;
  power = clamp(power, -POWER_MAX, POWER_MAX);
  const b = ensureBall(user);
  if (b.moving) return; // per-player lock
  // add stroke BEFORE shot (every attempt is a stroke)
  addStrokeToPlayer(user);

  const idx = LOCATIONS.indexOf(aim);
  const ratio = idx / (LOCATIONS.length - 1);
  const angle = Math.PI - (Math.PI * ratio); // a->left z->right
  const baseVel = (Math.abs(power) / POWER_MAX) * 36;
  const dir = power < 0 ? -1 : 1;
  const vx = Math.cos(angle) * baseVel * dir;
  const vy = -Math.sin(angle) * baseVel * dir;
  const windVx = Math.cos(wind.angle) * wind.speed * 0.18;
  const windVy = -Math.sin(wind.angle) * wind.speed * 0.18;
  b.moving = true;
  shots.push({ user, x: b.x, y: b.y, vx: vx + windVx, vy: vy + windVy, life: 0 });
}

/* Test button wiring */
document.getElementById('testBtn')?.addEventListener('click', ()=> {
  const cmd = document.getElementById('testCommand')?.value.trim();
  if (!cmd) return;
  handleChat({ username: 'Tester', message: cmd });
});

/* ---------- PHYSICS ---------- */
function inZone(x,y,zs){ return zs.some(z => (x - z.x)**2 + (y - z.y)**2 < (z.r ** 2)); }

function safeDropLocation(maxAttempts=80){
  for (let i=0;i<maxAttempts;i++){
    const nx = rand(ROUGH_ZONE + 160, WIDTH - ROUGH_ZONE - 160);
    const ny = rand(160, HEIGHT - 160);
    if (!inZone(nx, ny, waterHazards) && !tooCloseToStart(ny) && Math.hypot(nx - hole.x, ny - hole.y) > 160) {
      return { x: nx, y: ny };
    }
  }
  return { x: WIDTH/2, y: HEIGHT/2 };
}

function stepPhysics(dt = 1/60){
  // seagull spawn controlled by seagullProbPerFrame
  if (!seagull && seagullProbPerFrame > 0 && Math.random() < seagullProbPerFrame) {
    startSeagullEvent(false);
  }
  updateSeagull(dt);

  for (let i = shots.length - 1; i >= 0; i--){
    const s = shots[i];
    s.life += dt;
    s.x += s.vx;
    s.y += s.vy;

    const sl = slopeAt(s.x, s.y) * 0.2;
    s.vx += -sl * 0.6;
    s.vy += sl * 0.2;

    if (inZone(s.x, s.y, sandTraps)) { s.vx *= SAND_DRAG; s.vy *= SAND_DRAG; }
    else { s.vx *= AIR_DRAG; s.vy *= AIR_DRAG; }

    // enforce bounds
    if (s.x < ROUGH_ZONE + BALL_RADIUS) { s.x = ROUGH_ZONE + BALL_RADIUS; s.vx = Math.abs(s.vx) * 0.78; }
    if (s.x > WIDTH - ROUGH_ZONE - BALL_RADIUS) { s.x = WIDTH - ROUGH_ZONE - BALL_RADIUS; s.vx = -Math.abs(s.vx) * 0.78; }
    if (s.y < ROUGH_ZONE + BALL_RADIUS) { s.y = ROUGH_ZONE + BALL_RADIUS; s.vy = Math.abs(s.vy) * 0.78; }
    if (s.y > HEIGHT - ROUGH_ZONE - BALL_RADIUS) { s.y = HEIGHT - ROUGH_ZONE - BALL_RADIUS; s.vy = -Math.abs(s.vy) * 0.78; }

    // water hazard
    if (inZone(s.x, s.y, waterHazards)) {
      const b = balls[s.user];
      if (b) { b.x = WIDTH/2; b.y = START_Y; b.moving = false; }
      shots.splice(i,1);
      showBanner(`${s.user} SPLASH!`);
      continue;
    }

    const sp = Math.hypot(s.vx, s.vy);
    if (sp < STOP_SPEED || s.life > MAX_LIFE) {
      const b = balls[s.user];
      if (b) { b.x = s.x; b.y = s.y; b.moving = false; }
      shots.splice(i,1);
      continue;
    }

    const dx = s.x - hole.x, dy = s.y - hole.y, dist = Math.hypot(dx, dy);
    if (dist < HOLE_RADIUS && sp < 5) {
      // sink handling
     shots.splice(i, 1);
     const b = balls[s.user];
     if (b) { b.x = hole.x; b.y = hole.y; b.inHole = true; b.moving = false; }

     // record hole made (cumulative scoreboard)
     if (!scoreboard[s.user]) scoreboard[s.user] = { strokes: 0, holes: 0 };
     scoreboard[s.user].holes += 1;
     saveScores();

     // detect hole-in-one (perHoleStrokes == 1)
     if ((perHoleStrokes[s.user] || 0) === 1) {
       holeInOnes[s.user] = (holeInOnes[s.user] || 0) + 1;
       saveHoleInOnes();
       showBanner(`${s.user} scored a HOLE IN ONE!`);
     }

     // 🟢 ROUND LOGIC
     if (!roundActive) {
       // first sink starts the round
       roundActive = true;
       roundWinners = [s.user];
       startRoundTimer();
       showBanner(`${s.user} starts the round! 30s to get in (next 3 finishers).`);
     } else if (roundWinners.length < 4 && !roundWinners.includes(s.user)) {
       roundWinners.push(s.user);
       showBanner(`${s.user} finished #${roundWinners.length}!`);
       if (roundWinners.length === 4) {
         // immediate end if 4 finishers
         endRound();
       }
     }

     refreshUI();
     continue;
    }

    const b = balls[s.user];
    if (b) { b.x = s.x; b.y = s.y; b.moving = true; }
  }
}

/* ---------- ROUND COUNTDOWN UI ---------- */
let timerEl = null;
function ensureTimerEl() {
  if (!timerEl) {
    timerEl = document.createElement('div');
    Object.assign(timerEl.style, {
      position: 'absolute',
      top: '20px',
      right: '20px',
      background: 'rgba(0,0,0,0.7)',
      color: '#fff',
      fontFamily: 'Fredoka, Arial, sans-serif',
      fontWeight: '700',
      fontSize: '22px',
      padding: '10px 20px',
      borderRadius: '12px',
      boxShadow: '0 0 20px rgba(0,0,0,0.4)',
      zIndex: 4000,
      transition: 'opacity 0.3s'
    });
    document.body.appendChild(timerEl);
  }
  return timerEl;
}

let countdownInterval = null;
function showRoundCountdown(durationMs) {
  const el = ensureTimerEl();
  let remaining = Math.ceil(durationMs / 1000);
  el.textContent = `⏳ ${remaining}s remaining`;
  el.style.opacity = '1';

  clearInterval(countdownInterval);
  countdownInterval = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(countdownInterval);
      el.style.opacity = '0';
    } else {
      el.textContent = `⏳ ${remaining}s remaining`;
    }
  }, 1000);
}

function hideRoundCountdown() {
  if (timerEl) timerEl.style.opacity = '0';
  clearInterval(countdownInterval);
}


/* ---------- SEAGULL (realistic) ---------- */
function startSeagullEvent(manual=false){
  const keys = Object.keys(balls).filter(u => !balls[u].inHole);
  if (keys.length === 0) return;
  const targetUser = keys[Math.floor(Math.random()*keys.length)];
  const fromLeft = Math.random() < 0.5;
  seagull = {
    x: fromLeft ? -260 : WIDTH + 260,
    y: rand(80, 260),
    vx: fromLeft ? rand(6.5,9) : -rand(6.5,9),
    vy: rand(-1.2,1.2),
    targetUser,
    carrying: false,
    state: 'approach',
    size: 1.6 + Math.random()*0.9,
    wingPhase: Math.random()*Math.PI*2
  };
  showBanner(manual ? '🕊️ Manual seagull!' : 'A seagull appears!');
}

function updateSeagull(dt){
  if (!seagull) return;
  const s = seagull;
  const ball = balls[s.targetUser];
  if (!ball) { seagull = null; return; }

  function steer(px,py,str=0.06){
    const dx = px - s.x, dy = py - s.y;
    const d = Math.hypot(dx,dy) || 1;
    const desiredVx = (dx/d) * (6 + Math.abs(s.vx)*0.12);
    const desiredVy = (dy/d) * (2 + Math.abs(s.vy)*0.12);
    s.vx += (desiredVx - s.vx) * str;
    s.vy += (desiredVy - s.vy) * str;
  }

  // behavior phases similar to vFinal but with smoother steering
  if (s.state === 'approach'){
    steer(ball.x, ball.y - 40, 0.04);
    if (Math.hypot(s.x - ball.x, s.y - (ball.y - 40)) < 120) {
      s.state = 'circle';
      s.circleFrames = randInt(40, 110);
      s.orbitAngle = Math.random() * Math.PI * 2;
    }
  } else if (s.state === 'circle'){
    s.orbitAngle += 0.14 + Math.random()*0.04;
    const r = 58 + Math.sin(performance.now()/260) * 8;
    s.x = ball.x + Math.cos(s.orbitAngle) * r;
    s.y = ball.y - 22 + Math.sin(s.orbitAngle) * r * 0.45;
    s.circleFrames--;
    if (s.circleFrames <= 0) { s.state = 'grab'; s.grabFrames = randInt(18,36); }
  } else if (s.state === 'grab'){
    steer(ball.x, ball.y - 6, 0.22);
    if (Math.hypot(s.x - ball.x, s.y - ball.y) < 36 || s.grabFrames <= 0) {
      s.carrying = true;
      s.state = 'flyoff';
      s.dropTarget = safeDropLocation(80);
      if (inZone(s.dropTarget.x, s.dropTarget.y, waterHazards)) s.dropTarget = safeDropLocation(100);
      const dx = s.dropTarget.x - s.x, dy = s.dropTarget.y - s.y; const d = Math.hypot(dx,dy) || 1;
      s.vx = (dx/d) * rand(5,9);
      s.vy = (dy/d) * rand(2,5);
    } else { s.grabFrames--; }
  } else if (s.state === 'flyoff'){
    steer(s.dropTarget.x, s.dropTarget.y, 0.06);
    if (ball) { ball.x = s.x; ball.y = s.y + 6; ball.moving = false; }
    const d = Math.hypot(s.x - s.dropTarget.x, s.y - s.dropTarget.y);
    if (d < 44) {
      if (!inZone(s.dropTarget.x, s.dropTarget.y, waterHazards)) {
        if (ball) { ball.x = s.dropTarget.x; ball.y = s.dropTarget.y; ball.moving = false; }
        s.carrying = false;
        s.state = 'leave';
        showBanner(`${s.targetUser}'s ball dropped by seagull!`);
        s.vx += (Math.random()<0.5 ? -1 : 1) * rand(3,6);
        s.vy -= rand(1,3);
      } else {
        s.dropTarget = safeDropLocation(60);
      }
    }
  } else if (s.state === 'leave'){
    s.vx *= 0.995;
    s.vy -= 0.01;
  }

  s.x += s.vx * clamp(dt*60, 0.25, 2.5);
  s.y += s.vy * clamp(dt*60, 0.25, 2.5);

  if (s.carrying && balls[s.targetUser]) {
    balls[s.targetUser].x = s.x;
    balls[s.targetUser].y = s.y + 8;
    balls[s.targetUser].moving = false;
  }

  if (s.x < -360 || s.x > WIDTH + 360 || s.y < -360) seagull = null;
}

/* Realistic seagull draw */
function drawRealSeagull(s){
  ctx.save();
  ctx.translate(s.x, s.y);
  const dir = s.vx < 0 ? -1 : 1;
  ctx.scale(dir * s.size, s.size);

  // shadow
  ctx.beginPath();
  ctx.ellipse(6, 14, 28, 10, 0, 0, Math.PI*2);
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  ctx.fill();

  const t = performance.now() / 140;
  const flap = Math.sin(t + (s.wingPhase||0)) * 12 + Math.cos(t*0.5)*(s.size*2);

  // wing
  ctx.beginPath();
  ctx.moveTo(-6, 0);
  ctx.quadraticCurveTo(-28, -26 - flap, 14, -8);
  ctx.quadraticCurveTo(-8, -6, -6, 0);
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  // wing tip
  ctx.beginPath();
  ctx.moveTo(-8, -6);
  ctx.quadraticCurveTo(-24, -18 - flap, -6, -2);
  ctx.fillStyle = '#222';
  ctx.fill();

  // body
  ctx.beginPath();
  ctx.ellipse(2, 6, 16, 12, 0, 0, Math.PI*2);
  ctx.fillStyle = '#f7f7f7';
  ctx.fill();

  // beak
  ctx.beginPath();
  ctx.moveTo(22, -2);
  ctx.lineTo(34, -8);
  ctx.lineTo(34, 6);
  ctx.closePath();
  ctx.fillStyle = '#ffb000';
  ctx.fill();

  // eye
  ctx.beginPath();
  ctx.arc(18, -6, 2.2, 0, Math.PI*2);
  ctx.fillStyle = '#000';
  ctx.fill();

  ctx.restore();
}

/* ---------- RENDER ---------- */
function drawScene() {
  // background grass
  const g = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  g.addColorStop(0, '#3ad157');
  g.addColorStop(1, '#1e8e3f');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // hills first (under everything)
  for (const h of hills) {
    const grad = ctx.createRadialGradient(h.x, h.y, 0, h.x, h.y, h.r);
    grad.addColorStop(0, 'rgba(255,255,255,0.10)');
    grad.addColorStop(0.6, 'rgba(255,255,255,0.03)');
    grad.addColorStop(1, 'rgba(0,0,0,0.08)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(h.x, h.y, h.r, 0, Math.PI * 2);
    ctx.fill();
  }
  
// rough borders
  ctx.fillStyle = '#164f2b';
  ctx.fillRect(0, 0, WIDTH, ROUGH_ZONE);
  ctx.fillRect(0, HEIGHT - ROUGH_ZONE, WIDTH, ROUGH_ZONE);
  ctx.fillRect(0, 0, ROUGH_ZONE, HEIGHT);
  ctx.fillRect(WIDTH - ROUGH_ZONE, 0, ROUGH_ZONE, HEIGHT);


  // water
  for (const w of waterHazards){
    const wg = ctx.createRadialGradient(w.x,w.y,w.r*0.2,w.x,w.y,w.r);
    wg.addColorStop(0,'#66dfff'); wg.addColorStop(1,'#0077be');
    ctx.fillStyle = wg; ctx.beginPath(); ctx.arc(w.x,w.y,w.r,0,Math.PI*2); ctx.fill();
  }

  // sand
  for (const s of sandTraps){
    const sg = ctx.createRadialGradient(s.x,s.y,s.r*0.2,s.x,s.y,s.r);
    sg.addColorStop(0,'#f7e4a2'); sg.addColorStop(1,'#d4b66d');
    ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(s.x,s.y,s.r,0,Math.PI*2); ctx.fill();
  }

  // hole & flag (flag blows with wind)
  ctx.beginPath(); ctx.fillStyle='black'; ctx.arc(hole.x,hole.y,HOLE_RADIUS,0,Math.PI*2); ctx.fill();
  const poleX = hole.x, poleHeight = 80;
  ctx.fillStyle = '#ff3d6b'; ctx.fillRect(poleX - 2, hole.y - poleHeight, 4, poleHeight);
  const flagAngle = -wind.angle; const flagLen = 26 + Math.sin(performance.now()/300)*4 + wind.speed*1.6;
  const fx = Math.cos(flagAngle) * flagLen; const fy = Math.sin(flagAngle) * flagLen;
  ctx.beginPath(); ctx.moveTo(poleX+2, hole.y - poleHeight); ctx.lineTo(poleX + fx + 2, hole.y - poleHeight + fy + 8); ctx.lineTo(poleX+2, hole.y - poleHeight + 16); ctx.closePath(); ctx.fillStyle = '#ff3d6b'; ctx.fill();

  // seagull under balls
  if (seagull) drawRealSeagull(seagull);

  // shots
  for (const s of shots) drawBall(s.x, s.y, balls[s.user]?.color || '#fff', s.user, true);
  // persistent balls
  for (const u in balls) { const b = balls[u]; drawBall(b.x, b.y, b.color, b.user, b.inHole); }

  // wind indicator
  drawWindIndicator();
}

function drawBall(x,y,color,user,inMotion=false){
  // shadow
  ctx.beginPath(); ctx.ellipse(x+6,y+14,14,6,0,0,Math.PI*2); ctx.fillStyle='rgba(0,0,0,0.22)'; ctx.fill();
  // ball
  const grad = ctx.createRadialGradient(x-4,y-4,2,x,y,BALL_RADIUS); grad.addColorStop(0,'#fff'); grad.addColorStop(1,color);
  ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(x,y,BALL_RADIUS,0,Math.PI*2); ctx.fill();

  // name label - simpler, high contrast
  ctx.save();
  ctx.font = '700 18px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 4;
  ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(0,0,0,0.9)'; ctx.strokeText(user, x, y - BALL_RADIUS - 14);
  ctx.fillStyle = '#fff'; ctx.fillText(user, x, y - BALL_RADIUS - 14);
  ctx.restore();
}

function drawWindIndicator(){
  const cx = WIDTH - 180, cy = 60;
  ctx.beginPath(); ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.arc(cx,cy,46,0,Math.PI*2); ctx.fill();
  const len = 36; const ax = cx + Math.cos(wind.angle) * len; const ay = cy - Math.sin(wind.angle) * len;
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(ax,ay); ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.font = '14px Inter, Arial'; ctx.textAlign = 'center';
  ctx.fillText(`Wind: ${wind.speed.toFixed(1)}`, cx, cy + 38);
}

/* ---------- LEADERBOARDS ---------- */

/* MAIN leader: now shows only the current round winners (1-4).
   If no current winners and lastRoundWinners exist, show lastRoundWinners.
*/
function refreshUI(){
  // MAIN winners display in lbList
  lbList.innerHTML = '';
  const header = document.createElement('div');
  header.style.display = 'flex'; header.style.justifyContent = 'space-between'; header.style.fontWeight = '700'; header.style.marginBottom = '6px';
  header.innerHTML = `<div style="width:32px;text-align:left">#</div><div style="flex:1;text-align:left">Winner</div>`;
  lbList.appendChild(header);

  const winnersToShow = roundWinners.length ? roundWinners : lastRoundWinners;
  if (winnersToShow && winnersToShow.length) {
    winnersToShow.forEach((u, idx) => {
      const row = document.createElement('div');
      row.style.display = 'flex'; row.style.alignItems = 'center'; row.style.justifyContent = 'space-between';
      row.style.padding = '6px 4px'; row.style.borderTop = '1px solid rgba(0,0,0,0.06)';
      if (idx === 0) row.style.background = 'linear-gradient(90deg, rgba(255,215,80,0.12), rgba(255,255,255,0))';
      const nameCol = document.createElement('div'); nameCol.style.flex = '1'; nameCol.style.textAlign = 'left'; nameCol.textContent = u;
      const rankCol = document.createElement('div'); rankCol.style.width = '32px'; rankCol.textContent = (idx+1) + '';
      row.appendChild(rankCol); row.appendChild(nameCol);
      lbList.appendChild(row);
    });
  } else {
    const empty = document.createElement('div');
    empty.style.padding = '8px'; empty.style.opacity = 0.7;
    empty.textContent = 'No winners yet. First sink starts the round.';
    lbList.appendChild(empty);
  }

  // HOLE-IN-ONE leaderboard
  hiList.innerHTML = '';
  const hh = document.createElement('div');
  hh.style.display = 'flex'; hh.style.justifyContent = 'space-between'; hh.style.fontWeight = '700'; hh.style.marginBottom = '6px';
  hh.innerHTML = `<div style="width:32px;text-align:left">#</div><div style="flex:1;text-align:left">Player</div><div style="width:70px;text-align:right">HIO</div>`;
  hiList.appendChild(hh);

  const hiEntries = Object.keys(holeInOnes).map(u => ({ user:u, count: holeInOnes[u] })).sort((a,b)=>b.count-a.count||a.user.localeCompare(b.user));
  if (hiEntries.length === 0) {
    const none = document.createElement('div');
    none.style.padding = '8px'; none.style.opacity = 0.7;
    none.textContent = 'No hole-in-ones yet.';
    hiList.appendChild(none);
  } else {
    hiEntries.forEach((e, idx) => {
      const row = document.createElement('div');
      row.style.display = 'flex'; row.style.alignItems = 'center'; row.style.justifyContent = 'space-between';
      row.style.padding = '6px 4px'; row.style.borderTop = '1px solid rgba(0,0,0,0.06)';
      const rankCol = document.createElement('div'); rankCol.style.width = '32px'; rankCol.textContent = (idx+1)+'';
      const nameCol = document.createElement('div'); nameCol.style.flex='1'; nameCol.textContent = e.user;
      const cCol = document.createElement('div'); cCol.style.width='70px'; cCol.style.textAlign='right'; cCol.textContent = e.count;
      row.appendChild(rankCol); row.appendChild(nameCol); row.appendChild(cCol);
      hiList.appendChild(row);
    });
  }

  statusEl.textContent = connectedChannel ? `Connected: ${connectedChannel}` : 'Not connected';
}

/* ---------- showBanner ---------- */
function showBanner(text){
  if (!bannerText) return;
  bannerText.textContent = text;
  bannerWrap.style.opacity = '1';
  setTimeout(()=>{ bannerWrap.style.opacity = '0'; }, 2200);
}

/* ---------- ROUND TIMERS & WINNER SCREEN ---------- */
function startRoundTimer() {
  if (roundTimer) clearTimeout(roundTimer);
  showRoundCountdown(ROUND_DURATION); // 🟢 add this line
  roundTimer = setTimeout(() => {
    console.log("⏰ Round timer expired");
    endRound();
  }, ROUND_DURATION);
}


function endRound(){
  // stop timer
  if (roundTimer) { clearInterval(roundTimer); roundTimer = null; }

  // finalize winners list (roundWinners may have 1..4 players)
  lastRoundWinners = roundWinners.slice(); // persist last winners
  saveLastWinners();

  hideRoundCountdown();

  // show winners screen
  showWinnersScreen();

  // reset round state
  roundActive = false;
  roundWinners = [];

  // clear balls/shots and per-hole strokes
  clearAllBallsAndShots();

  // reset per-hole strokes
  perHoleStrokes = {};
  refreshUI();
}

function showWinnersScreen(){
  const overlay = ensureEl('winnersScreen', 'div', {
    position: 'absolute',
    left: '50%',
    top: '50%',
    transform: 'translate(-50%, -50%)',
    zIndex: 5000,
    background: 'rgba(0,0,0,0.85)',
    color: '#fff',
    fontFamily: 'Fredoka, Arial, sans-serif',
    fontSize: '32px',
    textAlign: 'center',
    padding: '40px 60px',
    borderRadius: '20px',
    boxShadow: '0 0 40px rgba(0,0,0,0.6)',
  });

  const header = `🏆 Round Results`;
  const list = lastRoundWinners.length
    ? lastRoundWinners.map((u, i) => `<div style="margin:8px 0;">${i+1}. ${u}</div>`).join('')
    : `<div>No players finished this round.</div>`;
  overlay.innerHTML = `<div style="font-size:42px;margin-bottom:20px;">${header}</div>${list}`;

  setTimeout(() => {
    overlay.remove();
    randomizeCourse();
    // ensure balls cleared already, but also make sure none are marked inHole
    for (const u in balls) { balls[u].inHole = false; balls[u].moving = false; }
    refreshUI();
    showBanner("Next round begins when someone putts!");
  }, 8000);
}

function clearAllBallsAndShots(){
  // remove all balls and active shots from the field
  // preserve scoreboard & holeInOnes
  for (const u in balls) {
    // either remove players entirely (so they must !putt to rejoin)
    delete balls[u];
  }
  shots.length = 0;
}

/* ---------- Seagull slider UI (Apply) - retained ---------- */
(function setupSeagullSlider(){
  const existing = document.getElementById('sgBlock');
  if (existing) return;
  const wrap = document.createElement('div');
  wrap.id = 'sgBlock';
  wrap.style.marginTop = '10px';
  wrap.style.background = 'rgba(0,0,0,0.28)';
  wrap.style.padding = '8px';
  wrap.style.borderRadius = '8px';
  wrap.style.color = '#fff';
  wrap.innerHTML = `
    <div style="font-family:Arial;font-size:13px;margin-bottom:6px;">🕊️ Seagull Frequency</div>
    <input id="sgSlider" type="range" min="0" max="100" value="2" style="width:200px;">
    <div id="sgLabel" style="font-size:12px;margin-top:6px;">Rare</div>
    <div style="margin-top:6px;"><button id="sgApply">Apply 🕊️</button></div>
  `;
  uiRoot.appendChild(wrap);

  const sgSlider = document.getElementById('sgSlider');
  const sgLabel = document.getElementById('sgLabel');
  const sgApply = document.getElementById('sgApply');
  let pending = parseInt(sgSlider.value,10);

  function preview(){
    const v = parseInt(sgSlider.value,10);
    if (v === 0) sgLabel.textContent = 'Off';
    else if (v <= 5) sgLabel.textContent = 'Very Rare';
    else if (v <= 20) sgLabel.textContent = 'Rare';
    else if (v <= 50) sgLabel.textContent = 'Occasional';
    else sgLabel.textContent = 'Frequent';
    pending = v;
  }
  function applyNow(){
    const v = pending;
    if (v === 0) { seagullProbPerFrame = 0; sgLabel.textContent = 'Off'; }
    else if (v <= 5) { seagullProbPerFrame = 0.000005 * v; sgLabel.textContent = 'Very Rare'; }
    else if (v <= 20) { seagullProbPerFrame = 0.00002 * (v/4); sgLabel.textContent = 'Rare'; }
    else if (v <= 50) { seagullProbPerFrame = 0.00006 * (v/25); sgLabel.textContent = 'Occasional'; }
    else { seagullProbPerFrame = 0.00012 * (v/50); sgLabel.textContent = 'Frequent'; }
    seagullProbPerFrame = clamp(seagullProbPerFrame, 0, 0.01);
    showBanner(`🕊️ Seagull rarity set to ${sgLabel.textContent}`);
  }
  sgSlider.addEventListener('input', preview);
  sgApply.addEventListener('click', applyNow);
  preview();
})();

/* ---------- FULLSCREEN & DRAG ---------- */
function toggleFullscreen(){ if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(()=>{}); else document.exitFullscreen().catch(()=>{}); }
document.addEventListener('keydown', e => { if (e.key === 'f' || e.key === 'F') toggleFullscreen(); });
document.addEventListener('fullscreenchange', ()=> {
  if (document.fullscreenElement) { uiRoot.style.display = 'none'; scoreboardPanel.style.display = 'block'; hiPanel.style.display = 'block'; }
  else { uiRoot.style.display = ''; scoreboardPanel.style.display = 'block'; hiPanel.style.display = 'block'; }
});

// draggable scoreboard + hiPanel
(function enableDrag(){
  const panels = [scoreboardPanel, hiPanel];
  panels.forEach(el => {
    if (!el) return;
    const title = el.querySelector('.title') || el;
    title.style.cursor = 'grab';
    let dragging = false, offX = 0, offY = 0;
    title.addEventListener('pointerdown', e => { dragging = true; offX = e.clientX - el.offsetLeft; offY = e.clientY - el.offsetTop; title.setPointerCapture?.(e.pointerId); title.style.cursor = 'grabbing'; });
    document.addEventListener('pointermove', e => { if (!dragging) return; el.style.left = (e.clientX - offX) + 'px'; el.style.top = (e.clientY - offY) + 'px'; });
    document.addEventListener('pointerup', e => { if (dragging) { dragging = false; title.style.cursor = 'grab'; try { title.releasePointerCapture?.(e.pointerId); } catch(e){} } });
    el.style.resize = 'both'; el.style.overflow = 'auto';
  });
})();

/* ---------- TWITCH connect wiring (optional tmi.js) ---------- */
function connectTwitch(){
  const ch = document.getElementById('channelName')?.value?.trim()?.toLowerCase();
  const bot = document.getElementById('botName')?.value?.trim()?.toLowerCase();
  const token = document.getElementById('oauthToken')?.value?.trim();
  if (!ch || !bot || !token) { alert('Enter channel, bot, token'); return; }
  if (client) client.disconnect().catch(()=>{});
  try {
    client = new tmi.Client({ identity: { username: bot, password: token }, channels: [ ch ] });
    client.connect().then(()=>{ connectedChannel = ch; refreshUI(); }).catch(e=>{ console.error(e); alert('Connect failed - check console'); });
    client.on('message', (chan, tags, message) => handleChat({ username: tags.username || tags['display-name'] || 'unknown', message }));
  } catch(e) {
    console.warn('tmi.js not available or connect failed', e);
    alert('Twitch connect requires tmi.js included; check console.');
  }
}
document.getElementById('connectBtn')?.addEventListener('click', connectTwitch);
document.getElementById('disconnectBtn')?.addEventListener('click', ()=> { if (client) client.disconnect().catch(()=>{}); client = null; connectedChannel = null; refreshUI(); });
document.getElementById('resetScores')?.addEventListener('click', ()=> { if (!confirm('Clear stored leaderboard?')) return; localStorage.removeItem('twitchGolfScores'); localStorage.removeItem('twitchHI'); localStorage.removeItem('twitchLastWinners'); scoreboard = {}; holeInOnes = {}; lastRoundWinners = []; saveScores(); saveHoleInOnes(); saveLastWinners(); refreshUI(); });
document.getElementById('testBtn')?.addEventListener('click', ()=> { const c = document.getElementById('testCommand')?.value.trim(); if (c) handleChat({ username: 'Tester', message: c }); });

/* Test seagull button */
const testSG = document.createElement('button');
testSG.textContent = '🕊️ Test Seagull';
testSG.style.marginLeft = '8px';
uiRoot.appendChild(testSG);
testSG.addEventListener('click', ()=> startSeagullEvent(true));

/* Add Test Player button */
const addTP = document.createElement('button');
addTP.textContent = '➕ Add Test Player';
addTP.style.marginLeft = '8px';
uiRoot.appendChild(addTP);
addTP.addEventListener('click', ()=> {
  const name = prompt('Test player name', 'Tester') || 'Tester';
  ensureBall(name.toLowerCase());
  if (!scoreboard[name.toLowerCase()]) scoreboard[name.toLowerCase()] = { strokes:0, holes:0 };
  saveScores();
  showBanner(`Added ${name}`);
});

/* ---------- MAIN LOOP ---------- */
let lastTime = performance.now();
function loop(now){
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;
  try {
    stepPhysics(dt);
    drawScene();
    refreshUI();
  } catch (e) {
    console.error('Error in main loop', e);
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

console.log('Script initialization complete — leaderboard now uses strokes & holes (persistent).');
