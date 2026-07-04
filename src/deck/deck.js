// Deck landing page — the "one deck" card experience promoted from
// previews/one-deck.js: riffle shuffle, card-type intro legend, then all
// cards dealt into three category rows (assets / sim envs / worlds + game).
// Clicking a card enters the focus view, which has an always-visible
// left-side thumbnail rail of the same category. Exposed as a factory so the hash
// router in main.js can mount/unmount it.
import './deck.css';
import {
  buildCards, makeCardEl, placeCard, attachTilt, CATS, Stage, fxRefs,
  focusEnterSummon, focusEnterDive, focusJump, focusExit, makeFader,
  posterFlow, sleep,
} from './deck-engine.js';

const BASE = import.meta.env.BASE_URL;
// Module-level so the intro legend replays on every fresh page load but is
// skipped when the deck is remounted within the same session (e.g. returning
// from the gallery route or a dive).
let introPlayed = false;
// Same gating for the opening hero banner: plays once per fresh page load,
// before the shuffle; remounts within the session go straight to the deck.
let heroPlayed = false;

export function createDeck(container, { blender, evals }) {
  const root = document.createElement('div');
  root.id = 'deck-root';
  if (!heroPlayed) root.classList.add('heromode');
  root.innerHTML = `
    <div class="title">
      <h1>Prompts in. <em>Interactive 3D Worlds</em> out.</h1>
      <div class="byline">Kai-Hung Chang at Moonlake AI</div>
    </div>
    <div id="hero">
      <div class="hero-inner">
        <h1><span class="hl1">Prompts in.</span> <span class="hl2"><em>Interactive 3D Worlds</em> out.</span></h1>
        <div class="hby">Kai-Hung Chang at Moonlake AI</div>
      </div>
    </div>
    <div id="stage"></div>
    <div id="fx-dim"></div>
    <div id="introLegend"></div>
    <button id="gotIt">Understood →</button>
    <div id="deckArea"><div id="deckCanvas"><div id="rowLabels"></div></div></div>

    <div id="fx-fill"></div>
    <div id="fx-rays"></div>
    <div id="fx-caption"><div class="k"></div><div class="t"></div><div class="d"></div></div>
    <button id="fx-dismiss" aria-label="dismiss">✕</button>
    <a id="fx-poster" href="${BASE}play/ghost/index.html" target="_blank" rel="noopener">
      <img src="${BASE}play/ghost/promo/street.webp" alt="Ghosts in the Dataset" />
      <div class="banner">
        <div class="k">★ Playable now ★</div>
        <div class="t">Ghosts in the Dataset</div>
        <div class="d">A complete cyberpunk arcade world built in Godot 4 — NPCs, working mini-games, procedural audio. Runs in your browser.</div>
        <span class="cta">▶ Play in browser</span>
      </div>
    </a>
    <div id="fx-toast"></div>

    <div class="loading" id="loading">shuffling the deck…</div>
  `;
  container.appendChild(root);
  document.body.classList.add('deck-mode');

  const deckArea = root.querySelector('#deckArea');
  const deckCanvas = root.querySelector('#deckCanvas');
  const legendEl = root.querySelector('#introLegend');
  const rowLabelsEl = root.querySelector('#rowLabels');
  const gotItBtn = root.querySelector('#gotIt');
  const loading = root.querySelector('#loading');
  const stage = new Stage(root.querySelector('#stage'));
  const fx = fxRefs(root);
  const fader = makeFader(root);

  const cards = buildCards(blender, evals);
  const entries = cards.map((card) => {
    const el = makeCardEl(card);
    deckCanvas.appendChild(el);
    return { card, el };
  });
  attachTilt(deckArea);

  let destroyed = false;
  let busy = true; // unlocked once the rows are first dealt
  let mode = 'shuffle'; // shuffle | intro | rows
  let inFocus = false;
  let current = null;

  // ----------------------------------------------------------- layout

  const stackPos = () => ({ x: innerWidth / 2, y: innerHeight * 0.52 });
  const pilePos = () => ({ x: innerWidth - 96, y: innerHeight - 150 });
  const jit = (n) => (Math.random() - 0.5) * n;

  // Category rows: assets / sim / worlds + game. On wide viewports all three
  // fit in view as single lines (game set apart by a wider gap). When cards
  // would fall below a readable size, the layout switches to a scrollable
  // sectioned deck: each category becomes a titled band whose cards wrap
  // into as many lines as needed at a comfortable card size.
  const ROWS = [
    { cats: ['assets'] },
    { cats: ['sim'] },
    { cats: ['worlds', 'game'] },
  ];
  const GAP = 18; // between cards in a line
  const BOTTOM = 28; // page bottom margin
  const CW_MIN_WIDE = 104; // below this card width the one-glance layout isn't readable
  const isNarrow = () => innerWidth < 700;
  const PAD = () => (isNarrow() ? 14 : 26); // page side padding
  const TOP = () => (isNarrow() ? 84 : 100); // below the fixed page title
  const LABEL_H = () => (isNarrow() ? 56 : 64); // room for the section title
  const gameGap = () => Math.max(64, Math.min(120, innerWidth * 0.08));

  function rowEntries(row) {
    return row.cats.flatMap((cat) => entries.filter((en) => en.card.cat === cat));
  }
  const catEntries = (cat) => entries.filter((en) => en.card.cat === cat);

  /** Compute the full deal layout. Returns card positions (canvas coords),
   * section label placements, card size, and the scrollable canvas height. */
  function computeLayout() {
    const W = innerWidth;
    const H = innerHeight;
    const availW = W - PAD() * 2;

    // ---- try the one-glance layout: 3 rows, each a single line
    const rowH = (H - TOP() - BOTTOM) / ROWS.length;
    let cw = Math.min(
      Math.round((rowH - LABEL_H() - 10) * 0.72),
      Math.floor(Math.min(...ROWS.map((r) => {
        const n = rowEntries(r).length;
        const extra = r.cats.length > 1 ? gameGap() : 0;
        return (availW - extra - (n - 1) * GAP) / n;
      }))),
      260,
    );
    if (cw >= CW_MIN_WIDE && W >= 1180) {
      const ch = Math.round(cw / 0.72);
      const pos = new Map();
      const labels = [];
      ROWS.forEach((row, r) => {
        const list = rowEntries(row);
        const gaps = list.map((en, i) => (i > 0 && en.card.cat === 'game' && list[i - 1].card.cat !== 'game' ? gameGap() : 0));
        const totalW = list.length * cw + (list.length - 1) * GAP + gaps.reduce((a, b) => a + b, 0);
        let x = (W - totalW) / 2 + cw / 2;
        const y = TOP() + rowH * r + LABEL_H() + (rowH - LABEL_H()) / 2;
        list.forEach((en, i) => {
          x += gaps[i];
          pos.set(en, { x, y });
          x += cw + GAP;
        });
        // one title per category, centered over that category's card group
        row.cats.forEach((cat) => {
          const grp = list.filter((en) => en.card.cat === cat);
          if (!grp.length) return;
          labels.push({
            cat,
            x: (pos.get(grp[0]).x + pos.get(grp[grp.length - 1]).x) / 2,
            y: TOP() + rowH * r + LABEL_H() / 2,
          });
        });
      });
      return { pos, labels, cw, ch, canvasH: H, scroll: false };
    }

    // ---- scrollable sectioned layout: one titled band per category
    const perLine = Math.max(2, Math.floor((availW + GAP) / (172 + GAP)));
    cw = Math.floor(Math.min(210, (availW - (perLine - 1) * GAP) / perLine));
    const ch = Math.round(cw / 0.72);
    const LINE_GAP = 16;
    const BAND_GAP = 34;
    const pos = new Map();
    const labels = [];
    let y = TOP();
    for (const cat of ['assets', 'sim', 'worlds', 'game']) {
      const list = catEntries(cat);
      if (!list.length) continue;
      labels.push({ cat, x: W / 2, y: y + LABEL_H() / 2 });
      y += LABEL_H();
      for (let i = 0; i < list.length; i += perLine) {
        const line = list.slice(i, i + perLine);
        const totalW = line.length * cw + (line.length - 1) * GAP;
        let x = (W - totalW) / 2 + cw / 2;
        for (const en of line) {
          pos.set(en, { x, y: y + ch / 2 });
          x += cw + GAP;
        }
        y += ch + LINE_GAP;
      }
      y += BAND_GAP - LINE_GAP;
    }
    return { pos, labels, cw, ch, canvasH: Math.ceil(y + BOTTOM), scroll: true };
  }

  /** Apply card size + canvas metrics; returns the layout. */
  function sizeCards() {
    const layout = computeLayout();
    deckArea.style.setProperty('--cw', `${layout.cw}px`);
    deckArea.style.setProperty('--ch', `${layout.ch}px`);
    deckArea.classList.toggle('scroll', layout.scroll);
    deckCanvas.style.height = layout.scroll ? `${layout.canvasH}px` : '100%';
    return layout;
  }

  function dealRows(withFlip = true) {
    mode = 'dealing';
    deckArea.classList.remove('fanmode');
    const layout = sizeCards();

    rowLabelsEl.innerHTML = '';
    for (const { cat, x, y } of layout.labels) {
      const lab = document.createElement('div');
      lab.className = 'rowlab';
      lab.style.top = `${y}px`;
      lab.innerHTML = `<span style="--accent:${CATS[cat].color}">${CATS[cat].label}</span>`;
      rowLabelsEl.appendChild(lab);
      // clamp so wide titles (e.g. over the lone game card) stay on screen
      const half = lab.offsetWidth / 2;
      lab.style.left = `${Math.min(Math.max(x, half + 12), innerWidth - half - 12)}px`;
    }

    let i = 0;
    for (const en of entries) {
      const p = layout.pos.get(en);
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
      if (destroyed) return;
      deckArea.classList.add('fanmode');
      rowLabelsEl.classList.add('on');
      mode = 'rows';
    }, entries.length * 42 + 620);
  }

  // ----------------------------------------------------------- left rail (focus views)

  const rail = buildRail();

  function buildRail() {
    const el = document.createElement('div');
    el.id = 'rail';
    el.classList.add('off');
    el.innerHTML = `
      <button class="rail-toggle" title="collection">⟩</button>
      <div class="rail-panel"><div class="rail-scroll"></div></div>`;
    root.appendChild(el);
    const scroll = el.querySelector('.rail-scroll');

    // always expanded while in focus mode; the tab only collapses/expands manually
    el.querySelector('.rail-toggle').addEventListener('click', () => {
      el.classList.toggle('collapsed');
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
        // narrow screens: the panel would cover half the view — start collapsed
        // behind its edge tab; wide screens keep it always visible
        el.classList.toggle('collapsed', innerWidth < 700);
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

  // ----------------------------------------------------------- card activation

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
      root.classList.add('infocus'); // page chrome steps back
      rail.show(entry.card);
      fx.dismiss.textContent = '✕';
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
    root.classList.remove('infocus');
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

  // ----------------------------------------------------------- opening shuffle

  async function riffle(rounds = 2) {
    const s = stackPos();
    const split = Math.min(170, innerWidth * 0.19); // half-deck offset, viewport-safe
    deckArea.classList.add('fast');
    for (let r = 0; r < rounds; r++) {
      entries.forEach((en, i) => {
        const left = i % 2 === 0;
        setTimeout(() => {
          placeCard(en.el, s.x + (left ? -split : split) + jit(18), s.y + jit(14), (left ? -14 : 14) + jit(8));
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

  // ----------------------------------------------------------- intro legend beat

  const INTRO_IDS = ['le-creuset-stackable-ramekins', 'shopping-mall-interior', 'dune-desert-village-v1', 'ghost-game'];
  const LEGEND = {
    assets: ['Articulated Assets', 'An articulated object from Blender procedural-generation agents — an actor plus critics, 1–3 h runs, 0–3 rounds of human feedback'],
    sim: ['Greybox Scenes', 'The same agent pipeline pushed to a whole greybox scene — 3–6 h runs, zero human feedback'],
    worlds: ['Generated Worlds', 'A scale-consistent world from a GenAI workflow — concept art, segmentation, mesh generation — in ~10 min, zero human feedback'],
    game: ['Playable Game', 'An earlier world pipeline plus vibe-coded mechanics from a Godot agent — AI-aided human creation, built in a week'],
  };

  async function introBeat() {
    mode = 'intro';
    deckArea.classList.add('intromode'); // legend cards are display-only
    const introEntries = INTRO_IDS.map((id) => entries.find((en) => en.card.id === id));
    const rest = entries.filter((en) => !introEntries.includes(en));
    const pile = pilePos();
    const W = innerWidth;
    const H = innerHeight;
    const narrow = W < 760;

    // intro card size independent of the deal layout so the legend row
    // always fits: 4 across on wide screens, a 2×2 grid on narrow ones
    let cw, ch, cardPos, legendMode;
    if (!narrow) {
      const spacing = Math.min(W * 0.24, 300);
      cw = Math.min(190, spacing - 44, (H * 0.30) * 0.72);
      ch = Math.round(cw / 0.72);
      const rowY = H * 0.36;
      cardPos = (k) => ({ x: W / 2 + (k - 1.5) * spacing, y: rowY });
      legendMode = { type: 'columns', spacing, rowY, ch };
    } else {
      cw = Math.min(150, (W - 60) / 2, (H * 0.22) * 0.72);
      ch = Math.round(cw / 0.72);
      const gx = cw / 2 + 10;
      const gy = ch / 2 + 10;
      const cyTop = H * 0.24;
      cardPos = (k) => ({
        x: W / 2 + (k % 2 === 0 ? -gx : gx),
        y: cyTop + (k < 2 ? 0 : gy * 2),
      });
      legendMode = { type: 'single', y: cyTop + gy * 3 + 26 };
    }
    deckArea.style.setProperty('--cw', `${Math.round(cw)}px`);
    deckArea.style.setProperty('--ch', `${ch}px`);

    // legend captions: one per column on wide screens; on narrow screens a
    // single caption area below the grid shows the active card's legend
    legendEl.innerHTML = '';
    introEntries.forEach((en, k) => {
      const cat = CATS[en.card.cat];
      const [t, d] = LEGEND[en.card.cat];
      const leg = document.createElement('div');
      leg.className = 'leg';
      if (legendMode.type === 'columns') {
        leg.style.left = `${cardPos(k).x}px`;
        leg.style.top = `${legendMode.rowY + legendMode.ch / 2 + 22}px`;
        leg.style.width = `${Math.min(legendMode.spacing - 18, 320)}px`;
      } else {
        leg.style.left = `${W / 2}px`;
        leg.style.top = `${legendMode.y}px`;
        leg.style.width = `${W - 48}px`;
      }
      leg.innerHTML = `<div class="lt" style="color:${cat.color}">${t}</div><div class="ld">${d}</div>`;
      legendEl.appendChild(leg);
    });

    // set the rest of the deck aside
    rest.forEach((en, i) => {
      en.el.classList.add('inpile');
      en.el.style.zIndex = i;
      setTimeout(() => placeCard(en.el, pile.x + jit(6), pile.y + jit(6), jit(8)), i * 12);
    });
    // slide the four representatives into place, face-down
    introEntries.forEach((en, k) => {
      en.el.style.zIndex = 50 + k;
      const p = cardPos(k);
      setTimeout(() => placeCard(en.el, p.x, p.y, 0), 250 + k * 140);
    });
    await sleep(250 + 4 * 140 + 480);

    // flip one by one, each with its legend line (narrow: one caption at a time)
    for (let k = 0; k < introEntries.length; k++) {
      introEntries[k].el.classList.remove('down');
      if (legendMode.type === 'single' && k > 0) legendEl.children[k - 1].classList.remove('on');
      legendEl.children[k].classList.add('on');
      await sleep(legendMode.type === 'single' ? 1800 : 500);
    }

    // confirm button sits under the legend area — the only clickable thing.
    // Measured from the tallest caption so longer copy never overlaps it.
    const legH = Math.max(...[...legendEl.children].map((l) => l.offsetHeight));
    const legendBottom = legendMode.type === 'columns'
      ? legendMode.rowY + legendMode.ch / 2 + 22 + legH + 44
      : legendMode.y + legH + 56;
    gotItBtn.style.top = `${Math.min(legendBottom, H - 72)}px`;
    gotItBtn.classList.add('on');
    // the intro holds until the user confirms — no auto-advance
    await new Promise((res) => gotItBtn.addEventListener('click', res, { once: true }));
    gotItBtn.classList.remove('on');
    [...legendEl.children].forEach((l) => l.classList.remove('on'));
    deckArea.classList.remove('intromode');
    // intro cards go face-down again so the deal flips everything together
    introEntries.forEach((en) => en.el.classList.add('down'));
    await sleep(280);
  }

  // ----------------------------------------------------------- hero opening beat

  /** Animated hero banner: staggered entrance, short hold (skippable), then a
      shrink-and-fade morph up into the compact page header. */
  async function heroBeat() {
    const hero = root.querySelector('#hero');
    hero.classList.add('show');
    await sleep(1700); // staggered entrance fully shown
    if (destroyed) return;
    // hold, or advance early on click / scroll / key
    await new Promise((resolve) => {
      let timer;
      const done = () => {
        clearTimeout(timer);
        hero.removeEventListener('pointerdown', done);
        removeEventListener('wheel', done);
        removeEventListener('keydown', done);
        resolve();
      };
      timer = setTimeout(done, 2000);
      hero.addEventListener('pointerdown', done);
      addEventListener('wheel', done);
      addEventListener('keydown', done);
    });
    if (destroyed) return;
    hero.classList.add('out');
    await sleep(300);
    // compact header + card layer fade back in while the hero shrinks away
    root.classList.remove('heromode');
    await sleep(650);
    hero.remove();
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
    // the hero banner plays on every fresh page load, before the shuffle;
    // remounts within the same session skip straight to the deck
    if (!heroPlayed) {
      await heroBeat();
      heroPlayed = true;
    } else {
      root.querySelector('#hero').remove();
      await sleep(450);
    }
    if (destroyed) return;
    await riffle(2);
    if (destroyed) return;
    await sleep(120);
    // the legend beat plays on every fresh page load; remounts within the
    // same session (back from gallery / dive) deal straight away
    if (!introPlayed) {
      await introBeat();
      introPlayed = true;
    }
    if (destroyed) return;
    dealRows();
    busy = false;
  }

  const onResize = () => {
    if (busy || mode !== 'rows' || inFocus) return;
    dealRows(false);
  };
  addEventListener('resize', onResize);

  opening();

  return {
    destroy() {
      destroyed = true;
      removeEventListener('resize', onResize);
      stage.dispose();
      document.body.classList.remove('deck-mode');
      root.remove();
    },
  };
}
