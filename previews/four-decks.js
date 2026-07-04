// Four Decks — dealer's table: one face-down deck per category, dealing
// animation into a fan, gather to sweep back. Shared summon / dive / poster.
import {
  loadCards, makeCardEl, attachTilt, placeCard, CATS, Stage, fxRefs,
  summonFlow, diveFlow, posterFlow, sleep,
} from '/previews/cards-shared.js';

const deckArea = document.getElementById('deckArea');
const spotsEl = document.getElementById('spots');
const gatherBtn = document.getElementById('gather');
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

const CAT_IDS = Object.keys(CATS); // assets, sim, worlds, game
const jit = (n) => (Math.random() - 0.5) * n;
let dealt = null; // currently dealt category id
let busy = false;

// ------------------------------------------------------------- deck spots

const spotXY = (i) => ({
  x: innerWidth * (0.17 + 0.22 * i),
  y: innerHeight * 0.42,
});

const spots = CAT_IDS.map((catId, i) => {
  const cat = CATS[catId];
  const n = entries.filter((en) => en.card.cat === catId).length;
  const el = document.createElement('div');
  el.className = 'spot';
  el.dataset.cat = catId;
  el.style.setProperty('--accent', cat.color);
  el.innerHTML = `
    <div class="ring"></div>
    <div class="lbl">${cat.label}</div>
    <div class="cnt">${catId === 'game' ? 'coming attraction' : n + ' cards'}</div>`;
  spotsEl.appendChild(el);
  el.addEventListener('click', () => dealDeck(catId));
  return { catId, el, i };
});

function positionSpots() {
  spots.forEach((s) => {
    const p = spotXY(s.i);
    s.el.style.left = `${p.x}px`;
    s.el.style.top = `${p.y}px`;
  });
}
positionSpots();

function stackDeck(catId, instant = false) {
  const list = entries.filter((en) => en.card.cat === catId);
  const i = CAT_IDS.indexOf(catId);
  const p = spotXY(i);
  list.forEach((en, k) => {
    en.el.classList.add('down', 'inpile');
    if (instant) en.el.style.transition = 'none';
    placeCard(en.el, p.x + jit(4), p.y - 12 - k * 1.2, jit(5));
    en.el.style.zIndex = 10 + k;
    if (instant) {
      void en.el.offsetWidth;
      en.el.style.transition = '';
    }
  });
}

// ------------------------------------------------------------- deal / gather

function fanPositions(m) {
  const totalDeg = Math.min(64, Math.max(18, m * 9));
  const R = Math.min(900, Math.max(620, innerWidth * 0.62));
  const cx = innerWidth / 2;
  const topY = innerHeight * 0.64;
  const out = [];
  for (let k = 0; k < m; k++) {
    const a = m === 1 ? 0 : (-totalDeg / 2 + (totalDeg * k) / (m - 1));
    const rad = (a * Math.PI) / 180;
    out.push({ x: cx + R * Math.sin(rad), y: topY + R * (1 - Math.cos(rad)), rot: a });
  }
  return out;
}

async function dealDeck(catId) {
  if (busy || dealt === catId) return;
  busy = true;
  if (dealt) await gather(false);
  dealt = catId;
  spots.forEach((s) => s.el.classList.toggle('aside', s.catId !== catId));
  gatherBtn.classList.add('on');

  const list = entries.filter((en) => en.card.cat === catId);
  const pos = fanPositions(list.length);
  list.forEach((en, k) => {
    en.el.classList.remove('inpile');
    en.el.style.zIndex = 30 + k;
    setTimeout(() => {
      placeCard(en.el, pos[k].x, pos[k].y, pos[k].rot);
      setTimeout(() => en.el.classList.remove('down'), 230);
    }, k * 110);
  });
  await sleep(list.length * 110 + 500);
  busy = false;
}

async function gather(unlockAfter = true) {
  if (!dealt) return;
  const catId = dealt;
  dealt = null;
  if (unlockAfter) busy = true;
  gatherBtn.classList.remove('on');
  const list = entries.filter((en) => en.card.cat === catId);
  const i = CAT_IDS.indexOf(catId);
  const p = spotXY(i);
  // sweep back, reversed order, flipping face-down mid-flight
  [...list].reverse().forEach((en, k) => {
    setTimeout(() => {
      en.el.classList.add('down');
      placeCard(en.el, p.x + jit(4), p.y - 12 - (list.length - k) * 1.2, jit(5));
      setTimeout(() => en.el.classList.add('inpile'), 500);
    }, k * 70);
  });
  await sleep(list.length * 70 + 550);
  spots.forEach((s) => s.el.classList.remove('aside'));
  if (unlockAfter) busy = false;
}

gatherBtn.addEventListener('click', () => { if (!busy) gather(); });

// ------------------------------------------------------------- card clicks

deckArea.addEventListener('click', async (e) => {
  const cardEl = e.target.closest('.card');
  if (!cardEl || busy) return;
  const entry = entries.find((en) => en.el === cardEl);
  if (!entry) return;
  if (cardEl.classList.contains('down')) { dealDeck(entry.card.cat); return; }
  busy = true;
  cardEl.querySelector('.card-tilt').style.transform = '';
  if (entry.card.kind === 'asset') await summonFlow(stage, fx, entry.card, cardEl);
  else if (entry.card.kind === 'scene') await diveFlow(stage, fx, entry.card, cardEl);
  else await posterFlow(fx, entry.card, cardEl);
  busy = false;
});

// ------------------------------------------------------------- opening deal

async function opening() {
  // everything starts as one pile in the dealer's hand (top center), then
  // gets flicked round-robin to the four spots
  const hx = innerWidth / 2;
  const hy = -140;
  entries.forEach((en, k) => {
    en.el.style.transition = 'none';
    placeCard(en.el, hx + jit(6), hy, jit(10));
    en.el.style.zIndex = k;
  });
  void deckArea.offsetWidth;
  entries.forEach((en) => { en.el.style.transition = ''; });
  loading.classList.add('done');
  await sleep(420);

  // interleave by category so the deal alternates spots like a real dealer
  const byCat = CAT_IDS.map((c) => entries.filter((en) => en.card.cat === c));
  const order = [];
  for (let k = 0; k < Math.max(...byCat.map((l) => l.length)); k++) {
    for (const list of byCat) if (list[k]) order.push(list[k]);
  }
  order.forEach((en, k) => {
    const i = CAT_IDS.indexOf(en.card.cat);
    const p = spotXY(i);
    const depth = byCat[i].indexOf(en);
    setTimeout(() => {
      placeCard(en.el, p.x + jit(4), p.y - 12 - depth * 1.2, jit(5));
      en.el.style.zIndex = 10 + depth;
    }, k * 85);
  });
  await sleep(order.length * 85 + 500);
}

addEventListener('resize', () => {
  if (busy) return;
  positionSpots();
  CAT_IDS.forEach((c) => { if (c !== dealt) stackDeck(c, true); });
});

opening();
