// Tarot Draw — mystical three-card spread: the deck swirls, deals three
// face-down cards, each flips with an arcane glow, then summons / dives.
import {
  loadCards, makeCardEl, attachTilt, placeCard, Stage, fxRefs,
  summonFlow, diveFlow, posterFlow, raysBurst, sleep,
} from '/previews/cards-shared.js';

const deckArea = document.getElementById('deckArea');
const slotsEl = document.getElementById('slots');
const redrawBtn = document.getElementById('redraw');
const loading = document.getElementById('loading');
const stage = new Stage(document.getElementById('stage'));
const fx = fxRefs();

const cards = await loadCards();
const entries = cards.map((card) => {
  const el = makeCardEl(card);
  el.classList.add('down', 'inpile');
  deckArea.appendChild(el);
  return { card, el };
});
attachTilt(deckArea);

const jit = (n) => (Math.random() - 0.5) * n;
const deckPos = () => ({ x: innerWidth / 2, y: innerHeight * 0.30 });
const slotPos = (k) => ({ x: innerWidth * (0.28 + 0.22 * k), y: innerHeight * 0.66 });
const ROLES = ['the artifact', 'the omen', 'the destination'];

let drawn = []; // entries currently in slots
let revealed = new Set();
let busy = false;

// slot markers
const slotEls = [0, 1, 2].map((k) => {
  const el = document.createElement('div');
  el.className = 'slot';
  el.innerHTML = `<div class="ring"></div><div class="num">${['I', 'II', 'III'][k]}</div><div class="role">${ROLES[k]}</div>`;
  slotsEl.appendChild(el);
  return el;
});
function positionSlots() {
  slotEls.forEach((el, k) => {
    const p = slotPos(k);
    el.style.left = `${p.x}px`;
    el.style.top = `${p.y}px`;
  });
}
positionSlots();

function stackAll(instant = false) {
  const d = deckPos();
  entries.forEach((en, i) => {
    if (drawn.includes(en)) return;
    if (instant) en.el.style.transition = 'none';
    en.el.classList.add('down', 'inpile');
    placeCard(en.el, d.x + jit(4), d.y - i * 0.8, jit(6));
    en.el.style.zIndex = i;
    if (instant) { void en.el.offsetWidth; en.el.style.transition = ''; }
  });
}

async function swirlShuffle() {
  // cards briefly orbit the deck in a mystic ring, then collapse back
  const d = deckPos();
  const R = Math.min(300, innerHeight * 0.3);
  deckArea.classList.add('fast');
  entries.forEach((en, i) => {
    const a = (i / entries.length) * Math.PI * 2;
    setTimeout(() => {
      placeCard(en.el, d.x + R * Math.cos(a), d.y + R * 0.62 * Math.sin(a), (a * 180) / Math.PI + 90);
    }, i * 14);
  });
  await sleep(entries.length * 14 + 460);
  entries.forEach((en, i) => {
    en.el.style.zIndex = (i * 11) % entries.length;
    setTimeout(() => placeCard(en.el, d.x + jit(4), d.y + jit(4), jit(6)), i * 8);
  });
  await sleep(entries.length * 8 + 460);
  deckArea.classList.remove('fast');
}

function pickThree() {
  // three random cards from three different categories
  const byCat = {};
  for (const en of entries) (byCat[en.card.cat] ??= []).push(en);
  const cats = Object.keys(byCat).sort(() => Math.random() - 0.5).slice(0, 3);
  return cats.map((c) => byCat[c][Math.floor(Math.random() * byCat[c].length)]);
}

async function draw() {
  if (busy) return;
  busy = true;
  redrawBtn.classList.remove('on');

  if (drawn.length) {
    // sweep the old spread home
    drawn.forEach((en, k) => {
      setTimeout(() => {
        en.el.classList.add('down');
        const d = deckPos();
        placeCard(en.el, d.x + jit(4), d.y + jit(4), jit(6));
        setTimeout(() => en.el.classList.add('inpile'), 500);
      }, k * 90);
    });
    drawn = [];
    revealed = new Set();
    await sleep(700);
    await swirlShuffle();
  }

  drawn = pickThree();
  drawn.forEach((en, k) => {
    const p = slotPos(k);
    en.el.classList.remove('inpile');
    en.el.style.zIndex = 40 + k;
    setTimeout(() => placeCard(en.el, p.x, p.y, jit(3)), 200 + k * 240);
  });
  await sleep(200 + 3 * 240 + 500);
  redrawBtn.classList.add('on');
  busy = false;
}

deckArea.addEventListener('click', async (e) => {
  const cardEl = e.target.closest('.card');
  if (!cardEl || busy) return;
  const entry = entries.find((en) => en.el === cardEl);
  if (!entry) return;

  if (!drawn.includes(entry)) return; // deck pile clicks handled below

  if (!revealed.has(entry)) {
    // arcane flip
    revealed.add(entry);
    cardEl.classList.add('revealing');
    cardEl.classList.remove('down');
    raysBurst(fx.rays);
    setTimeout(() => cardEl.classList.remove('revealing'), 950);
    return;
  }

  busy = true;
  cardEl.querySelector('.card-tilt').style.transform = '';
  if (entry.card.kind === 'asset') await summonFlow(stage, fx, entry.card, cardEl);
  else if (entry.card.kind === 'scene') await diveFlow(stage, fx, entry.card, cardEl);
  else await posterFlow(fx, entry.card, cardEl);
  busy = false;
});

// pile cards are pointer-events:none, so deck clicks land on the body —
// treat any click near the deck stack as "draw"
document.body.addEventListener('click', (e) => {
  if (busy || e.target.closest('.card, button, a')) return;
  const d = deckPos();
  if (Math.abs(e.clientX - d.x) < 110 && Math.abs(e.clientY - d.y) < 150) draw();
});

redrawBtn.addEventListener('click', draw);

addEventListener('resize', () => {
  if (busy) return;
  positionSlots();
  stackAll(true);
  drawn.forEach((en, k) => {
    const p = slotPos(k);
    placeCard(en.el, p.x, p.y, 0);
  });
});

async function opening() {
  stackAll(true);
  loading.classList.add('done');
  await sleep(500);
  await swirlShuffle();
  await draw();
}
opening();
