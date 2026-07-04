// Category Lanes — streaming-service browse: 4 colored lanes, one per
// category, drag-with-momentum rows, tilt + holo shine, parallax; entering
// a card leads to the shared side-rail focus views.
import {
  loadCards, makeCardEl, attachTilt, CATS, Stage, fxRefs,
  makeRail, makeFader, focusEnterSummon, focusEnterDive, focusJump, focusExit, sleep,
} from '/previews/cards-shared.js';

const lanesEl = document.getElementById('lanes');
const loading = document.getElementById('loading');
const stage = new Stage(document.getElementById('stage'));
const fx = fxRefs();
const fader = makeFader();

const cards = await loadCards({ all: true });
const entries = [];
let busy = false;
let inFocus = false;
let posterOpen = false;
let current = null;

// ------------------------------------------------------------- build lanes

const lanes = [];
for (const catId of Object.keys(CATS)) {
  const cat = CATS[catId];
  const items = cards.filter((c) => c.cat === catId);
  if (!items.length) continue;
  const lane = document.createElement('section');
  lane.className = 'lane';
  lane.style.setProperty('--accent', cat.color);
  lane.innerHTML = `
    <header>
      <span class="dot"></span>
      <h2>${cat.label}</h2>
      <span class="count">${items.length} CARD${items.length > 1 ? 'S' : ''}</span>
      <span class="hint">⟵ drag ⟶</span>
    </header>
    <div class="scroller"><div class="track"></div></div>`;
  const track = lane.querySelector('.track');
  for (const card of items) {
    const el = makeCardEl(card);
    el.classList.remove('down');
    track.appendChild(el);
    entries.push({ card, el });
  }
  lanesEl.appendChild(lane);
  lanes.push(lane);
}
attachTilt(lanesEl);

function sizeCards() {
  const laneH = (innerHeight - 96) / lanes.length;
  const ch = Math.max(140, Math.min(212, laneH - 46));
  const cw = Math.round((ch * 164) / 236);
  lanesEl.style.setProperty('--ch', `${ch}px`);
  lanesEl.style.setProperty('--cw', `${cw}px`);
}
sizeCards();
addEventListener('resize', sizeCards);

// ------------------------------------------------------------- drag momentum

let suppressClick = false;
function makeDragScroll(scroller) {
  let down = false;
  let startX = 0;
  let startScroll = 0;
  let lastX = 0;
  let lastT = 0;
  let vx = 0;
  let moved = 0;
  let raf = null;

  const cardStep = () => {
    const c = scroller.querySelector('.card');
    return c ? c.offsetWidth + 14 : 180;
  };
  const snap = () => {
    const step = cardStep();
    const target = Math.round(scroller.scrollLeft / step) * step;
    const from = scroller.scrollLeft;
    const t0 = performance.now();
    const tick = () => {
      const t = Math.min(1, (performance.now() - t0) / 360);
      const e = 1 - Math.pow(1 - t, 3);
      scroller.scrollLeft = from + (target - from) * e;
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  };
  const momentum = () => {
    if (Math.abs(vx) < 0.04) { snap(); return; }
    scroller.scrollLeft -= vx * 15;
    vx *= 0.94;
    raf = requestAnimationFrame(momentum);
  };

  // NOTE: no setPointerCapture — it would retarget the click event away
  // from the card. Move/up are tracked on window instead.
  scroller.addEventListener('pointerdown', (e) => {
    down = true;
    moved = 0;
    startX = lastX = e.clientX;
    startScroll = scroller.scrollLeft;
    lastT = performance.now();
    vx = 0;
    cancelAnimationFrame(raf);
    scroller.classList.add('dragging');
  });
  addEventListener('pointermove', (e) => {
    if (!down) return;
    const now = performance.now();
    scroller.scrollLeft = startScroll - (e.clientX - startX);
    moved = Math.max(moved, Math.abs(e.clientX - startX));
    const dt = Math.max(1, now - lastT);
    vx = (e.clientX - lastX) / dt * 16;
    lastX = e.clientX;
    lastT = now;
  });
  const release = () => {
    if (!down) return;
    down = false;
    scroller.classList.remove('dragging');
    suppressClick = moved > 6;
    setTimeout(() => { suppressClick = false; }, 60);
    momentum();
  };
  addEventListener('pointerup', release);
  addEventListener('pointercancel', release);
  scroller.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      scroller.scrollLeft += e.deltaY;
      e.preventDefault();
    }
  }, { passive: false });
}
lanesEl.querySelectorAll('.scroller').forEach(makeDragScroll);

// subtle parallax between lanes on mouse move
const PARA = [7, -10, 8, -6];
addEventListener('pointermove', (e) => {
  if (inFocus || busy) return;
  const mx = e.clientX / innerWidth - 0.5;
  lanes.forEach((lane, i) => {
    lane.style.transform = `translateX(${(mx * PARA[i % PARA.length]).toFixed(1)}px)`;
  });
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
  if (ok) {
    current = card;
    rail.setCurrent(card.id);
  }
  busy = false;
}

async function enterFocus(entry) {
  busy = true;
  entry.el.querySelector('.card-tilt').style.transform = '';
  const ok = entry.card.kind === 'asset'
    ? await focusEnterSummon(stage, fx, entry.card, entry.el)
    : await focusEnterDive(stage, fx, entry.card, entry.el);
  if (ok) {
    inFocus = true;
    current = entry.card;
    rail.show(entry.card.id);
    fx.dismiss.textContent = '← back to lanes';
    fx.dismiss.classList.add('on');
  }
  busy = false;
}

function showGamePoster() {
  busy = true;
  posterOpen = true;
  fx.dim.classList.add('on');
  fx.poster.classList.add('on');
  fx.dismiss.textContent = 'dismiss ✕';
  fx.dismiss.classList.add('on');
  fx.help?.style.setProperty('opacity', '0');
  busy = false;
}

fx.dismiss.addEventListener('click', () => {
  if (posterOpen) {
    posterOpen = false;
    fx.poster.classList.remove('on');
    if (inFocus) {
      fx.dismiss.textContent = '← back to lanes';
    } else {
      fx.dim.classList.remove('on');
      fx.dismiss.classList.remove('on');
      fx.help?.style.setProperty('opacity', '');
    }
    return;
  }
  if (!inFocus) return;
  inFocus = false;
  current = null;
  rail.hide();
  focusExit(stage, fx);
});

lanesEl.addEventListener('click', (e) => {
  if (busy || inFocus || suppressClick) return;
  const cardEl = e.target.closest('.card');
  if (!cardEl) return;
  const entry = entries.find((en) => en.el === cardEl);
  if (!entry) return;
  if (entry.card.kind === 'game') showGamePoster();
  else enterFocus(entry);
});

// ------------------------------------------------------------- opening

async function opening() {
  // lanes slide in one after another
  lanes.forEach((lane, i) => {
    lane.style.opacity = '0';
    lane.style.transform = 'translateX(60px)';
    lane.style.transition = 'none';
  });
  void lanesEl.offsetWidth;
  loading.classList.add('done');
  lanes.forEach((lane, i) => {
    setTimeout(() => {
      lane.style.transition = 'opacity 0.7s ease, transform 0.7s cubic-bezier(0.2, 0.7, 0.3, 1)';
      lane.style.opacity = '1';
      lane.style.transform = 'translateX(0)';
      setTimeout(() => { lane.style.transition = ''; }, 750);
    }, 120 + i * 130);
  });
  await sleep(1200);
}
opening();
