// Command Grid — AAA character-select: compact category-grouped tile grid
// on the left, live stage on the right (rotating GLB for assets, Ken Burns
// thumbnail for scenes). Enter triggers the full summon / dive into the
// shared side-rail focus views.
import {
  loadCards, CATS, Stage, fxRefs, raysBurst, showCaption, toast,
  makeRail, makeFader, focusJump, sleep,
} from '/previews/cards-shared.js';

const tileGroups = document.getElementById('tileGroups');
const previewEl = document.getElementById('preview');
const kbEl = previewEl.querySelector('.kb');
const infoEl = document.getElementById('info');
const enterBtn = document.getElementById('enter');
const spinner = document.getElementById('spinner');
const loading = document.getElementById('loading');
const stage = new Stage(document.getElementById('stage'));
const fx = fxRefs();
const fader = makeFader();

const cards = await loadCards({ all: true });
const LEFT_W = 344;

let selected = null;
let selVersion = 0;
let busy = false;
let inFocus = false;
let posterOpen = false;

// keep the model centered in the visible stage area (right of the panel)
function applyViewOffset() {
  stage.camera.setViewOffset(innerWidth, innerHeight, -LEFT_W / 2, 0, innerWidth, innerHeight);
}
applyViewOffset();
addEventListener('resize', () => { if (!inFocus) applyViewOffset(); });

// ------------------------------------------------------------- tiles

const tileOf = new Map();
for (const catId of Object.keys(CATS)) {
  const cat = CATS[catId];
  const items = cards.filter((c) => c.cat === catId);
  if (!items.length) continue;
  const head = document.createElement('div');
  head.className = 'cat-head';
  head.style.setProperty('--c', cat.color);
  head.innerHTML = `${cat.label}<i>${items.length}</i>`;
  tileGroups.appendChild(head);
  const grid = document.createElement('div');
  grid.className = 'tiles';
  for (const card of items) {
    const b = document.createElement('button');
    b.className = 'tile';
    b.dataset.id = card.id;
    b.style.setProperty('--c', cat.color);
    b.title = card.title;
    b.innerHTML = `<img src="${card.thumb}" alt="${card.title}" loading="lazy" />`;
    grid.appendChild(b);
    tileOf.set(card.id, b);
  }
  tileGroups.appendChild(grid);
}

// ------------------------------------------------------------- selection

function statLine(card) {
  if (card.kind === 'game') return '<span><b>GODOT 4</b> · WEB BUILD</span><span><b>COMING SOON</b></span>';
  const size = card.sizeKB > 1024 ? (card.sizeKB / 1024).toFixed(1) + ' MB' : card.sizeKB + ' KB';
  return `<span>▲ <b>${(card.polys / 1000).toFixed(0)}K</b> TRIS</span>`
    + `<span><b>${size}</b></span>`
    + `<span><b>${card.animated ? 'ANIMATED' : 'STATIC'}</b></span>`
    + (card.sky ? '<span><b>SKY DOME</b></span>' : '');
}

async function select(card) {
  if (selected?.id === card.id) return;
  selected = card;
  const v = ++selVersion;
  const cat = CATS[card.cat];
  tileOf.forEach((b, id) => b.classList.toggle('sel', id === card.id));

  // info swap
  infoEl.classList.add('swap');
  setTimeout(() => {
    if (v !== selVersion) return;
    infoEl.querySelector('.k').textContent = cat.label;
    infoEl.querySelector('.k').style.color = cat.color;
    infoEl.querySelector('h1').textContent = card.title;
    infoEl.querySelector('.d').textContent = card.desc;
    infoEl.querySelector('.stats').innerHTML = statLine(card);
    enterBtn.style.setProperty('--ac', cat.color);
    enterBtn.textContent = card.kind === 'asset' ? 'SUMMON ⏎' : card.kind === 'scene' ? 'DIVE IN ⏎' : 'TEASER ⏎';
    infoEl.classList.remove('swap');
  }, 160);

  if (card.kind === 'asset') {
    previewEl.classList.remove('on');
    spinner.classList.add('on');
    stage.show(false);
    try {
      const ok = await stage.summon(card);
      if (v !== selVersion) return;
      if (ok === false) return; // superseded internally
    } catch (err) {
      console.error(err);
      if (v === selVersion) toast(fx.toast, 'model failed to load');
    }
    if (v !== selVersion) return;
    spinner.classList.remove('on');
  } else {
    spinner.classList.remove('on');
    stage.hide();
    stage.clear();
    // restart the Ken Burns drift
    kbEl.style.animation = 'none';
    kbEl.style.backgroundImage = `url('${card.thumb}')`;
    void kbEl.offsetWidth;
    kbEl.style.animation = '';
    previewEl.classList.add('on');
  }
}

let hoverTimer = null;
tileGroups.addEventListener('pointerover', (e) => {
  if (busy || inFocus) return;
  const tile = e.target.closest('.tile');
  if (!tile) return;
  clearTimeout(hoverTimer);
  hoverTimer = setTimeout(() => {
    const card = cards.find((c) => c.id === tile.dataset.id);
    if (card && !busy && !inFocus) select(card);
  }, 140);
});
tileGroups.addEventListener('pointerout', () => clearTimeout(hoverTimer));
tileGroups.addEventListener('click', (e) => {
  if (busy || inFocus) return;
  const tile = e.target.closest('.tile');
  if (!tile) return;
  clearTimeout(hoverTimer);
  const card = cards.find((c) => c.id === tile.dataset.id);
  if (card) select(card);
});

// ------------------------------------------------------------- enter / focus

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
    selected = card;
    tileOf.forEach((b, id) => b.classList.toggle('sel', id === card.id));
    rail.setCurrent(card.id);
  }
  busy = false;
}

async function enterFocus() {
  if (!selected || busy || inFocus) return;
  const card = selected;
  busy = true;

  if (card.kind === 'game') {
    posterOpen = true;
    fx.dim.classList.add('on');
    fx.poster.classList.add('on');
    fx.dismiss.textContent = 'dismiss ✕';
    fx.dismiss.classList.add('on');
    fx.help?.style.setProperty('opacity', '0');
    busy = false;
    return;
  }

  fx.help?.style.setProperty('opacity', '0');
  if (card.kind === 'asset') {
    // the model is already on stage — recenter and go fullscreen
    await fader.to(false);
    document.body.classList.add('focus');
    stage.camera.clearViewOffset();
    stage.el.classList.add('interactive');
    showCaption(fx.caption, card);
    fader.off();
  } else {
    // isekai: Ken Burns already fills the frame → plunge + fall
    document.body.classList.add('focus');
    stage.camera.clearViewOffset();
    fx.fill.style.backgroundImage = `url('${card.thumb}')`;
    fx.fill.classList.add('on');
    const pill = document.createElement('div');
    pill.className = 'mat-pill';
    pill.textContent = 'MATERIALIZING WORLD…';
    fx.fill.appendChild(pill);
    let flightDone;
    const flightP = new Promise((r) => { flightDone = r; });
    const result = await stage.dive(card, flightDone).catch((err) => { console.error(err); return null; });
    if (!result) {
      toast(fx.toast, 'dive failed — world could not be loaded');
      fx.fill.classList.remove('on');
      pill.remove();
      document.body.classList.remove('focus');
      applyViewOffset();
      fx.help?.style.setProperty('opacity', '');
      busy = false;
      return;
    }
    raysBurst(fx.rays);
    stage.show(false);
    pill.remove();
    fx.fill.classList.remove('on');
    showCaption(fx.caption, card);
    await flightP;
    stage.el.classList.add('interactive');
  }
  inFocus = true;
  rail.show(card.id);
  fx.dismiss.textContent = '← back to grid';
  fx.dismiss.classList.add('on');
  busy = false;
}
enterBtn.addEventListener('click', enterFocus);
addEventListener('keydown', (e) => { if (e.key === 'Enter') enterFocus(); });

fx.dismiss.addEventListener('click', async () => {
  if (posterOpen) {
    posterOpen = false;
    fx.poster.classList.remove('on');
    if (inFocus) {
      fx.dismiss.textContent = '← back to grid';
    } else {
      fx.dim.classList.remove('on');
      fx.dismiss.classList.remove('on');
      fx.help?.style.setProperty('opacity', '');
    }
    return;
  }
  if (!inFocus || busy) return;
  busy = true;
  inFocus = false;
  await fader.to(false);
  rail.hide();
  fx.caption.classList.remove('on');
  fx.dismiss.classList.remove('on');
  fx.help?.style.setProperty('opacity', '');
  document.body.classList.remove('focus');
  stage.el.classList.remove('interactive');
  applyViewOffset();
  // rebuild the browse-side stage for whatever is now selected
  const cur = selected;
  selected = null;
  const p = select(cur);
  fader.off();
  await p;
  busy = false;
});

// ------------------------------------------------------------- opening

loading.classList.add('done');
select(cards[0]);
