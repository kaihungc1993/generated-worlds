// One Deck — single merged deck: riffle shuffle, card-type intro legend,
// then all cards dealt into three category rows (assets / sim envs /
// worlds + game). Clicking a card enters the focus view, which has a
// left-side auto-hiding thumbnail rail of the same category.
import {
  loadCards, makeCardEl, placeCard, attachTilt, CATS, Stage, fxRefs,
  focusEnterSummon, focusEnterDive, focusJump, focusExit, makeFader,
  posterFlow, sleep,
} from '/previews/cards-shared.js';

const deckArea = document.getElementById('deckArea');
const legendEl = document.getElementById('introLegend');
const rowLabelsEl = document.getElementById('rowLabels');
const gotItBtn = document.getElementById('gotIt');
const loading = document.getElementById('loading');
const stage = new Stage(document.getElementById('stage'));
const fx = fxRefs();
const fader = makeFader();

const cards = await loadCards();
const entries = cards.map((card) => {
  const el = makeCardEl(card);
  deckArea.appendChild(el);
  return { card, el };
});
attachTilt(deckArea);

let busy = true; // unlocked once the rows are first dealt
let mode = 'shuffle'; // shuffle | intro | rows
let inFocus = false;
let current = null;

// ------------------------------------------------------------- layout

const stackPos = () => ({ x: innerWidth / 2, y: innerHeight * 0.52 });
const pilePos = () => ({ x: innerWidth - 96, y: innerHeight - 150 });
const jit = (n) => (Math.random() - 0.5) * n;

// three rows: assets / sim / worlds + game (game separated by a wider gap)
const ROWS = [
  { cats: ['assets'], label: 'Articulated Assets' },
  { cats: ['sim'], label: 'Sim Environments' },
  { cats: ['worlds', 'game'], label: 'Generated Worlds · Playable Game' },
];
const GAP = 18; // between cards in a row
const GAME_GAP = 64; // extra spacing before the game card
const TOP = 100; // below the page title
const BOTTOM = 56; // above the help bar

/** Size cards so 3 rows fit vertically and the widest row fits horizontally. */
function sizeCards() {
  const rowsH = innerHeight - TOP - BOTTOM;
  const rowH = rowsH / ROWS.length;
  let ch = Math.min(rowH - 42, 360);
  let cw = Math.round(ch * 0.72);
  // widest row: worlds (7) + game (1) + extra gap
  const maxN = Math.max(...ROWS.map((r) => rowEntries(r).length));
  const fitW = (innerWidth - 70 - GAME_GAP) / maxN - GAP;
  if (cw > fitW) {
    cw = Math.floor(fitW);
    ch = Math.round(cw / 0.72);
  }
  deckArea.style.setProperty('--cw', `${cw}px`);
  deckArea.style.setProperty('--ch', `${ch}px`);
  return { cw, ch, rowH };
}

function rowEntries(row) {
  return row.cats.flatMap((cat) => entries.filter((en) => en.card.cat === cat));
}

/** Target positions for every entry in the 3-row layout. */
function rowPositions() {
  const { cw, ch, rowH } = sizeCards();
  const out = new Map();
  ROWS.forEach((row, r) => {
    const list = rowEntries(row);
    const gaps = list.map((en, i) => (i > 0 && en.card.cat === 'game' && list[i - 1].card.cat !== 'game' ? GAME_GAP : 0));
    const totalW = list.length * cw + (list.length - 1) * GAP + gaps.reduce((a, b) => a + b, 0);
    let x = (innerWidth - totalW) / 2 + cw / 2;
    const y = TOP + rowH * r + rowH / 2;
    list.forEach((en, i) => {
      x += gaps[i];
      out.set(en, { x, y });
      x += cw + GAP;
    });
  });
  return { pos: out, ch, rowH };
}

function dealRows(withFlip = true) {
  mode = 'dealing';
  deckArea.classList.remove('fanmode');
  const { pos, rowH } = rowPositions();

  // row labels sit above each row's cards
  rowLabelsEl.innerHTML = '';
  ROWS.forEach((row, r) => {
    const lab = document.createElement('div');
    lab.className = 'rowlab';
    lab.style.top = `${TOP + rowH * r + 4}px`;
    lab.innerHTML = row.cats
      .map((c) => `<span style="--accent:${CATS[c].color}">${CATS[c].label} <i>${entries.filter((en) => en.card.cat === c).length}</i></span>`)
      .join('<em>·</em>');
    rowLabelsEl.appendChild(lab);
  });

  let i = 0;
  for (const en of entries) {
    const p = pos.get(en);
    en.el.classList.remove('inpile');
    en.el.style.zIndex = 10 + i;
    setTimeout(() => {
      placeCard(en.el, p.x, p.y, 0);
      if (withFlip) setTimeout(() => en.el.classList.remove('down'), 190);
      else en.el.classList.remove('down');
    }, i * 42);
    i++;
  }
  setTimeout(() => {
    deckArea.classList.add('fanmode');
    rowLabelsEl.classList.add('on');
    mode = 'rows';
  }, entries.length * 42 + 620);
}

// ------------------------------------------------------------- left rail (focus views)

const rail = buildRail();

function buildRail() {
  const el = document.createElement('div');
  el.id = 'rail';
  el.classList.add('left', 'thumbs', 'off', 'collapsed');
  el.innerHTML = `
    <button class="rail-toggle" title="collection">⟩</button>
    <div class="rail-panel"><div class="rail-scroll"></div></div>`;
  document.body.appendChild(el);
  const scroll = el.querySelector('.rail-scroll');

  // pans in when triggered (hover / tap the edge tab), away when focus leaves
  let hideTimer = null;
  const expand = () => { clearTimeout(hideTimer); el.classList.remove('collapsed'); };
  const collapse = () => {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => el.classList.add('collapsed'), 350);
  };
  el.addEventListener('pointerenter', expand);
  el.addEventListener('pointerleave', collapse);
  el.querySelector('.rail-toggle').addEventListener('click', () => {
    el.classList.contains('collapsed') ? expand() : el.classList.add('collapsed');
  });

  scroll.addEventListener('click', (e) => {
    const item = e.target.closest('.rail-item');
    if (!item || item.classList.contains('current')) return;
    const card = cards.find((c) => c.id === item.dataset.id);
    if (card) railJump(card);
  });

  return {
    el,
    show(card) {
      // same-category thumbnails only, one column, no titles
      const items = cards.filter((c) => c.cat === card.cat && c.kind !== 'game');
      scroll.innerHTML = items.map((c) => `
        <button class="rail-item" data-id="${c.id}" title="${c.title}" style="--accent:${CATS[c.cat].color}">
          <img src="${c.thumb}" alt="${c.title}" loading="lazy" />
        </button>`).join('');
      el.classList.remove('off');
      el.classList.add('collapsed');
      this.setCurrent(card.id);
    },
    hide() { el.classList.add('off'); },
    setCurrent(id) {
      scroll.querySelectorAll('.rail-item').forEach((b) => b.classList.toggle('current', b.dataset.id === id));
      scroll.querySelector(`.rail-item[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    },
  };
}

async function railJump(card) {
  if (busy || !inFocus) return;
  busy = true;
  const ok = await focusJump(stage, fx, card, fader);
  if (ok) {
    current = card;
    rail.setCurrent(card.id);
  }
  busy = false;
}

// ------------------------------------------------------------- card activation

async function enterFocus(entry) {
  busy = true;
  entry.el.querySelector('.card-tilt').style.transform = '';
  rowLabelsEl.classList.remove('on');
  const ok = entry.card.kind === 'asset'
    ? await focusEnterSummon(stage, fx, entry.card, entry.el)
    : await focusEnterDive(stage, fx, entry.card, entry.el);
  if (ok) {
    inFocus = true;
    current = entry.card;
    rail.show(entry.card);
    fx.dismiss.textContent = '← back to deck';
    fx.dismiss.classList.add('on');
  } else {
    rowLabelsEl.classList.add('on');
  }
  busy = false;
}

async function showPoster(entry) {
  busy = true;
  rowLabelsEl.classList.remove('on');
  await posterFlow(fx, entry.card, entry.el);
  rowLabelsEl.classList.add('on');
  busy = false;
}

fx.dismiss.addEventListener('click', () => {
  if (!inFocus) return;
  inFocus = false;
  current = null;
  rail.hide();
  focusExit(stage, fx);
  rowLabelsEl.classList.add('on');
});

deckArea.addEventListener('click', (e) => {
  if (busy || inFocus || mode !== 'rows') return;
  const cardEl = e.target.closest('.card');
  if (!cardEl) return;
  const entry = entries.find((en) => en.el === cardEl);
  if (!entry) return;
  if (entry.card.kind === 'game') showPoster(entry);
  else enterFocus(entry);
});

// ------------------------------------------------------------- opening shuffle

async function riffle(rounds = 2) {
  const s = stackPos();
  deckArea.classList.add('fast');
  for (let r = 0; r < rounds; r++) {
    entries.forEach((en, i) => {
      const left = i % 2 === 0;
      setTimeout(() => {
        placeCard(en.el, s.x + (left ? -170 : 170) + jit(18), s.y + jit(14), (left ? -14 : 14) + jit(8));
      }, i * 6);
    });
    await sleep(380);
    entries.forEach((en, i) => {
      en.el.style.zIndex = (i * 7) % entries.length;
      setTimeout(() => placeCard(en.el, s.x + jit(5), s.y + jit(5), jit(7)), (entries.length - i) * 6);
    });
    await sleep(420);
  }
  entries.forEach((en, i) => {
    setTimeout(() => placeCard(en.el, s.x + jit(4), s.y - 46 + jit(6), jit(5)), i * 4);
  });
  await sleep(300);
  deckArea.classList.remove('fast');
}

// ------------------------------------------------------------- intro legend beat

const INTRO_IDS = ['dishwasher', 'bathhouse', 'dune-desert-village-v1', 'ghost-game'];
const LEGEND = {
  assets: ['Asset Card', 'A generated object with working joints. Click to summon it into 3D — it levitates, animated.'],
  sim: ['Sim Card', 'A full simulation environment. Click to teleport in and sweep through it.'],
  worlds: ['World Card', 'An entire generated world. Click to fall into it.'],
  game: ['Game Card', 'A playable build — the deck\u2019s coming attraction.'],
};

async function introBeat() {
  mode = 'intro';
  deckArea.classList.add('intromode'); // legend cards are display-only
  const introEntries = INTRO_IDS.map((id) => entries.find((en) => en.card.id === id));
  const rest = entries.filter((en) => !introEntries.includes(en));
  const pile = pilePos();
  const rowY = innerHeight * 0.40;
  const colX = (k) => innerWidth * (0.5 + (k - 1.5) * 0.19);

  // legend captions under each column
  legendEl.innerHTML = '';
  introEntries.forEach((en, k) => {
    const cat = CATS[en.card.cat];
    const [t, d] = LEGEND[en.card.cat];
    const leg = document.createElement('div');
    leg.className = 'leg';
    leg.style.left = `${colX(k)}px`;
    leg.style.top = `${rowY + 148}px`;
    leg.innerHTML = `<div class="lt" style="color:${cat.color}">${t}</div><div class="ld">${d}</div>`;
    legendEl.appendChild(leg);
  });

  // set the rest of the deck aside
  rest.forEach((en, i) => {
    en.el.classList.add('inpile');
    en.el.style.zIndex = i;
    setTimeout(() => placeCard(en.el, pile.x + jit(6), pile.y + jit(6), jit(8)), i * 12);
  });
  // slide the four representatives into a row, face-down
  introEntries.forEach((en, k) => {
    en.el.style.zIndex = 50 + k;
    setTimeout(() => placeCard(en.el, colX(k), rowY, 0), 250 + k * 140);
  });
  await sleep(250 + 4 * 140 + 480);

  // flip one by one, each with its legend line
  for (let k = 0; k < introEntries.length; k++) {
    introEntries[k].el.classList.remove('down');
    legendEl.children[k].classList.add('on');
    await sleep(500);
  }

  // confirm button sits directly under the legend row — the only clickable thing
  gotItBtn.style.top = `${rowY + 238}px`;
  gotItBtn.classList.add('on');
  await Promise.race([
    sleep(8000),
    new Promise((res) => gotItBtn.addEventListener('click', res, { once: true })),
  ]);
  gotItBtn.classList.remove('on');
  [...legendEl.children].forEach((l) => l.classList.remove('on'));
  deckArea.classList.remove('intromode');
  // intro cards go face-down again so the deal flips everything together
  introEntries.forEach((en) => en.el.classList.add('down'));
  await sleep(280);
}

async function opening() {
  const s = stackPos();
  sizeCards();
  entries.forEach((en, i) => {
    en.el.classList.add('down');
    placeCard(en.el, s.x + jit(4), s.y + jit(4), jit(6));
    en.el.style.zIndex = i;
    en.el.style.transition = 'none';
  });
  void deckArea.offsetWidth;
  entries.forEach((en) => { en.el.style.transition = ''; });
  loading.classList.add('done');
  await sleep(450);
  await riffle(2);
  await sleep(120);
  await introBeat();
  dealRows();
  busy = false;
}

addEventListener('resize', () => {
  if (busy || mode !== 'rows' || inFocus) return;
  dealRows(false);
});

opening();
