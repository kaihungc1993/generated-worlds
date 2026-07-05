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

export function createDeck(container, { blender, evals, concepts = {} }) {
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
    <button id="gotIt">Explore →</button>
    <div id="deckArea"><div id="deckCanvas"><div id="rowLabels"></div></div></div>

    <div id="fx-fill"></div>
    <div id="fx-rays"></div>
    <div id="fx-panels">
      <div id="fx-concept"><div class="k">CONCEPT REFERENCE</div><img alt="" title="click to enlarge" /></div>
      <div id="fx-caption"><div class="k"></div><div class="t"></div><div class="d"></div></div>
    </div>
    <div id="fx-lightbox"><img alt="" /><div class="cap">CONCEPT REFERENCE · CLICK TO CLOSE</div></div>
    <button id="fx-dismiss" aria-label="back">← Back</button>
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

  const cards = buildCards(blender, evals, concepts);
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
      fx.dismiss.textContent = '← Back';
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

  // concept reference panel: click-to-enlarge lightbox (any focused card with art)
  fx.concept.querySelector('img').addEventListener('click', () => {
    fx.lightbox.querySelector('img').src = fx.concept.querySelector('img').src;
    fx.lightbox.classList.add('on');
  });
  fx.lightbox.addEventListener('click', () => fx.lightbox.classList.remove('on'));

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

  // ----------------------------------------------------------- opening flight

  // Face-up "hero" cards for the opening flight: photogenic art spanning all
  // four categories so every accent color flashes by mid-tumble. Ids missing
  // from the manifest are skipped; the quota loop below tops categories up.
  const FLY_FACEUP = [
    'le-creuset-stackable-ramekins', 'dishwasher', 'office-chair',
    'shopping-mall-interior', 'theme-park',
    'dune-desert-village-v1', 'elden-ring-castle-v2', 'japanese-shrine-night-v2',
    'ghost-game',
  ];
  const FLY_DRIFT = 2100; // ms of free tumbling before the first card is pulled in
  const FLY_STAGGER = 36; // ms between successive pulls into the stack
  const FLY_GATHER = 620; // ms for one card's pull

  const rnd = (a, b) => a + Math.random() * (b - a);

  function pickFlyFaceUp() {
    const picked = new Set(
      FLY_FACEUP.map((id) => entries.find((en) => en.card.id === id)).filter(Boolean),
    );
    for (const cat of ['assets', 'sim', 'worlds', 'game']) {
      const want = cat === 'game' ? 1 : 2;
      for (const en of catEntries(cat)) {
        if ([...picked].filter((p) => p.card.cat === cat).length >= want) break;
        picked.add(en);
      }
    }
    return picked;
  }

  /** Opening "flying cards" beat: the deck tumbles in from beyond the viewport
   * edges, each card revolving continuously around its own diagonal 3D axis
   * (rotate3d on .card-tilt, 1–3 full revolutions) so cards genuinely flip
   * over — front, edge-on shimmer, back — while drifting on gentle bezier
   * arcs. Every card keeps the .down class throughout; which face shows at a
   * given instant is purely the revolution phase, and the "hero" cards are
   * phase-biased to be front-facing during the prominent mid-drift window
   * (a half revolution past .down shows the front). The gather then eases
   * each card's angle to the nearest full revolution — flat, back to camera —
   * so the pile lands face-down exactly where the old riffle ended and
   * introBeat / dealRows continue unchanged. prepareFlight() is called before
   * the hero beat so the cards already sit off-screen when the card layer
   * fades in; transforms are rAF-driven, transitions off via #deckArea.flying. */
  function prepareFlight() {
    const s = stackPos();
    const W = innerWidth;
    const H = innerHeight;
    const faceUp = pickFlyFaceUp();
    deckArea.classList.add('flying');

    // compact layouts use much larger cards relative to the viewport — scale
    // the flying cloud down so ~25 tumbling cards never clump unreadably
    const cwNow = parseFloat(deckArea.style.getPropertyValue('--cw')) || 164;
    const m = Math.min(1, (W * 0.1) / cwNow);

    // arrival order: a strided permutation so consecutive pulls come from
    // different screen regions instead of sweeping around the ring
    const order = entries.map((_, i) => (i * 7) % entries.length);

    const flyers = entries.map((en, i) => {
      const up = faceUp.has(en);
      // entry edges favor the sides — reads as cards streaming across
      const side = 'LRTRLB'[i % 6];
      const off = 120 + Math.random() * 140; // beyond the edge, viewport-safe
      const start =
        side === 'L' ? { x: -off, y: H * rnd(0.05, 0.95) }
        : side === 'R' ? { x: W + off, y: H * rnd(0.05, 0.95) }
        : side === 'T' ? { x: W * rnd(0.08, 0.92), y: -off }
        : { x: W * rnd(0.08, 0.92), y: H + off };
      // drift target: a loose golden-angle ring around the center fills the
      // screen evenly (no clumps); face-up heroes biased toward the middle
      const ang = i * 2.39996 + rnd(-0.25, 0.25);
      const drift = {
        x: W * 0.5 + Math.cos(ang) * W * (up ? rnd(0.13, 0.3) : rnd(0.12, 0.4)),
        y: H * 0.48 + Math.sin(ang) * H * (up ? rnd(0.11, 0.26) : rnd(0.1, 0.36)),
      };
      // quadratic-bezier control point bows the path into a gentle arc
      const dx = drift.x - start.x;
      const dy = drift.y - start.y;
      const bow = rnd(0.16, 0.38) * (i % 2 ? 1 : -1);
      const ctrl = {
        x: (start.x + drift.x) / 2 - dy * bow,
        y: (start.y + drift.y) / 2 + dx * bow,
      };
      const grabAt = FLY_DRIFT + order[i] * FLY_STAGGER;
      // tumble axis: a diagonal mix of X and Y with a touch of Z, so cards
      // flip over corner-to-corner like real tossed cards. Heroes stay
      // Y-dominant so their fronts read upright-ish while facing the camera.
      const axX = (up ? rnd(0.35, 0.7) : rnd(0.5, 1)) * (Math.random() < 0.5 ? -1 : 1);
      const axY = (up ? rnd(0.75, 1) : rnd(0.5, 1)) * (Math.random() < 0.5 ? -1 : 1);
      const axZ = rnd(0.1, 0.35) * (Math.random() < 0.5 ? -1 : 1);
      const axL = Math.hypot(axX, axY, axZ);
      // heroes revolve slowly (longer front-facing window); the rest faster
      const rev = up ? rnd(1, 1.6) : rnd(1.6, 3);
      const w = (rev * 360 / grabAt) * (i % 3 === 0 ? -1 : 1); // deg/ms
      // phase bias: while the cloud floats fully formed (~72% into the
      // drift) heroes pass through a front-showing half revolution (180° on
      // top of the .down flip), the rest hover around back/edge-on
      const tm = grabAt * 0.72;
      const a0 = (up ? 180 + jit(50) : rnd(-130, 130)) - w * tm;
      return {
        en, up, start, ctrl, drift,
        tiltEl: en.el.querySelector('.card-tilt'),
        axis: `${(axX / axL).toFixed(3)}, ${(axY / axL).toFixed(3)}, ${(axZ / axL).toFixed(3)}`,
        w, a0,
        s0: m * (up ? rnd(1.05, 1.55) : rnd(0.55, 1.1)), // heroes fly near-camera
        s1: m * (up ? rnd(0.95, 1.15) : rnd(0.75, 1.0)),
        z0: up ? rnd(-40, 180) : rnd(-260, 140), // translateZ parallax depth
        rot0: rnd(-26, 26),
        spin: rnd(9, 26) * (i % 2 ? 1 : -1), // lazy in-plane spin, deg/s
        grabAt,
        end: { x: s.x + jit(4), y: s.y - 46 + jit(6), rot: jit(5) },
        zEnd: 40 + order[i],
        grab: null, done: false, x: 0, y: 0, rot: 0, sc: 1, z: 0, a: 0,
      };
    });

    for (const f of flyers) {
      // every card stays .down for the whole flight — which face shows at any
      // instant is purely the rotate3d phase, so there's no class-flip snap
      f.en.el.classList.add('down');
      f.en.el.style.zIndex = 5 + Math.round(f.s0 * 20); // near-camera on top
      placeCard(f.en.el, f.start.x, f.start.y, f.rot0, 0, f.s0);
      f.tiltEl.style.transform = `rotate3d(${f.axis}, ${f.a0.toFixed(1)}deg)`;
    }

    async function run() {
      const easeOut = (t) => 1 - (1 - t) ** 3;
      const smooth = (t) => t * t * (3 - 2 * t);
      await new Promise((resolve) => {
        let left = flyers.length;
        const t0 = performance.now();
        const tick = (now) => {
          if (destroyed) { resolve(); return; }
          const t = now - t0;
          const ts = t / 1000;
          for (const f of flyers) {
            if (f.done) continue;
            let depth = f.z0;
            if (t < f.grabAt) {
              // drift: fast entry decelerating into a slow float at the ring,
              // revolving steadily around the card's own diagonal axis
              const u = easeOut(Math.min(1, t / f.grabAt));
              const v = 1 - u;
              f.x = v * v * f.start.x + 2 * v * u * f.ctrl.x + u * u * f.drift.x;
              f.y = v * v * f.start.y + 2 * v * u * f.ctrl.y + u * u * f.drift.y;
              f.rot = f.rot0 + f.spin * ts;
              f.sc = f.s0 + (f.s1 - f.s0) * u;
              f.a = f.a0 + f.w * t;
            } else {
              if (!f.grab) {
                // capture the mid-air pose and start the pull; the revolution
                // finishes at the nearest full turn — flat, back to camera —
                // so the card lands face-down with no visible snap
                f.grab = { x: f.x, y: f.y, rot: f.rot, sc: f.sc, a: f.a, aEnd: Math.round(f.a / 360) * 360 };
                f.en.el.style.zIndex = f.zEnd;
              }
              const g = Math.min(1, (t - f.grabAt) / FLY_GATHER);
              const e = smooth(g);
              f.x = f.grab.x + (f.end.x - f.grab.x) * e;
              f.y = f.grab.y + (f.end.y - f.grab.y) * e;
              f.rot = f.grab.rot + (f.end.rot - f.grab.rot) * e;
              f.sc = f.grab.sc + (1 - f.grab.sc) * e;
              f.a = f.grab.a + (f.grab.aEnd - f.grab.a) * e;
              depth = f.z0 * (1 - e);
              if (g >= 1) { f.done = true; left--; }
            }
            placeCard(f.en.el, f.x, f.y, f.rot, 0, f.sc);
            f.tiltEl.style.transform = f.done ? '' :
              `translateZ(${depth.toFixed(1)}px) rotate3d(${f.axis}, ${f.a.toFixed(2)}deg)`;
          }
          if (left > 0) requestAnimationFrame(tick);
          else resolve();
        };
        requestAnimationFrame(tick);
      });
      deckArea.classList.remove('flying');
    }

    return { run };
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
    sizeCards();
    // cards start scattered beyond the viewport edges, ready to fly in
    const flight = prepareFlight();
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
    await flight.run();
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
