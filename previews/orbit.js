// Orbit Wheel — all cards on a segmented 3D ring: drag to spin with
// momentum, colored category dial + legend to jump segments, front card
// enlarged with live info; entering leads to the shared side-rail focus.
import {
  loadCards, makeCardEl, CATS, Stage, fxRefs,
  makeRail, makeFader, focusEnterSummon, focusEnterDive, focusJump, focusExit, sleep,
} from '/previews/cards-shared.js';

const orbitStage = document.getElementById('orbitStage');
const wheelEl = document.getElementById('wheel');
const frontInfo = document.getElementById('frontInfo');
const dialEl = document.getElementById('dial');
const loading = document.getElementById('loading');
const stage = new Stage(document.getElementById('stage'));
const fx = fxRefs();
const fader = makeFader();

const cards = await loadCards({ all: true });
// contiguous category arcs around the ring
const ordered = Object.keys(CATS).flatMap((catId) => cards.filter((c) => c.cat === catId));
const N = ordered.length;
const STEP = 360 / N;
const R = Math.round((178 * N) / (2 * Math.PI));

let rotY = 0;
let vel = 0;
let dragging = false;
let anim = null; // {from, to, t0, dur}
let busy = false;
let inFocus = false;
let posterOpen = false;
let frontIdx = -1;
let entryScale = 0; // wheel grows in on load

const entries = ordered.map((card, i) => {
  const el = makeCardEl(card);
  el.classList.remove('down');
  wheelEl.appendChild(el);
  return { card, el, angle: i * STEP };
});

// ------------------------------------------------------------- dial + legend

const catRanges = Object.keys(CATS).map((catId) => {
  const idxs = entries.map((en, i) => (en.card.cat === catId ? i : -1)).filter((i) => i >= 0);
  return idxs.length ? { catId, first: idxs[0], count: idxs.length } : null;
}).filter(Boolean);

function buildDial() {
  const r = 26;
  const c = 2 * Math.PI * r;
  let acc = 0;
  const segs = catRanges.map(({ catId, count }) => {
    const frac = count / N;
    const seg = `<circle cx="34" cy="34" r="${r}" fill="none"
      stroke="${CATS[catId].color}" stroke-width="7"
      stroke-dasharray="${(frac * c - 3).toFixed(1)} ${(c - frac * c + 3).toFixed(1)}"
      stroke-dashoffset="${(-acc * c + c / 4).toFixed(1)}" opacity="0.9"/>`;
    acc += frac;
    return seg;
  }).join('');
  dialEl.innerHTML = `
    <svg width="68" height="68" viewBox="0 0 68 68">
      <circle cx="34" cy="34" r="${r}" fill="rgba(10,12,18,0.7)" stroke="rgba(120,130,160,0.25)" stroke-width="12"/>
      <g class="ring-rot">${segs}</g>
      <path class="notch" d="M 34 2 L 38 10 L 30 10 Z"/>
    </svg>
    <div id="legend">
      ${catRanges.map(({ catId }) => `
        <button data-cat="${catId}" style="--c:${CATS[catId].color}">${CATS[catId].label}</button>`).join('')}
    </div>`;
  dialEl.querySelector('#legend').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || busy || inFocus) return;
    const range = catRanges.find((r2) => r2.catId === b.dataset.cat);
    const mid = (range.first + (range.count - 1) / 2) * STEP;
    spinTo(mid);
  });
}
buildDial();
const ringRot = dialEl.querySelector('.ring-rot');
const legendBtns = [...dialEl.querySelectorAll('#legend button')];

// ------------------------------------------------------------- spin physics

function spinTo(targetAngle, dur = 950) {
  // choose the shortest equivalent rotation
  let to = targetAngle;
  to += Math.round((rotY - to) / 360) * 360;
  anim = { from: rotY, to, t0: performance.now(), dur };
  vel = 0;
}

// NOTE: no setPointerCapture — it would retarget click events away from
// the cards. Move/up are tracked on window instead.
let dragLastX = 0;
let dragMoved = 0;
orbitStage.addEventListener('pointerdown', (e) => {
  if (busy || inFocus) return;
  dragging = true;
  anim = null;
  vel = 0;
  orbitStage.classList.add('dragging');
  dragLastX = e.clientX;
  dragMoved = 0;
});
addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const dx = e.clientX - dragLastX;
  dragLastX = e.clientX;
  dragMoved += Math.abs(dx);
  rotY -= dx * 0.22;
  vel = -dx * 0.22;
});
const endDrag = () => {
  if (!dragging) return;
  dragging = false;
  orbitStage.classList.remove('dragging');
  setTimeout(() => { dragMoved = 0; }, 60);
};
addEventListener('pointerup', endDrag);
addEventListener('pointercancel', endDrag);
orbitStage.addEventListener('wheel', (e) => {
  if (busy || inFocus) return;
  anim = null;
  vel += (Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX) * 0.012;
  e.preventDefault();
}, { passive: false });

// ------------------------------------------------------------- render loop

const norm = (a) => ((a % 360) + 540) % 360 - 180;

function updateFrontInfo(i) {
  if (i === frontIdx) return;
  frontIdx = i;
  const card = entries[i].card;
  const cat = CATS[card.cat];
  frontInfo.classList.add('swap');
  setTimeout(() => {
    frontInfo.querySelector('.k').textContent = cat.label;
    frontInfo.querySelector('.k').style.color = cat.color;
    frontInfo.querySelector('.t').textContent = card.title;
    frontInfo.querySelector('.d').textContent = card.desc;
    frontInfo.classList.remove('swap');
  }, 130);
  legendBtns.forEach((b) => b.classList.toggle('hot', b.dataset.cat === card.cat));
}

function render(now) {
  requestAnimationFrame(render);
  if (anim) {
    const t = Math.min(1, (now - anim.t0) / anim.dur);
    const e = t < 0.5 ? 4 * t ** 3 : 1 - Math.pow(-2 * t + 2, 3) / 2;
    rotY = anim.from + (anim.to - anim.from) * e;
    if (t >= 1) anim = null;
  } else if (!dragging) {
    if (Math.abs(vel) > 0.02) {
      rotY += vel;
      vel *= 0.955;
    } else if (vel !== 0) {
      vel = 0;
      spinTo(Math.round(rotY / STEP) * STEP, 420);
    }
  }
  entryScale += (1 - entryScale) * 0.06;

  wheelEl.style.transform = `translateZ(${-R}px) rotateY(${-rotY}deg) scale3d(${entryScale}, ${entryScale}, ${entryScale})`;
  ringRot.style.transform = `rotate(${-rotY}deg)`;

  let bestI = 0;
  let bestA = 999;
  for (let i = 0; i < entries.length; i++) {
    const en = entries[i];
    const a = norm(en.angle - rotY);
    const abs = Math.abs(a);
    if (abs < bestA) { bestA = abs; bestI = i; }
    const frontness = Math.max(0, 1 - abs / (STEP * 1.6));
    const s = 1 + frontness * 0.42;
    en.el.style.transform =
      `translate(-50%, -50%) rotateY(${en.angle}deg) translateZ(${R}px) scale(${s}) translateY(${(-frontness * 26).toFixed(1)}px)`;
    const facing = Math.cos((a * Math.PI) / 180); // 1 front, -1 back
    en.el.style.opacity = facing > 0 ? (0.38 + 0.62 * facing).toFixed(2) : '0.16';
    en.el.style.filter = `brightness(${(0.55 + 0.45 * Math.max(0, facing)).toFixed(2)})`;
    en.el.style.zIndex = Math.round(100 + facing * 90);
  }
  if (!inFocus && !busy) updateFrontInfo(bestI);
}
requestAnimationFrame(render);

// card base transforms need translate(-50%,-50%) since .card has centering margins
// (we override margins so the wheel math stays clean)
entries.forEach((en) => {
  en.el.style.margin = '0';
  en.el.style.left = '0';
  en.el.style.top = '0';
});

// ------------------------------------------------------------- focus wiring

const rail = makeRail(cards, (card) => railJump(card));

async function railJump(card) {
  if (busy || !inFocus) return;
  if (card.kind === 'game') {
    posterOpen = true;
    fx.poster.classList.add('on');
    fx.dismiss.textContent = 'close teaser ✕';
    return;
  }
  busy = true;
  const ok = await focusJump(stage, fx, card, fader);
  if (ok) rail.setCurrent(card.id);
  busy = false;
}

async function enterFocus(entry) {
  busy = true;
  frontInfo.style.opacity = '0';
  dialEl.style.opacity = '0';
  let ok;
  if (entry.card.kind === 'game') {
    posterOpen = true;
    fx.dim.classList.add('on');
    fx.poster.classList.add('on');
    fx.dismiss.textContent = 'dismiss ✕';
    fx.dismiss.classList.add('on');
    fx.help?.style.setProperty('opacity', '0');
    busy = false;
    return;
  }
  ok = entry.card.kind === 'asset'
    ? await focusEnterSummon(stage, fx, entry.card, entry.el)
    : await focusEnterDive(stage, fx, entry.card, entry.el);
  if (ok) {
    inFocus = true;
    rail.show(entry.card.id);
    fx.dismiss.textContent = '← back to wheel';
    fx.dismiss.classList.add('on');
  } else {
    frontInfo.style.opacity = '';
    dialEl.style.opacity = '';
  }
  busy = false;
}

fx.dismiss.addEventListener('click', () => {
  if (posterOpen) {
    posterOpen = false;
    fx.poster.classList.remove('on');
    if (inFocus) {
      fx.dismiss.textContent = '← back to wheel';
    } else {
      fx.dim.classList.remove('on');
      fx.dismiss.classList.remove('on');
      fx.help?.style.setProperty('opacity', '');
      frontInfo.style.opacity = '';
      dialEl.style.opacity = '';
    }
    return;
  }
  if (!inFocus) return;
  inFocus = false;
  rail.hide();
  focusExit(stage, fx);
  frontInfo.style.opacity = '';
  dialEl.style.opacity = '';
});

wheelEl.addEventListener('click', (e) => {
  if (busy || inFocus || dragMoved > 8) return;
  const cardEl = e.target.closest('.card');
  if (!cardEl) return;
  const entry = entries.find((en) => en.el === cardEl);
  if (!entry) return;
  const a = Math.abs(norm(entry.angle - rotY));
  if (a < STEP * 0.75) enterFocus(entry); // front card → enter
  else spinTo(entry.angle); // side card → bring it to the front
});

// ------------------------------------------------------------- opening

async function opening() {
  loading.classList.add('done');
  rotY = -140;
  spinTo(0, 1700);
  await sleep(400);
}
opening();
