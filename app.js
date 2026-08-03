/* Projection UI prototype — flow + selection + motion. No deps. */

const stage   = document.getElementById('stage');
const screens = [...document.querySelectorAll('.screen')];
const order   = screens.map(s => s.dataset.screen);
const appbar  = document.getElementById('appbar');
const flowbar = document.getElementById('flowbar');
const steps   = [...flowbar.querySelectorAll('li')];

/* Hooks the later blocks fill in — the prototyping disc, the carousel and the auto crop, all
   driven from auto play. Declared up here because fit() reaches for recrop on the first call,
   and a `let` further down would still be in its dead zone. */
let aim = null, tapAt = null, press = null, trailTo = null, cursorShow = null;
let deckTo = null, deckOpens = 0, deckHome = 0, recrop = null;

/* ── size the shot, then fit the 1060×663 frame inside it ───
   The canvas is a fixed-aspect crop of the footage rather than the browser window, so it is
   sized here and not in CSS: aspect-ratio plus max-width/max-height cannot letterbox in one
   pass — whichever of the two is set explicitly wins and the other overflows. */
const fitEl  = document.getElementById('fit');
const canvas = document.getElementById('canvas');
let AR = 16 / 9;

const fit = () => {
  const full = document.fullscreenElement === canvas;
  // the transport panel is fixed, so it reserves no space of its own — measure it and hold the
  // shot clear of it, or the part being composed is the part hidden behind the controls.
  // Measured here rather than by a ResizeObserver: those deliver during the rendering steps,
  // which a background tab does not run, and the layout would silently stay wrong.
  const bar = document.getElementById('deskbar').offsetHeight + 40;
  const W = full ? innerWidth : fitEl.clientWidth - 24;
  const H = (full ? innerHeight : fitEl.clientHeight - 24) - bar;
  const w = Math.max(120, Math.min(W, H * AR));
  canvas.style.width = w + 'px';
  canvas.style.height = w / AR + 'px';
  canvas.style.marginBottom = full ? '0px' : bar + 'px';   // .fit centres it; push it clear
  canvas.style.setProperty('--s', Math.min(w / 1060, w / AR / 663));
  recrop?.();                              // the auto crop is a fraction of the canvas box
};
addEventListener('resize', fit);
addEventListener('fullscreenchange', fit);
fit();

/* client px → design px inside the frame.
   The frame can carry a 3D tilt to match the desk, which makes this a projective map, not a
   scale — an affine inverse drifts further the more it is tilted. On the frame's own plane
   (z=0) the matrix collapses to a 3×3 homography, so drop the z column and solve the 2×2 it
   leaves. The origin is the untransformed centre: every transform here is taken about
   transform-origin:center, and the canvas centres the frame without transforming, so the
   canvas's centre is that point. */
const shot = document.getElementById('shot');
const shotM = () => new DOMMatrix(getComputedStyle(shot).transform);

const unproject = (cx, cy) => {
  const f = canvas.getBoundingClientRect();
  // shot first, then the frame: both are taken about the same centre, so they compose
  const m = shotM().multiply(new DOMMatrix(getComputedStyle(stage).transform));
  const X = cx - (f.left + f.width / 2), Y = cy - (f.top + f.height / 2);
  // Xw = r0·p, Yw = r1·p, w = r2·p with p = (x, y, 1)
  const r0 = [m.m11, m.m21, m.m41], r1 = [m.m12, m.m22, m.m42], r2 = [m.m14, m.m24, m.m44];
  const A = r0.map((v, i) => v - X * r2[i]);   // A·p = 0
  const B = r1.map((v, i) => v - Y * r2[i]);   // B·p = 0
  const det = A[0] * B[1] - B[0] * A[1];
  if (!det) return [530, 331.5];
  return [(-A[2] * B[1] + B[2] * A[1]) / det + 530,
          (-A[0] * B[2] + B[0] * A[2]) / det + 331.5];
};

/* ── navigation ─────────────────────────────────────────── */
let at = 0;
let hop;                // pending auto-advance, cancelled by any other navigation
const onShow = [];      // fns notified with the screen name on every change

function show(i) {
  clearTimeout(hop);
  at = Math.max(0, Math.min(screens.length - 1, i));
  screens.forEach((s, n) => s.classList.toggle('is-active', n === at));

  const cur  = screens[at];
  const step = cur.dataset.step;          // undefined on pack / watch
  const bar  = cur.dataset.appbar;        // 'back' | 'both' | undefined

  // Main workout is the last step, so there is nothing to skip to
  const last = step !== undefined && +step === steps.length - 1;
  appbar.classList.toggle('is-on', !!bar);
  appbar.dataset.back = bar ? 'on' : 'off';
  appbar.dataset.skip = bar === 'both' && !last ? 'on' : 'off';
  appbar.dataset.pos  = bar === 'back' ? 'right' : 'wide';

  flowbar.classList.toggle('is-on', step !== undefined);
  if (step !== undefined) {
    const n = +step;
    steps.forEach((li, k) => li.classList.toggle('is-now', k === n));
    flowbar.querySelector('#btnNext').firstChild.nodeValue =
      n === steps.length - 1 ? 'Done ' : 'Next ';
  }

  cur.querySelector('.watch-scroll')?.scrollTo(0, 0);
  replay(cur);
  if (typeof refreshNext === 'function') refreshNext();
  onShow.forEach(fn => fn(order[at]));
  location.hash = order[at];
}

/* restart the staggered entrance — the animation only fires once per element
   otherwise, so strip and re-add it on every screen change. */
function replay(el) {
  // .packcard is in here because the deck deals its cards one by one and carries no data-anim
  el.querySelectorAll('[data-anim], .packcard, .tbar, .bar').forEach(n => {
    n.style.animation = 'none';
    void n.offsetWidth;                   // force reflow
    n.style.animation = '';
  });
}

const go = d => show(at + d);

document.getElementById('btnNext').onclick = () => go(1);
document.getElementById('btnBack').onclick = () => go(-1);
document.getElementById('btnSkip').onclick = () => go(1);
document.querySelectorAll('[data-go]').forEach(b => {
  b.onclick = () => show(order.indexOf(b.dataset.go));
});

addEventListener('hashchange', () => {
  const i = order.indexOf(location.hash.slice(1));
  if (i > -1 && i !== at) show(i);
});

addEventListener('keydown', e => {
  if (e.key === 'ArrowRight') go(1);
  if (e.key === 'ArrowLeft')  go(-1);
});

/* ── selection groups ───────────────────────────────────── */
const onSelect = [];

/* Same toggle semantics as the Newton app: tap to select, tap again to clear — a
   single-select group behaves like a radio but the active one can still be turned off. */
document.querySelectorAll('[data-select]').forEach(group => {
  const multi = group.dataset.select === 'multi';
  group.querySelectorAll('.opt').forEach(opt => {
    opt.onclick = () => {
      const on = !opt.classList.contains('is-on');
      if (multi) {
        // a [data-exclusive] option (e.g. "None") clears the rest, and vice versa
        if (opt.hasAttribute('data-exclusive') && on) {
          group.querySelectorAll('.opt').forEach(o => o.classList.remove('is-on'));
        } else if (on) {
          group.querySelectorAll('.opt[data-exclusive]').forEach(o => o.classList.remove('is-on'));
        }
      } else if (on) {
        group.querySelectorAll('.opt').forEach(o => o.classList.remove('is-on'));
      }
      opt.classList.toggle('is-on', on);
      onSelect.forEach(fn => fn());
    };
  });
});

/* Next reads Neutral/500 until every group on the step has an answer, then goes white. */
const btnNext = document.getElementById('btnNext');
const refreshNext = () => {
  const cur = screens[at];
  const groups = cur.querySelectorAll('[data-select]');
  btnNext.classList.toggle('is-ready', !groups.length || [...groups].every(g => g.querySelector('.is-on')));
};
onSelect.push(refreshNext);

/* Answering every group on a step IS the answer — Next does not need pressing. Hung off
   onSelect and not off refreshNext, which also runs on entry: coming back to a step that is
   already filled in would otherwise bounce straight forward again. The delay is so the
   selection is seen before the screen goes. */
onSelect.push(() => {
  const cur = screens[at];
  const groups = [...cur.querySelectorAll('[data-select]')];
  clearTimeout(hop);
  if (!groups.length || at >= screens.length - 1) return;
  if (!groups.every(g => g.querySelector('.is-on'))) return;
  hop = setTimeout(() => { if (screens[at] === cur) go(1); }, 900);
});

/* ── injury check: keyed silhouette + body-region hotspots ───────────────
   Normalised to the silhouette box. Taken from the Newton app's own body map for
   this same clip (312×554 there), so the two stay in step — nudge here if the clip
   is re-shot; nothing else depends on the numbers. */
const PARTS = [
  { id: 'left-arm',   x:  85 / 312, y: 170 / 554 },
  { id: 'right-arm',  x: 172 / 312, y: 135 / 554 },
  { id: 'lower-back', x: 183 / 312, y: 233 / 554 },
  { id: 'knee',       x: 155 / 312, y: 345 / 554 },
  { id: 'calf',       x: 170 / 312, y: 415 / 554 },
  { id: 'ankle',      x: 160 / 312, y: 465 / 554 },
];

const hits = document.getElementById('figureHits');
const chipFor = id => document.querySelector(`.chip[data-part="${id}"]`);

PARTS.forEach(p => {
  const b = document.createElement('button');
  b.className = 'hit';
  b.dataset.part = p.id;
  b.style.left = `${p.x * 100}%`;
  b.style.top = `${p.y * 100}%`;
  b.setAttribute('aria-label', chipFor(p.id).textContent);
  b.innerHTML = '<span class="hit-marker"></span>';
  b.onclick = () => chipFor(p.id).click();
  hits.append(b);
});

/* the detail frame fades its content into its own top edge, but only once there is something
   above the fold to fade — see .watch-scroll.is-scrolled */
{
  const sc = document.querySelector('.watch-scroll');
  const mark = () => sc.classList.toggle('is-scrolled', sc.scrollTop > 2);
  sc.addEventListener('scroll', mark);
  onShow.push(mark);                       // show() rewinds it to the top on the way in
}

const syncMarkers = () => hits.querySelectorAll('.hit').forEach(h =>
  h.classList.toggle('is-on', chipFor(h.dataset.part).classList.contains('is-on')));
onSelect.push(syncMarkers);

/* The clip is an orange silhouette on a white matte. Turn the matte into alpha so
   the figure survives any projection background the colour panel dials in. */
{
  const video = document.querySelector('.figure-src');
  const canvas = document.querySelector('.figure-body');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const { width: W, height: H } = canvas;
  const FLOOR = 18, GAMMA = 0.55;   // tune: FLOOR = how much off-white is background

  /* The clip loops, and the last frame is nowhere near the first, so the wrap landed as a cut.
     The opening frame is kept aside and mixed back in over the last stretch — the figure
     dissolves into its own start instead of snapping there. */
  const TAIL = 0.9;
  const head = document.createElement('canvas');
  head.width = W; head.height = H;
  const hctx = head.getContext('2d');
  let got = false;

  let looping = false, nudge = 0;
  const key = () => {
    // self-heal: a spell with the tab hidden leaves the clip paused, and nothing else here
    // would ever start it again. Checked a few times a second, not every frame.
    if (video.paused && ++nudge % 20 === 0) video.play().catch(() => {});
    if (video.readyState >= 2) {
      const d = video.duration || 0;
      // 0 at the start of the tail, 1 at the wrap — how much of the opening frame is showing
      const mix = d && video.currentTime > d - TAIL
        ? Math.min(1, (video.currentTime - (d - TAIL)) / TAIL) : 0;

      ctx.drawImage(video, 0, 0, W, H);
      const img = ctx.getImageData(0, 0, W, H);
      const p = img.data;
      for (let i = 0; i < p.length; i += 4) {
        // luminance key: the matte is off-white (~#f4f4f4) and compression adds noise,
        // so anything within FLOOR of white drops out and the rest is curved up so the
        // pale head and arms stay readable. Colours are left alone — the clip already
        // carries the gradient the design wants.
        const v = (255 - Math.min(p[i], p[i + 1], p[i + 2]) - FLOOR) / (255 - FLOOR);
        p[i + 3] = v <= 0 ? 0 : Math.min(255, 255 * Math.pow(v, GAMMA)) * (1 - mix);
      }
      ctx.putImageData(img, 0, 0);

      // the keyed opening frame, taken once the clip is actually at its start
      if (!got && video.currentTime < 0.2) {
        hctx.clearRect(0, 0, W, H);
        hctx.drawImage(canvas, 0, 0);
        got = true;
      }
      if (mix && got) {
        ctx.globalAlpha = mix;
        ctx.drawImage(head, 0, 0);
        ctx.globalAlpha = 1;
      }
    }
    requestAnimationFrame(key);
  };

  /* rAF, not requestVideoFrameCallback. rVFC only fires while the video decodes, so a paused
     tab killed the loop for good and the canvas was left blank — which is why the figure went
     missing after a while of changing modes. rAF sleeps and wakes with the page, and start()
     gets the clip playing again on every way back in. */
  const start = () => {
    video.play().catch(() => {});
    if (!looping) { looping = true; requestAnimationFrame(key); }
  };
  video.addEventListener('loadeddata', start);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) start(); });
  onShow.push(name => { if (name === 'injury') start(); });
}

/* ── Main workout ────────────────────────────────────────────────────────
   Same principle as the Newton app's setup-main: the pack's stretch and learn
   minutes are fixed, the third bar is whatever the user sets, and the three bar
   widths stay proportional to each other. The run bar reads "You Can Choose"
   until the stepper is actually touched. Entering the step, the bars collapse to
   the number and grow back out while the total counts up. */
const rounds   = document.getElementById('rounds');
const totalMin = document.getElementById('totalMin');
const STRETCH = 5, LEARN = 7;             // the pack's fixed minutes (node 143:7373)
const WORK = 3, REST = 1;                 // "3m Work · 1m Rest" — rests sit between rounds
const MAX_ROUNDS = 20;
const TIGHT = 96;                         // below this a bar can't hold its label

const runRow = document.querySelector('.tbar--run');
const runLabel = document.getElementById('runLabel');
const strike = document.getElementById('strike');
const graphEl = document.querySelector('.total-bars');
let strikeMin = 0;                        // 0 until Set up is touched

const strikeFor = r => r * WORK + (r - 1) * REST;   // 6 rounds → 6×3 + 5×1 = 23m
const total = () => STRETCH + LEARN + strikeMin;

/* Until Set up is touched the graph keeps the design's 105 / 210 / full rows. Once a
   Strike time exists all three go proportional to their minutes, so the top two shrink
   as the Strike chip grows (node 205:10083). */
function layoutBars() {
  const full = graphEl.clientWidth;
  const set = strikeMin > 0;
  const px = m => Math.round(m / total() * full);
  const widths = set ? [px(STRETCH), px(LEARN), px(strikeMin)] : [105, 210, 74];

  [['.tbar--stretch', 0], ['.tbar--learn', 1]].forEach(([sel, i]) => {
    const el = document.querySelector(sel);
    el.style.width = widths[i] + 'px';
    el.classList.toggle('is-tight', widths[i] < TIGHT);
  });
  strike.style.width = Math.max(74, widths[2]) + 'px';
  if (set) countTo(runLabel, strikeMin, v => `${v}m`);
  else runLabel.textContent = '';
}

/* Numbers roll to their new value instead of snapping — the total jumps 4 minutes per
   round, so the tween is what makes the change readable. */
const tweens = new WeakMap();
let SNAP = matchMedia('(prefers-reduced-motion: reduce)').matches;
function countTo(el, to, fmt = String, ms = 450) {
  const from = parseFloat(el.textContent) || 0;
  cancelAnimationFrame(tweens.get(el));
  // no rAF while the tab is hidden, so there is nothing to animate — jump to the value
  if (from === to || SNAP || document.hidden) { el.textContent = fmt(to); return; }
  el.dataset.tweenTo = fmt(to);
  let start = null;
  const step = ts => {
    if (start === null) start = ts;
    const p = Math.min((ts - start) / ms, 1);
    el.textContent = fmt(Math.round(from + (to - from) * (1 - (1 - p) ** 3)));
    if (p < 1) tweens.set(el, requestAnimationFrame(step));
    else delete el.dataset.tweenTo;
  };
  tweens.set(el, requestAnimationFrame(step));
}

/* a hidden tab (or a blanked projector) stops rAF, which would strand a half-counted
   number on screen — land any pending tween on its target instead */
addEventListener('visibilitychange', () => {
  if (!document.hidden) return;
  document.querySelectorAll('[data-tween-to]').forEach(el => {
    el.textContent = el.dataset.tweenTo;
    delete el.dataset.tweenTo;
  });
});

/* Entering the step, the total counts up from zero to its current value. */
function countTotal() {
  totalMin.textContent = '0';
  countTo(totalMin, total(), String, 700);
}
onShow.push(name => { if (name === 'main') { layoutBars(); countTotal(); } });

/* the round count lives here, not in the DOM — mid-tween textContent is an in-between
   number and reading it back would drop clicks */
let roundCount = +rounds.textContent;
document.querySelectorAll('[data-step-delta]').forEach(btn => {
  btn.onclick = () => {
    const next = Math.max(1, Math.min(MAX_ROUNDS, roundCount + +btn.dataset.stepDelta));
    if (next === roundCount && strikeMin) return;
    roundCount = next;
    countTo(rounds, next, String, 420);   // long enough that a quick second tap flows into it
    strikeMin = strikeFor(next);
    layoutBars();
    countTo(totalMin, total());   // the count is the whole animation — no scale pop
  };
});

/* ── pack suggestion carousel ────────────────────────────────────────────
   All five cards are clones of the one #packTpl component, so they can't drift apart.
   Swipe (drag or a trackpad's horizontal wheel) or tap a side card to bring it to the
   middle. Images are placeholders already in the repo; `pos` is the crop each one needs
   so the wide thumb box never cuts a head off. */
{
  /* by: who made it. Only the pack that opens is Casey's — the rest are other creators, or the
     deck reads as one person's five packs. The three landscape thumbs are already the 1.8:1 the
     box is, so they need no crop of their own. */
  const PACKS = [
    { img: 'more-shadow.png',   title: 'Your First Shadowboxing Flow', kind: 'Creator Pack', len: '23m', pos: '50% 22%', by: ['Devon', 'avatar-devon.jpg'] },
    { img: 'more-footwork.png', title: 'Footwork for Small Spaces',    kind: 'Creator Pack', len: '15m', pos: '50% 50%', by: ['Sena',  'avatar-sena.jpg'] },
    { img: 'pack-thumb.png',    title: 'Bring the Ring Home',          kind: 'Creator Pack', len: '7m',  pos: '50% 10%', by: ['Casey', 'avatar-laan.png'], hot: true, go: 'watch' },
    { img: 'rel-boxer.png',     title: 'The Boxer’s Steps',            kind: 'Pro Pack',     len: '12m', pos: '50% 50%', by: ['Mara',  'avatar-mara.jpg'] },
    { img: 'more-round.png',    title: 'The First Round',              kind: 'Creator Pack', len: '31m', pos: '50% 50%', by: ['Noel',  'avatar-noel.jpg'] },
  ];
  /* The deck opens on The Boxer's Steps, not on the pack that leads anywhere: the first screen
     is a shelf, and the first touch in the footage is the swipe off it. OPENS is the one with a
     `go`; it sits directly left of home, which is what the footage's left-to-right swipe brings
     in. Move either one and the first touch lands on a card that goes nowhere. */
  const CENTRE = 3;
  const OPENS  = PACKS.findIndex(p => p.go);

  const deck = document.getElementById('deck');
  const tpl  = document.getElementById('packTpl');
  const slots = PACKS.map((p, i) => {
    const slot = tpl.content.firstElementChild.cloneNode(true);
    slot.style.setProperty('--j', i);          // its place in the deal, left to right
    const img = slot.querySelector('.packcard-thumb > img');
    img.src = `assets/${p.img}`;
    img.alt = p.title;
    img.style.setProperty('--pos', p.pos);
    slot.querySelector('.t2').textContent = p.title;
    const [name, face] = p.by;
    slot.querySelector('.packcard-creator span').textContent = name;
    slot.querySelector('.packcard-creator .avatar').src = `assets/${face}`;
    const [kind, len] = slot.querySelectorAll('.meta span');
    kind.textContent = p.kind;
    len.textContent = p.len;
    if (!p.hot) slot.querySelector('.packcard-hot').remove();
    slot.querySelector('.btn').onclick = e => {
      // a side card's button only pulls it in; only the middle one opens its detail screen
      if (i !== at2) { e.stopPropagation(); centre(i); }
      else if (p.go) show(order.indexOf(p.go));
    };
    slot.onclick = () => { if (i !== at2) centre(i); };
    deck.append(slot);
    return slot;
  });

  let at2 = CENTRE;

  /* depth per step away from the middle — translateZ does the shrinking, so the sizes stay
     consistent with the perspective instead of being scaled by hand */
  const STEP = [
    { x:   0, z:    0, ry:  0, o: 1,   b: 0   },
    { x: 300, z: -230, ry: 28, o: .92, b: .8  },
    { x: 470, z: -470, ry: 34, o: 0,   b: 1.6 },
  ];

  function place() {
    slots.forEach((slot, i) => {
      const d = i - at2;
      const s = STEP[Math.min(Math.abs(d), 2)];
      const sign = Math.sign(d);
      slot.style.transform =
        `translateX(${sign * s.x}px) translateZ(${s.z}px) rotateY(${-sign * s.ry}deg)`;
      slot.style.opacity = s.o;
      slot.style.filter = s.b ? `blur(${s.b}px)` : '';
      // 9 / 6 / 3 leaves room for the haze layer to sit at 7, between the middle card and the rest
      slot.style.zIndex = [9, 6, 3][Math.min(Math.abs(d), 2)];
      slot.dataset.d = d;
      if (Math.abs(d) >= 2) slot.dataset.far = ''; else delete slot.dataset.far;
    });
  }
  const centre = i => { at2 = Math.max(0, Math.min(PACKS.length - 1, i)); place(); };
  // auto play rewinds to home, so its first beat is the swipe off it onto the pack that opens
  deckTo = centre;
  deckHome = CENTRE;
  deckOpens = OPENS;
  place();

  /* swipe: one step as soon as the drag passes 44px — committing mid-gesture is the right
     feel for a touch surface, and it doesn't depend on a pointerup ever arriving */
  let x0 = null, dx = 0;
  deck.addEventListener('pointerdown', e => { x0 = e.clientX; dx = 0; });
  deck.addEventListener('pointermove', e => {
    if (x0 === null) return;
    dx = e.clientX - x0;
    if (Math.abs(dx) > 44) { centre(at2 + (dx < 0 ? 1 : -1)); x0 = null; }
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(t =>
    deck.addEventListener(t, () => { x0 = null; }));
  // a drag that ended on a card must not also read as a tap on it
  deck.addEventListener('click', e => { if (Math.abs(dx) > 6) e.stopPropagation(); }, true);

  let wheelLock = 0;
  deck.addEventListener('wheel', e => {
    if (Math.abs(e.deltaX) < Math.abs(e.deltaY) || Math.abs(e.deltaX) < 8) return;
    e.preventDefault();
    if (e.timeStamp - wheelLock < 400) return;
    wheelLock = e.timeStamp;
    centre(at2 + Math.sign(e.deltaX));
  }, { passive: false });

  onShow.push(name => { if (name === 'pack') centre(CENTRE); });
}

/* ── pack detail: still → clip cross-dissolve, then loop for good ───────── */
{
  const hero = document.querySelector('.hero');
  const clip = hero.querySelector('.hero-clip');
  let armed = false;
  onShow.push(name => {
    /* back at the shelf the detail has not been opened yet, so re-arm: a take that loops has
       to open it the same way every time, and the scroll is timed off that dissolve */
    if (name === 'pack') {
      armed = false;
      clip.pause();
      clip.currentTime = 0;
      hero.classList.remove('is-playing');
      return;
    }
    if (name !== 'watch' || armed) return;
    armed = true;
    setTimeout(() => { clip.play().catch(() => {}); hero.classList.add('is-playing'); }, 1000);
  });
}

const onBgChange = [];   // the preview meter listens; the picker fires it on every repaint

/* ── projection background picker ───────────────────────── */
{
  const sv = document.getElementById('sv'), hue = document.getElementById('hue');
  const svDot = document.getElementById('svDot'), hueDot = document.getElementById('hueDot');
  const hex = document.getElementById('pickerHex');
  let h = 0, s = 0, v = 65.098;                              // #A6A6A6, the recording default

  const hsv2hex = (h, s, v) => {
    const f = n => {
      const k = (n + h / 60) % 6;
      return Math.round(255 * (v / 100) * (1 - (s / 100) * Math.max(0, Math.min(k, 4 - k, 1))));
    };
    return '#' + [f(5), f(3), f(1)].map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase();
  };

  const hex2hsv = str => {
    const m = /^#?([\da-f]{6})$/i.exec(str.trim());
    if (!m) return null;
    const n = parseInt(m[1], 16);
    const r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    const mx = Math.max(r, g, b), d = mx - Math.min(r, g, b);
    let hh = 0;
    if (d) hh = mx === r ? 60 * (((g - b) / d) % 6) : mx === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
    return { h: (hh + 360) % 360, s: mx ? (d / mx) * 100 : 0, v: mx * 100 };
  };

  const paint = (typing = false) => {
    const c = hsv2hex(h, s, v);
    stage.style.setProperty('--bg', c);
    document.documentElement.style.setProperty('--bg', c);
    sv.style.setProperty('--h', h);
    svDot.style.left = `${s}%`;
    svDot.style.top = `${100 - v}%`;
    hueDot.style.left = `${(h / 360) * 100}%`;
    if (!typing) hex.value = c;
    onBgChange.forEach(fn => fn());
  };

  // pointer drag on either strip; ratio() clamps so dragging outside still tracks
  const drag = (el, move) => {
    const at = e => {
      const r = el.getBoundingClientRect();
      move(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
           Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)));
      paint();
    };
    el.addEventListener('pointerdown', e => { el.setPointerCapture(e.pointerId); at(e); });
    el.addEventListener('pointermove', e => { if (el.hasPointerCapture(e.pointerId)) at(e); });
  };
  drag(sv, (x, y) => { s = x * 100; v = 100 - y * 100; });
  drag(hue, x => { h = x * 360; });

  hex.oninput = () => {
    const got = hex2hsv(hex.value);
    if (got) { ({ h, s, v } = got); paint(true); }
  };

  document.querySelectorAll('#pickerPresets button').forEach(b => {
    b.style.setProperty('--c', b.dataset.c);
    b.onclick = () => { ({ h, s, v } = hex2hsv(b.dataset.c)); paint(); };
  });

  // the meter reads --bg, so repainting the background has to refresh it
  onBgChange.forEach(fn => fn());

  const panel = document.getElementById('picker');
  document.getElementById('pickerFold').onclick = function () {
    panel.classList.toggle('is-folded');
    this.textContent = panel.classList.contains('is-folded') ? '+' : '–';
  };

  paint();
}

/* ── projection preview: additive light on a desk ─────────────
   The projector adds light, so the frame screen-blends over the desk. The projector is assumed
   bright enough to dominate, which means the desk is the FLOOR, not a ceiling: desk × ambient
   is what "black" looks like, and nothing can come out darker than that. Three knobs, none of
   them knowable from a screenshot — the desk's own colour, how lit the room is, and how much
   the projector puts out. */
{
  const body = document.body;
  const on = document.getElementById('previewOn');
  const ambient = document.getElementById('ambient');
  const real = document.getElementById('realOn');
  const gain = document.getElementById('gain');
  const dose = document.getElementById('dose');

  /* No palette remap. The rule is: keep the designed colour and lower its opacity — hue and
     value stay exactly as drawn, and after the additive composite a lowered alpha lands nearer
     the floor on its own. Recomputing colours per token is what made every inactive tab a
     different hue. The only knobs left are physical: the desk, the room, the projector. */
  const apply = () => {
    // the desk is whatever the panel's picker is set to — there is only one colour here
    const n = parseInt(/([\da-f]{6})/i.exec(getComputedStyle(stage).getPropertyValue('--bg'))[1], 16);
    // real projection view lays the desk down at its own colour instead of desk × ambient
    const a = real.checked ? 1 : +ambient.value / 100;
    const rgb = [0, 1, 2].map(i => Math.round(((n >> (16 - i * 8)) & 255) * a));
    body.style.setProperty('--floor', `rgb(${rgb.join(' ')})`);
    body.style.setProperty('--gain', +gain.value / 100);
    body.style.setProperty('--dose', +dose.value / 100);
    ambientOut.textContent = ambient.value + '%';
    gainOut.textContent = gain.value + '%';
    doseOut.textContent = dose.value + '%';
    const on = body.classList.contains('is-preview');
    // a drop shadow is light being removed, and a projector cannot do that
    if (on) body.style.setProperty('--sel-shadow', '0 0 0 rgba(0,0,0,0)');
    else body.style.removeProperty('--sel-shadow');
    meter(rgb.map(v => v / 255));
  };

  /* No pre-compensation any more. It solved the additive composite backwards so the red came
     back off the desk as drawn — but the composite is no longer additive. The design is laid
     over the surface at --dose with black knocked out, so every colour arrives at the value it
     was drawn in, give or take the dose. Correcting for a lift that no longer happens would
     only push the red the other way. */

  /* Legibility readout. A pair that fails on the monitor fails on the desk too, and the
     projected values are the design screened over the floor — so the numbers say outright
     whether white type survives the background that is currently picked. */
  const out = document.getElementById('contrast');
  const rd = k => {
    const v = getComputedStyle(stage).getPropertyValue(k).trim();
    const n = parseInt(/([\da-f]{6})/i.exec(v)[1], 16);
    return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  };
  const relLum = c => {
    const f = u => u <= 0.03928 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4;
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const ratio = (a, b) => {
    const [x, y] = [relLum(a), relLum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  /* what the surface ends up showing: the design laid over the desk at --dose, as drawn.
     Nothing is knocked out and no channel is remapped — black included. */
  const over = (c, floor) => {
    const d = +document.getElementById('dose').value / 100;
    return c.map((v, i) => v * d + floor[i] * (1 - d));
  };

  function meter(floor) {
    const on = body.classList.contains('is-preview');
    const pairs = [
      ['배경 위 텍스트', rd('--ink'), rd('--bg')],
      ['카드 위 텍스트', rd('--ink-2'), rd('--surface')],
      ['브랜드 / 배경', rd('--brand'), rd('--bg')],
    ];
    out.innerHTML = pairs.map(([name, fg, bg]) => {
      const r = on ? ratio(over(fg, floor), over(bg, floor)) : ratio(fg, bg);
      return `<dt>${name}</dt><dd class="${r < 4.5 ? 'is-bad' : ''}">${r.toFixed(1)}:1</dd>`;
    }).join('');
  }

  /* The preview simulates light landing on the desk. With the footage off there is no desk to
     land on, so the web view is the design as drawn — same flow, same motion, no projection. */
  on.onchange = () => {
    const proj = on.checked && body.classList.contains('is-desk');
    body.classList.toggle('is-preview', proj);
    body.classList.toggle('is-real', real.checked && proj);   // real view lives inside it
    apply();
  };
  on.dispatchEvent(new Event('change'));   // the panel ships checked, so honour it at boot
  onBgChange.push(apply);

  /* Light field: the whole polarity flips for a white desk — lit field, unlit type, dark cards.
     It is a token swap, so it also moves --bg; the picker follows it rather than fighting it. */
  const light = document.getElementById('lightOn');
  light.onchange = () => {
    body.classList.toggle('is-light', light.checked);
    const want = light.checked ? '#E5E6E6' : '#141414';
    const box = document.getElementById('pickerHex');
    box.value = want;
    box.dispatchEvent(new Event('input'));
  };

  real.onchange = () => {
    // the class is what swaps the screen blend for the knockout filter — without it the switch
    // only moved --floor, which the desk footage does not use, so it did nothing at all
    body.classList.toggle('is-real', real.checked);
    if (real.checked && !on.checked) { on.checked = true; on.dispatchEvent(new Event('change')); }
    else apply();
  };

  const unlit = document.getElementById('unlitOn');
  unlit.onchange = () =>
    body.classList.toggle('is-unlit', unlit.checked && body.classList.contains('is-preview'));
  [ambient, gain, dose].forEach(el => el.oninput = apply);
  apply();
}

/* ── desk plate: footage, cut, and the perspective rig ───────────────────
   The frame is projected onto a desk that the camera sees at an angle, so a frame drawn square
   to the screen can never sit on it. The rig is seven knobs that put it there, and they are
   the one thing here worth persisting: alignment takes a minute to find and a refresh restarts
   the flow by design. */
{
  const body = document.body;
  const vid  = document.getElementById('deskVid');
  const seek = document.getElementById('seek');
  const band = document.getElementById('tlBand');
  const play = document.getElementById('play');
  const cutOut = document.getElementById('cutOut');
  const loop = document.getElementById('loopOn');
  const SRC = 'assets/desk-clean.mp4';     // what the timeline above is showing

  /* ── perspective rig ──
     Defaults are the alignment found against desk-cut.mp4 by hand, not a derivation.
     The crop stays at 100%: how much of the shot gets cut is a decision, not a default.
     The numbers are in screen px, so they hold at the window size they were found at — drag
     them back with 드래그 정렬 on any other.
     원근 does nothing at 기울기 0° — a plane square to the camera has no depth to project —
     which is why it read as a dead control before the frame was laid down. */
  const KNOBS = [
    ['rx',    '기울기', -70,   70,   31, 'deg', '°',  'rig'],
    ['ry',    '좌우',   -70,   70,    0, 'deg', '°',  'rig'],
    ['rz',    '회전',   -45,   45,    0, 'deg', '°',  'rig'],
    ['persp', '원근',   200, 4000, 2148, 'px',  'px', 'rig'],
    ['zoom',  '크기',     8,  160,   32, '%',   '%',  'rig'],
    ['tx',    'X',     -900,  900,  -33, 'px',  'px', 'rig'],
    ['ty',    'Y',     -700,  700,   61, 'px',  'px', 'rig'],
    // no crop by default — how much of the shot gets cut is a decision, not a default
    ['vz',    '배율',   100,  400,  100, '%',   '%',  'crop'],
    ['vx',    'X',     -900,  900,    0, 'px',  'px', 'crop'],
    ['vy',    'Y',     -700,  700,    0, 'px',  'px', 'crop'],
  ];
  // rig2: the defaults changed, and a saved rig from before would have hidden them
  const saved = JSON.parse(localStorage.getItem('rig2') || '{}');
  const inputs = {};

  KNOBS.forEach(([k, label, min, max, def, unit, suffix, row]) => {
    const el = document.createElement('label');
    el.innerHTML = `${label}<input type="range" min="${min}" max="${max}" value="${def}"
      aria-label="${label}"><b></b>`;
    const host = document.getElementById(row);
    host.insertBefore(el, row === 'rig' ? document.getElementById('rigReset') : null);
    const r = inputs[k] = el.querySelector('input');
    r.value = saved[k] ?? def;
    r.oninput = () => {
      // set on the canvas, not the frame: the A4 guide is a sibling and reads the same props,
      // which is what keeps it locked to the frame however the rig is dialled
      // % is a ratio in CSS terms, the rest carry their unit through untouched
      canvas.style.setProperty('--' + k, unit === '%' ? r.value / 100 : r.value + unit);
      el.querySelector('b').textContent = r.value + suffix;
      recrop?.();                          // moving the frame moves what the auto crop frames
      localStorage.setItem('rig2', JSON.stringify(
        Object.fromEntries(Object.entries(inputs).map(([n, i]) => [n, +i.value]))));
    };
    r.oninput();
  });
  document.getElementById('rigReset').onclick = () =>
    KNOBS.forEach(([k, , , , def]) => { inputs[k].value = def; inputs[k].oninput(); });

  /* Dragging beats hunting for the right slider when the job is lining two images up. The
     values are plain screen px — translate() is the outermost function in both transforms, so
     it lands in the canvas's own unscaled space. */
  const align = document.getElementById('alignOn');
  align.onchange = () => body.classList.toggle('is-align', align.checked);
  canvas.addEventListener('pointerdown', e => {
    if (!align.checked) return;
    const [kx, ky] = e.shiftKey ? ['vx', 'vy'] : ['tx', 'ty'];   // shift drags the crop
    const x0 = e.clientX, y0 = e.clientY, ax = +inputs[kx].value, ay = +inputs[ky].value;
    canvas.setPointerCapture(e.pointerId);
    const move = ev => {
      inputs[kx].value = ax + ev.clientX - x0; inputs[kx].oninput();
      inputs[ky].value = ay + ev.clientY - y0; inputs[ky].oninput();
    };
    const up = () => {
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
    };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
  });

  const ar = document.getElementById('ar');
  ar.onchange = () => { AR = +ar.value; fit(); };

  const a4 = document.getElementById('a4On');
  a4.onchange = () => body.classList.toggle('is-a4', a4.checked);
  a4.dispatchEvent(new Event('change'));

  /* ── transport ── */
  const mmss = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  let IN = 0, OUT = Infinity, scrubbing = false;

  const drawCut = () => {
    const d = vid.duration || 0;
    const set = IN > 0 || OUT < d;
    band.hidden = !set;
    cutOut.textContent = set ? `컷 ${mmss(IN)} – ${mmss(Math.min(OUT, d))}` : '전체';
    cutOut.classList.toggle('is-set', set);
    if (!set || !d) return;
    band.style.left = (IN / d * 100) + '%';
    band.style.width = ((Math.min(OUT, d) - IN) / d * 100) + '%';
  };

  const meta = () => {
    document.getElementById('tDur').textContent = mmss(vid.duration);
    drawCut();
  };
  vid.addEventListener('loadedmetadata', meta);
  if (vid.readyState >= 1) meta();     // cached: the event fired before this listener existed
  vid.addEventListener('timeupdate', () => {
    // the cut is a playback range, not a destructive edit — leaving it wraps or stops here
    if (vid.currentTime >= OUT) { vid.currentTime = IN; if (!loop.checked) vid.pause(); }
    document.getElementById('tCur').textContent = mmss(vid.currentTime);
    if (!scrubbing && vid.duration) seek.value = vid.currentTime / vid.duration * 1000;
  });
  const icon = () => play.textContent = vid.paused ? '▶' : '❚❚';
  ['play', 'pause'].forEach(e => vid.addEventListener(e, icon));

  play.onclick = () => vid.paused ? vid.play() : vid.pause();
  seek.oninput = () => { scrubbing = true; vid.currentTime = seek.value / 1000 * (vid.duration || 0); };
  seek.onchange = () => scrubbing = false;
  document.getElementById('markIn').onclick  = () => { IN = vid.currentTime; if (OUT <= IN) OUT = Infinity; drawCut(); };
  document.getElementById('markOut').onclick = () => { OUT = vid.currentTime; if (IN >= OUT) IN = 0; drawCut(); };
  document.getElementById('clearCut').onclick = () => { IN = 0; OUT = Infinity; drawCut(); };

  /* Trimming in the browser would mean re-encoding 4K in JS. The cut lives here, the actual
     file gets cut by the one command that already does it losslessly. */
  document.getElementById('copyCut').onclick = e => {
    const cmd = `ffmpeg -ss ${IN.toFixed(2)} -to ${Math.min(OUT, vid.duration).toFixed(2)}`
      + ` -i "${SRC}" -c copy cut.mov`;
    navigator.clipboard.writeText(cmd).then(
      () => { e.target.textContent = '복사됨'; setTimeout(() => e.target.textContent = '컷 내보내기', 1200); },
      () => prompt('복사해서 쓰세요', cmd));
  };

  // the canvas, not the document: fullscreen is for recording, and the panels are not in the shot
  document.getElementById('fullOn').onclick = () => document.fullscreenElement
    ? document.exitFullscreen() : canvas.requestFullscreen();

  /* space plays, unless something focused wants it (a range steps, a button clicks) */
  addEventListener('keydown', e => {
    if (e.code === 'Space' && !/INPUT|BUTTON|TEXTAREA/.test(document.activeElement.tagName)) {
      e.preventDefault(); play.click();
    }
  });

  /* Off is the web view: the design flat, no plate, no projection look. Auto play still runs —
     the clip keeps playing as the clock so the walkthrough lands on the same seconds it does
     over the footage, which is the whole point of recording this to composite onto it. */
  const deskOn = document.getElementById('deskOn');
  deskOn.onchange = () => {
    body.classList.toggle('is-desk', deskOn.checked);
    if (!deskOn.checked && !document.getElementById('autoOn').checked) vid.pause();
    document.getElementById('previewOn').dispatchEvent(new Event('change'));
    document.getElementById('unlitOn').dispatchEvent(new Event('change'));
    recrop?.();
    fit();
  };
  deskOn.dispatchEvent(new Event('change'));

  const foldBar = document.getElementById('deskbar');
  document.getElementById('deskFold').onclick = e => {
    foldBar.classList.toggle('is-folded');
    e.target.textContent = foldBar.classList.contains('is-folded') ? '+' : '–';
    fit();                                   // folding the panel gives the shot its space back
  };
}

/* ── boot ───────────────────────────────────────────────────
   Refresh always restarts the flow from the first screen, so the whole thing can be walked
   through from the top again. The hash still tracks where you are, but it is not what boot
   reads — navigation-timing's reload/navigate distinction turned out not to be dependable.
   To open one screen directly, use ?at=level. The dev live reload keeps its own screen. */
{
  const kept = sessionStorage.getItem('keep-screen');
  sessionStorage.removeItem('keep-screen');
  const want = kept || new URLSearchParams(location.search).get('at');
  show(Math.max(0, order.indexOf(want)));
}

/* ── 종이 뷰: ?look=paper ────────────────────────────────────
   합성용 룩. 책상 영상을 끄고 단색 투사면 위에 UI만 남긴다 — 나머지 값은 style.css 의
   body.is-paper 에 있다. 익스포터가 이 URL 을 연다. */
if (new URLSearchParams(location.search).get('look') === 'paper') {
  const PAPER = '#B3BCCA';                   // 투사면 = 책상 색. 책상이 바뀌면 여기만 바꾼다
  document.body.classList.add('is-paper');
  const desk = document.getElementById('deskOn');
  desk.checked = false;
  desk.dispatchEvent(new Event('change'));   // 프리뷰·핸드 레이어까지 같이 내린다
  /* 배경색은 피커를 통해 넣는다. paint() 가 --bg 를 .stage 에 인라인으로 쓰는데, 인라인은
     상속값이 아무리 중요해도 못 이긴다 — CSS 에 값을 두면 조용히 무시당한다. */
  const hex = document.getElementById('pickerHex');
  hex.value = PAPER;
  hex.dispatchEvent(new Event('input'));
}

/* ── prototyping cursor & touch ripples ──────────────────────────────────
   Recording aid, not part of the projected UI. The disc chases the pointer on its own frame
   loop with exponential smoothing, so what gets recorded is a gliding cursor rather than the
   pointer's raw jitter. Everything is placed in design units, so client pixels go through
   unproject() — which also keeps the disc under the pointer once the frame is tilted. */
{
  const dot = document.getElementById('cursor');
  const taps = document.getElementById('taps');
  const EASE = 0.16;                 // per-frame approach; lower is smoother and laggier
  let tx = 0, ty = 0, x = 0, y = 0, live = false;

  const toStage = e => unproject(e.clientX, e.clientY);

  stage.addEventListener('pointermove', e => {
    [tx, ty] = toStage(e);
    if (!live) { x = tx; y = ty; live = true; dot.classList.add('is-in'); }
  });
  stage.addEventListener('pointerleave', () => { live = false; dot.classList.remove('is-in'); });
  tapAt = (px, py) => {
    const ring = document.createElement('span');
    ring.className = 'tap';
    ring.style.left = px + 'px';
    ring.style.top = py + 'px';
    taps.append(ring);
    ring.addEventListener('animationend', () => ring.remove());
  };
  // auto play drives the same disc the pointer does, so a recording cannot tell them apart
  aim = (px, py) => { [tx, ty] = [px, py]; live = true; dot.classList.add('is-in'); };
  cursorShow = on => dot.classList.toggle('is-in', on);
  press = (px, py) => {
    aim(px, py);
    tapAt(px, py);
    dot.classList.add('is-press');                 // tightens onto the point, then lets go
    setTimeout(() => dot.classList.remove('is-press'), 200);
  };
  trailTo = (x0, y0, x1, y1) => {
    const s = document.createElement('span');
    s.className = 'trail';
    s.style.left = x0 + 'px';
    s.style.top = y0 + 'px';
    s.style.width = Math.hypot(x1 - x0, y1 - y0) + 'px';
    s.style.transform = `rotate(${Math.atan2(y1 - y0, x1 - x0)}rad)`;
    taps.append(s);
    s.addEventListener('animationend', () => s.remove());
  };

  stage.addEventListener('pointerdown', e => {
    dot.classList.add('is-down');
    tapAt(...toStage(e));
  });
  addEventListener('pointerup', () => dot.classList.remove('is-down'));

  (function follow() {
    x += (tx - x) * EASE;
    y += (ty - y) * EASE;
    dot.style.transform = `translate(${x}px,${y}px)`;
    requestAnimationFrame(follow);
  })();
}

/* ── auto play: the footage drives the UI ────────────────────────────────
   The cut keeps eleven stretches and the person reaches for the desk once in each. Those are
   the beats. The times are measured, not eyeballed: the fingertip is tracked through the
   assembled clip (skin is the only warm thing against a cool desk, so R−B keys it), and the
   beat sits in the middle of the hold at the deepest reach — the moment the finger is down.

   The order is the flow: the carousel is the first view and the first touch swipes it, then
   the pack opens, the detail scrolls, Start goes. What each reach MEANS is authored, not
   recognised: the clip was shot on a bare desk with no UI to touch, and every reach reads the
   same way in the footage — come in, hold, withdraw. Rebuild desk-cut.mp4 and these move. */
{
  const auto = document.getElementById('autoOn');
  const vid = document.getElementById('deskVid');
  const BEATS = [
    // from: where the disc starts, relative to where it lands — a swipe, not a tap.
    // The hand crosses left to right here, so the deck travels right and the card that was on
    // the left is the one that arrives. Tracked, not assumed: hand.json opens at x .16 → .54.
    /* wait: how long the touch is held before the UI answers. ms: how long the move takes.
       The two drags start when the finger starts moving, not when it stops — the tracked tip
       crosses from x .15 to .49 between 0.8s and 1.5s, and rises from y 1.00 to .61 between
       12.6s and 13.3s. Both are ~0.7s, which is what the UI is given. */
    /* gap: the take's own pause before this beat, in ms. The footage's pauses are the person's
       — reaching in, settling, withdrawing — and none of that happens in a screen recording,
       so the take keeps the order and the targets and sets its own pace. */
    { t:  0.9, at: 'pack',      hit: '.slot[data-d="-1"]', from: [-300, 0], wait: 0, gap: 1500 },
    { t:  9.1, at: 'pack',      hit: '.slot[data-d="0"] .btn--primary', wait: 480, gap: 1500 },
    // the hero still dissolves into its clip 1s after the detail opens; the scroll waits out
    // that first second and then a beat and a half of the clip actually running
    { t: 12.7, at: 'watch',     scroll: 430, aim: [740, 400], from: [0, -150], wait: 0, ms: 700, gap: 2600 },
    // the finger lands at 18.2 and holds to 19.3, so the press is seen well before the screen goes
    { t: 18.3, at: 'watch',     hit: '[data-go="location"]', wait: 600, gap: 1800 },
    // g/o index the step's own groups, which survives markup edits that a selector would not
    { t: 23.0, at: 'location',  g: 0, o: 0, gap: 1300 },     // Indoor
    { t: 28.7, at: 'location',  g: 1, o: 1, gap: 1200 },     // Standard
    { t: 34.6, at: 'condition', g: 0, o: 1, gap: 2600 },     // About the Same as Usual
    // the body map runs its own loop on arrival; the take waits for it before answering None
    { t: 40.1, at: 'injury',    g: 0, o: 0, gap: 3800 },     // None — and no marker on the map
    { t: 46.2, at: 'level',     g: 0, o: 1, gap: 2500 },     // Standard
    { t: 51.2, at: 'level',     g: 1, o: 0, gap: 1200 },     // Quiet On
    // the last stretch is one long touch, so both taps land inside it: 4 → 5 → 6 rounds
    /* two taps inside one hold. Close enough that the number tween and the bars' .5s width
       transition retarget mid-flight, so 4 → 6 is one continuous move rather than two. */
    { t: 58.15, at: 'main',     hit: '.step[data-step-delta="1"]', wait: 200, gap: 1700 },
    { t: 58.50, at: 'main',     hit: '.step[data-step-delta="1"]', wait: 200, gap: 350 },
  ];

  /* design coordinates of an element, for aiming the disc. offsetLeft chains up in design
     units and ignores the frame's transform, which is the whole point; the scroll frame's
     own offset has to come back out. */
  const designPos = el => {
    let x = 0, y = 0, n = el;
    while (n && n !== stage) {
      x += n.offsetLeft; y += n.offsetTop;
      const p = n.offsetParent;
      if (p && p !== stage) { x -= p.scrollLeft; y -= p.scrollTop; }
      n = p;
    }
    return [x + el.offsetWidth / 2, y + el.offsetHeight / 2];
  };

  const fire = (b, live, quiet) => {
    const i = order.indexOf(b.at);
    if (at !== i) show(i);
    const sc = screens[i];
    const scroll = b.scroll !== undefined ? sc.querySelector('.watch-scroll') : null;
    const el = scroll || (b.hit ? sc.querySelector(b.hit)
      : sc.querySelectorAll('[data-select]')[b.g]?.querySelectorAll('.opt')[b.o]);
    if (!el) return;
    /* Chrome's smooth scroll is ~300ms whatever the distance, which outran the finger every
       time. Tweened here over the length of the drag instead. */
    const glide = to => {
      const from = scroll.scrollTop, t0 = performance.now(), ms = b.ms || 900;
      (function step(now) {
        const k = Math.min(1, (now - t0) / ms);
        scroll.scrollTop = from + (to - from) * (1 - (1 - k) ** 3);
        if (k < 1) requestAnimationFrame(step);
      })(t0);
    };
    const act = () => scroll ? (live ? glide(b.scroll) : (scroll.scrollTop = b.scroll))
                             : el.click();
    if (!live) return act();
    /* the take has no finger and shows no disc, so there is nothing for the UI to answer after
       — b.wait exists only to let a press be seen first */
    if (quiet) return act();

    // press where the finger actually is, not where the control is: the disc is riding the
    // tracked tip, and snapping it to the button would be a jump nothing in the shot made
    const [x, y] = tipAt(b.t) || b.aim || designPos(el);
    // the line the finger came along — or, with no finger to track, the offset the beat names
    if (b.from) {
      const [x0, y0] = tipAt(b.t - LEAD) || [x + b.from[0], y + b.from[1]];
      trailTo?.(x0, y0, x, y);
    }
    press?.(x, y);
    // the press has to be seen before the screen answers it, or the UI arrives ahead of the
    // hand and the two read as unrelated. b.wait is how long the touch is held first.
    setTimeout(act, b.wait ?? 380);
  };

  /* The disc rides the real fingertip. hand.json is that tip tracked through the cut at 10fps
     in thousandths of the plate, null where no hand is in shot — so when the hand leaves, the
     disc is simply not shown and fades on its own. A beat borrows it for the length of the
     press and hands it straight back. */
  let hand = null;
  fetch('assets/hand.json').then(r => r.json()).then(d => hand = d).catch(() => {});

  /* plate pixel → design px. The video element carries the crop and the shot transform, so its
     client box already has both; object-fit:cover then covers that box with the plate. */
  const plateToDesign = (u, v) => {
    const r = vid.getBoundingClientRect();
    const s = Math.max(r.width / 1920, r.height / 1012);
    return unproject(r.left + r.width / 2 + (u - 960) * s,
                     r.top + r.height / 2 + (v - 506) * s);
  };
  /* the tracked fingertip at a moment, in design coordinates, or null when no hand is in shot.
     Null in the web view too: the tip is a position in the plate, and where that falls on the
     frame is the rig's answer. Flat and unrigged there is no such point, so beats aim at the
     control they press instead. */
  const tipAt = t => {
    if (!document.body.classList.contains('is-desk')) return null;
    const p = hand?.[Math.round(t * 10)];
    return p && plateToDesign(p[0] / 1000 * 1920, p[1] / 1000 * 1012);
  };

  /* The disc is a touch mark, not a mouse pointer: it belongs on screen while the finger is on
     the desk and nowhere else. Showing it whenever a hand was in frame meant it rode the hand
     back out of shot every time, which is the one thing a touch mark never does. */
  const LEAD = 0.55, HOLD = 0.45;
  (function follow() {
    requestAnimationFrame(follow);
    if (!auto.checked) return;
    const t = vid.currentTime;
    const desk = document.body.classList.contains('is-desk');
    // with the footage on, the disc rides the tip for the whole reach — approach included. In
    // the web view there is nothing to approach with, so the beat drops it on the control it
    // presses and the loop only takes it away again afterwards.
    const live = BEATS.some(b => t > b.t - (desk ? LEAD : 0) && t < b.t + HOLD);
    if (desk) {
      const p = live && tipAt(t);
      return p ? aim?.(...p) : cursorShow?.(false);
    }
    if (!live) cursorShow?.(false);
  })();

  /* Auto play frames the projection, not the room: push the shot in until the frame's own
     projected box fills FILL of the canvas, and put its centre in the middle. Measured off the
     frame's matrix rather than its bounding rect, which is the shot transform's own output. */
  const FILL = 0.74;
  recrop = () => {
    // nothing to reframe in the web view — the frame is the shot there, and --s already fits it
    if (!auto.checked || !document.body.classList.contains('is-desk')) {
      ['--k', '--kx', '--ky'].forEach(p => shot.style.removeProperty(p));
      return;
    }
    const m = new DOMMatrix(getComputedStyle(stage).transform);
    const pts = [[0, 0], [1060, 0], [1060, 663], [0, 663]].map(([x, y]) => {
      const p = m.transformPoint(new DOMPoint(x - 530, y - 331.5, 0, 1));
      return [p.x / p.w, p.y / p.w];
    });
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const r = canvas.getBoundingClientRect();
    const z = Math.min(r.width * FILL / (x1 - x0), r.height * FILL / (y1 - y0));
    shot.style.setProperty('--k', z);
    shot.style.setProperty('--kx', -(x0 + x1) / 2 * z + 'px');
    shot.style.setProperty('--ky', -(y0 + y1) / 2 * z + 'px');
  };

  let k = 0;
  const rewind = () => {
    document.querySelectorAll('.stage .opt.is-on').forEach(o => o.classList.remove('is-on'));
    onSelect.forEach(fn => fn());
    clearTimeout(hop);
    /* The stepper is not a selection, so clearing is-on leaves it where the last pass put it
       and the round count climbs every loop. Its own button does the recompute — but the
       readout is tweened, so the count of clicks has to come from the tween's target and not
       from re-reading the text, which lags and drove it all the way to the floor. */
    const minus = document.querySelector('.step[data-step-delta="-1"]');
    for (let n = +(rounds.dataset.tweenTo ?? rounds.textContent); n > 4; n--) minus.click();
    /* the take opens on the first screen sliding in, so the entrance has to replay even when
       that screen is already the one showing — and a class it already carries, toggled to the
       value it already has, animates nothing. Off, settle the layout, back on. */
    screens[0].classList.remove('is-active');
    void screens[0].offsetWidth;
    show(0);
    // the deck's own home, which sits one card right of the pack that opens — so the swipe
    // brings that pack in from the left the way the hand moves. Goes after show(), because
    // entering the pack screen re-centres the deck.
    deckTo?.(deckHome);
    k = 0;
  };

  const tick = () => {
    if (!auto.checked) return;
    const n = BEATS.filter(b => b.t <= vid.currentTime).length;
    if (n < k) { rewind(); BEATS.slice(0, n).forEach(b => fire(b, false)); k = n; return; }
    while (k < n) fire(BEATS[k++], true);
  };
  vid.addEventListener('timeupdate', tick);
  // the clip is a loop of one walkthrough, so the end of it is the start of the next
  vid.addEventListener('ended', () => {
    if (!auto.checked) return;
    rewind();
    vid.currentTime = 0;
    vid.play().catch(() => {});
  });

  auto.onchange = () => {
    document.body.classList.toggle('is-auto', auto.checked);
    recrop();
    if (!auto.checked) { deckTo?.(deckHome); cursorShow?.(false); return; }
    rewind();
    vid.currentTime = 0;
    vid.play().catch(() => {});
  };
  /* ── the take: 전체화면 plays the flow through, and that is what gets recorded ──────────
     No clip, no clock, no cursor — nothing to press means nothing to show pressing it. Same
     beats in the same order, each after its own gap, so the recording can be laid over footage
     of a real hand later without a second pointer in the shot. Auto play mode keeps the clip
     driving instead: there the disc is riding a tracked fingertip, which is the point of it. */
  let take = 0;                            // bumping it abandons whatever take is in flight
  const nap = ms => new Promise(r => setTimeout(r, ms));

  const runTake = async () => {
    const mine = ++take;
    document.body.classList.add('is-take');
    cursorShow?.(false);
    await nap(500);              // let the window finish resizing before the first screen enters
    if (mine !== take) return;
    do {
      rewind();
      for (const b of BEATS) {
        await nap(b.gap ?? 1200);
        if (mine !== take) return;
        fire(b, true, true);
      }
      await nap(2600);                     // hold on the finished screen, then go again
    } while (mine === take);
  };

  // bumping the token is the stop: the loop checks it after every pause and gives up on itself
  const stopTake = () => { take++; document.body.classList.remove('is-take'); };

  /* Fullscreen only arms it. Going fullscreen and having the flow leave under you is the wrong
     way round — the recording starts when the recorder says so, which is what the margin
     controls are for. Leaving fullscreen abandons whatever take is running. */
  addEventListener('fullscreenchange', () => {
    const full = document.fullscreenElement === canvas;
    document.body.classList.toggle('is-full', full);
    if (!full) stopTake();
  });
  // ▶ and ↺ are the same instruction — runTake rewinds first, and starting a second one
  // abandons the first by taking the token off it
  const again = () => { if (!auto.checked) runTake(); };
  document.getElementById('takeStart').onclick = again;
  document.getElementById('takeAgain').onclick = again;
  document.getElementById('takeStop').onclick = stopTake;

  window.__beats = BEATS;                  // the selftest walks these without the clip
  window.__take = runTake;
}

/* ── the hand on top ─────────────────────────────────────────────────────
   The projector is above the desk and the hand is between them, so the hand covers what is
   projected. Without that the frame paints over the arm and the shot reads as two things
   stacked. It is the same clip keyed to its skin (VP9 carries the alpha h.264 cannot), laid
   over the frame in the same box, so the two register pixel for pixel.

   Two elements decoding the same edit is the price: they are started and seeked together and
   pulled back into line whenever they drift, which is cheaper than compositing per frame. */
{
  const body = document.body;
  const vid = document.getElementById('deskVid');
  const hv = document.getElementById('handVid');
  const box = document.getElementById('handOn');

  /* 0.04s is one frame at 25fps. It used to be two, and two frames of drift with a hand in
     motion showed as a second hand — the plate carried its own copy underneath. The plate is
     hand-free now, so drift only moves the one hand slightly; the tolerance is tight anyway. */
  const sync = () => {
    // in the web view the clip is only a clock; there is no plate for the hand to sit on
    if (!box.checked || !body.classList.contains('is-desk')) return hv.pause();
    if (Math.abs(hv.currentTime - vid.currentTime) > 0.04) hv.currentTime = vid.currentTime;
    if (vid.paused !== hv.paused) vid.paused ? hv.pause() : hv.play().catch(() => {});
  };
  ['timeupdate', 'seeked', 'play', 'pause'].forEach(e => vid.addEventListener(e, sync));

  box.onchange = () => {
    body.classList.toggle('is-hand', box.checked);
    if (box.checked) sync(); else hv.pause();      // no reason to decode what is not shown
  };
  box.dispatchEvent(new Event('change'));
}

/* ── self-check: open index.html?selftest and watch the console ──────────
   Covers the two bits with real branching — exclusive multi-select and the
   stepper clamp. Everything else is markup. */
if (location.search.includes('selftest')) (async () => {   // async: one assert waits on a timer
  SNAP = true;                              // assert the numbers, not their tween
  const results = window.__selftest = [];   // also readable from devtools / automation
  const ok = (name, cond) => {
    results.push(`${cond ? 'PASS' : 'FAIL'} — ${name}`);
    console[cond ? 'log' : 'error'](results.at(-1));
  };
  const chips = [...document.querySelectorAll('.chips .opt')];
  const on = () => chips.filter(c => c.classList.contains('is-on')).length;
  const marker = id => document.querySelector(`.hit[data-part="${id}"]`).classList.contains('is-on');

  chips.forEach(c => c.classList.remove('is-on'));
  chips[3].click(); chips[5].click();
  ok('multi-select keeps both', on() === 2);
  ok('marker follows chip', marker('knee') && marker('left-arm'));
  chips[0].click();
  ok('"None" clears the rest', on() === 1 && chips[0].classList.contains('is-on'));
  ok('markers cleared by "None"', !marker('knee'));
  document.querySelector('.hit[data-part="calf"]').click();
  ok('hotspot selects its chip', chips[4].classList.contains('is-on') && on() === 1);
  chips[1].click();
  ok('a body part clears "None"', on() === 2);

  const seg = document.querySelectorAll('.segrow .opt');
  seg[0].click();
  ok('single-select is radio', seg[0].classList.contains('is-on') && !seg[1].classList.contains('is-on'));
  seg[0].click();
  ok('tapping the active one clears it', !seg[0].classList.contains('is-on'));
  ok('cards default to unselected', !document.querySelector('.card.is-on'));

  {   // Assist Mode takes several modes at once
    const assists = [...document.querySelectorAll('.assistrow .opt')];
    assists.forEach(c => c.classList.remove('is-on'));
    assists[0].click(); assists[2].click();
    ok('assist mode keeps more than one', assists.filter(c => c.classList.contains('is-on')).length === 2);
    assists.forEach(c => c.classList.remove('is-on'));
  }

  {   /* Nothing is remapped now. The design is laid over the surface at --dose with black
         knocked out, so a colour arrives at the value it was drawn in — which is the whole
         point of dropping the additive model. The brand token has to come through untouched. */
    const box = document.getElementById('previewOn');
    box.checked = true; box.dispatchEvent(new Event('change'));
    ok('the preview leaves the brand red exactly as drawn',
       document.body.style.getPropertyValue('--brand') === '' &&
       getComputedStyle(stage).getPropertyValue('--brand').trim().toLowerCase() === '#fa3030');
    /* the only filter is opacity by value — black 50%, white 80%. Nothing draws a line on the
       UI, and the frame's own transparent background stays transparent rather than counting
       as a black pixel, which would turn the whole frame into a grey slab. */
    ok('the preview changes opacity only, and leaves the frame background transparent',
       getComputedStyle(stage).mixBlendMode === 'normal' &&
       getComputedStyle(stage).filter.includes('#tone') &&
       document.querySelector('#tone feComposite[operator="in"]'));

    /* real projection view: the desk takes the picked colour flat, with no ambient scaling */
    const realBox = document.getElementById('realOn');
    realBox.checked = true; realBox.dispatchEvent(new Event('change'));
    const hexToRgb = h => { const n = parseInt(/([\da-f]{6})/i.exec(h)[1], 16);
      return `rgb(${n >> 16} ${(n >> 8) & 255} ${n & 255})`; };
    ok('real view lays the picked background down as the desk',
       getComputedStyle(document.body).getPropertyValue('--floor').trim() ===
       hexToRgb(getComputedStyle(stage).getPropertyValue('--bg')));
    ok('and the frame paints no background of its own',
       getComputedStyle(stage).backgroundColor === 'rgba(0, 0, 0, 0)');
    realBox.checked = false; realBox.dispatchEvent(new Event('change'));
    document.getElementById('previewOn').checked = false;
    document.getElementById('previewOn').dispatchEvent(new Event('change'));
  }

  const cards = [...document.querySelectorAll('.deck .slot')];
  ok('carousel is copies of one card component',
     cards.length === 5 && cards.every(c => c.querySelector('.packcard-thumb > img') && c.querySelector('.btn')));
  ok('the deck starts on The Boxer’s Steps',
     cards[deckHome].dataset.d === '0' &&
     cards[deckHome].querySelector('.t2').textContent.startsWith('The Boxer'));
  /* the swipe in the footage goes one card left, so the pack it lands on has to be the one
     directly left of home — otherwise the first touch opens nothing */
  ok('the pack that opens sits one swipe left of it', deckOpens === deckHome - 1);
  ok('every card names its own creator',
     new Set(cards.map(c => c.querySelector('.packcard-creator span').textContent)).size === cards.length);
  // the blur has to land between the side cards and the middle one, or it has nothing to blur
  ok('the deck blur sits under the middle card and over the rest',
     getComputedStyle(document.querySelector('.deck-haze')).zIndex === '7' &&
     cards[deckHome].style.zIndex === '9' && cards[deckHome - 1].style.zIndex === '6');
  cards[1].click();
  ok('tapping a side card centres it', cards[1].dataset.d === '0' && cards[2].dataset.d === '1');
  deckTo(deckHome);

  // recording aids: the system pointer is replaced, taps leave a ring, a swipe leaves a trail
  ok('the frame hides the system cursor', getComputedStyle(stage).cursor === 'none');
  stage.dispatchEvent(new PointerEvent('pointerdown', { clientX: 400, clientY: 300, bubbles: true }));
  ok('a tap spawns a ripple', document.querySelectorAll('.taps .tap').length === 1);
  ok('no selectable control shows a system cursor',
     [...document.querySelectorAll('.card,.chip,.slot,.btn')].every(e => getComputedStyle(e).cursor === 'none'));

  /* Auto play is a table of twelve beats aimed at elements by index. A beat that misses does
     nothing and says nothing, so walk every one of them: each must land on the screen it names
     and find something to press, and the times must be inside the cut and in order. */
  {
    const B = window.__beats;
    ok('every beat names a screen that exists and something to press on it',
       B.every(b => {
         const sc = screens[order.indexOf(b.at)];
         if (!sc) return false;
         if (b.scroll !== undefined) return !!sc.querySelector('.watch-scroll');
         return !!(b.hit ? sc.querySelector(b.hit)
                         : sc.querySelectorAll('[data-select]')[b.g]?.querySelectorAll('.opt')[b.o]);
       }));
    ok('the beats run in order and inside the 62.8s cut',
       B.every((b, i) => (i === 0 || b.t > B[i - 1].t) && b.t > 0 && b.t < 62.8));
    // the carousel is the first view, and the first touch swipes it rather than opening it
    ok('the clip opens on the carousel and the first touch is a swipe',
       B[0].at === 'pack' && !!B[0].from && B[0].hit.includes('.slot'));
    /* The disc travelling one way while the card arrives from the other is exactly the bug
       this had: a drag to the right has to bring in the card that was on the left. */
    ok('the swipe and the card it brings in agree on direction',
       Math.sign(B[0].from[0]) === (B[0].hit.includes('"-1"') ? -1 : 1));
    // the flow only reaches the end if answering a step is enough to leave it
    ok('the beats walk the whole flow to Main workout',
       B.at(-1).at === order.at(-1) && new Set(B.map(b => b.at)).size === order.length);
    // the answers the run has to give, by name rather than by index
    const label = b => screens[order.indexOf(b.at)]
      .querySelectorAll('[data-select]')[b.g].querySelectorAll('.opt')[b.o].textContent.trim();
    ok('the run answers Indoor, Standard and None',
       label(B[4]) === 'Indoor' && label(B[5]).startsWith('Standard') && label(B[7]) === 'None');
    ok('two taps on the stepper, so rounds land on 6',
       B.filter(b => b.hit?.includes('step-delta="1"')).length === 2);
    // the take walks the same beats on its own timer, so a beat without one stalls it
    ok('every beat carries the pause the take waits out before it', B.every(b => b.gap > 0));
    /* 전체화면 is the recording, and a recording of a cursor nobody is moving is a bug in it */
    document.body.classList.add('is-take');
    ok('the take shows no cursor',
       getComputedStyle(document.getElementById('cursor')).display === 'none');
    document.body.classList.remove('is-take');

    /* the controls: fullscreen arms, ▶ starts, ■ stops, ↺ starts over. Going fullscreen and
       having the flow leave without being asked is the thing this replaced. */
    const bar = document.getElementById('takeBar');
    const btn = id => getComputedStyle(document.getElementById(id)).display !== 'none';
    ok('the take controls stay out of the way until fullscreen',
       getComputedStyle(bar).display === 'none');
    document.body.classList.add('is-full');
    ok('fullscreen offers only Start, and starts nothing on its own',
       btn('takeStart') && !btn('takeStop') && !btn('takeAgain') &&
       !document.body.classList.contains('is-take'));
    document.body.classList.add('is-take');
    ok('a running take offers stop and start-over instead',
       !btn('takeStart') && btn('takeStop') && btn('takeAgain'));
    /* invisible, not gone: buttons must not be in a screen recording, and a take that can only
       be stopped by leaving fullscreen is worse than one you have to reach for.
       Read off a copy parked out of the window, because the real one answers :hover — and
       wherever the pointer happens to be resting is not something a test gets to decide. */
    const probe = bar.cloneNode(false);
    probe.style.left = '-9999px';
    canvas.append(probe);
    await new Promise(r => setTimeout(r, 260));       // after the fade, not during it
    ok('and they are invisible while it runs, without being unreachable',
       getComputedStyle(probe).opacity === '0' &&
       getComputedStyle(document.getElementById('takeStop')).pointerEvents !== 'none');
    probe.remove();
    document.body.classList.remove('is-full', 'is-take');
  }
  // selection alone advances the step — Next is there but does not have to be pressed
  {
    show(order.indexOf('condition'));
    const opts = [...screens[at].querySelectorAll('.grid2 .opt')];
    opts.forEach(o => o.classList.remove('is-on'));
    opts[1].click();
    await new Promise(r => setTimeout(r, 1200));
    ok('answering every group leaves the step without pressing Next', order[at] === 'injury');
  }

  // desk plate: the footage has to be inside the shot, or the preview's screen blend
  // composites the frame against nothing and "projection onto the desk" is just an overlay
  ok('the desk footage is the plate the frame blends onto',
     document.getElementById('deskVid').parentElement === shot);
  /* the hand has to be painted after the frame, and in the frame's own box. Behind it, the UI
     paints over the arm and the shot reads as an overlay instead of something photographed. */
  {
    const hv = document.getElementById('handVid');
    ok('the hand is painted over the frame, not under it',
       shot.lastElementChild === hv && hv.previousElementSibling === stage);
    ok('the hand registers with the plate it was keyed from',
       getComputedStyle(hv).transform === getComputedStyle(document.getElementById('deskVid')).transform);
  }
  // the guide is only worth anything if it is locked to the frame — same props, same origin
  {
    // it ships off, and a display:none element does not resolve its transform to a matrix
    const box = document.getElementById('a4On');
    box.checked = true; box.dispatchEvent(new Event('change'));
    const a = document.getElementById('a4'), s = getComputedStyle(a);
    ok('the A4 guide moves with the frame',
       s.transform === getComputedStyle(stage).transform && a.parentElement === shot);
    // GUI fitted to a landscape A4's width: 1060 × 210/297, so it overhangs 43.25 top and bottom
    ok('the A4 guide is the sheet the shot was framed against',
       Math.abs(parseFloat(s.height) - 1060 * 210 / 297) < 0.1 &&
       Math.abs(parseFloat(getComputedStyle(a.firstElementChild).height)
                - (1060 * 210 / 297 - 663) / 2) < 0.1);
    box.checked = false; box.dispatchEvent(new Event('change'));
  }
  // tilted, pointer→design is projective; an affine inverse looks right at the centre and
  // drifts at the corners, which is exactly where the frame's controls are
  {
    canvas.style.setProperty('--rx', '38deg');   // on the canvas, so rigReset can undo it
    canvas.style.setProperty('--rz', '9deg');
    const fwd = (x, y) => {                       // forward projection, via a different path
      // read the box here, not once up front: a scrollbar appearing mid-test moves the centre
      // 7.5px and the round-trip fails on the reference point, not on the maths
      const f = canvas.getBoundingClientRect();
      const p = shotM().multiply(new DOMMatrix(getComputedStyle(stage).transform))
        .transformPoint(new DOMPoint(x - 530, y - 331.5, 0, 1));
      return [p.x / p.w + f.left + f.width / 2, p.y / p.w + f.top + f.height / 2];
    };
    const back = unproject(...fwd(880, 120));
    const off = Math.hypot(back[0] - 880, back[1] - 120);
    ok(`the tilted frame still puts the cursor under the pointer (${off.toFixed(2)}px)`, off < 0.5);
    document.getElementById('rigReset').click();
  }

  show(order.indexOf('level'));
  ok('Next dims while a group is empty', !btnNext.classList.contains('is-ready'));
  seg[1].click();
  document.querySelector('.assist').click();
  ok('Next lights up once answered', btnNext.classList.contains('is-ready'));

  /* the inactive steps are the complaint that started this: they must all be identical, and
     they must stay identical with the preview on — no per-token colour recomputation */
  {
    // opacity is transitioned; read it mid-flight and two steps that agree look like they don't
    await new Promise(r => setTimeout(r, 400));
    const box = document.getElementById('previewOn');
    const inactive = () => steps.filter(li => !li.classList.contains('is-now'))
      .map(li => getComputedStyle(li).color + ' @' + getComputedStyle(li).opacity);
    const flat = a => a.every(v => v === a[0]);
    ok('every inactive step looks the same', flat(inactive()));
    ok('every step is the same colour, current or not',
       flat(steps.map(li => getComputedStyle(li).color)));
    ok('only the current step is bold',
       steps.filter(li => getComputedStyle(li).fontWeight === '700').length === 1);
    box.checked = true; box.dispatchEvent(new Event('change'));
    // inline props are what the preview would have written; tokens must stay on :root untouched
    ok('preview leaves the colour tokens alone', document.body.style.getPropertyValue('--white') === '');
    ok('and the steps still match each other', flat(inactive()));

    // the legibility meter is the thing that answers "will white type survive this background"
    const read = () => [...document.querySelectorAll('#contrast dd')].map(d => parseFloat(d.textContent));
    const hexIn = document.getElementById('pickerHex');
    const setBg = v => { hexIn.value = v; hexIn.dispatchEvent(new Event('input')); };
    setBg('#141414');
    ok('type on the field passes on the dark background', read()[0] >= 4.5);
    setBg('#E5E6E6');
    ok('the same white type fails on a light background', read()[0] < 2);
    document.getElementById('lightOn').checked = true;
    document.getElementById('lightOn').dispatchEvent(new Event('change'));
    ok('the light field fixes it by flipping the type', read()[0] >= 4.5);
    ok('and its cards stay legible', read()[1] >= 4.5);
    document.getElementById('lightOn').checked = false;
    document.getElementById('lightOn').dispatchEvent(new Event('change'));
    setBg('#141414');
    box.checked = false; box.dispatchEvent(new Event('change'));
  }


  show(order.indexOf('main'));

  // geometry that kept drifting away from the Figma nodes. The used height, not offsetHeight:
  // transforms don't touch either, but offsetHeight is rounded to whole pixels and the hero is
  // 519.5 tall — which side it rounded to depended on the window size.
  const box = s => {
    const c = getComputedStyle(document.querySelector(s));
    return [parseFloat(c.width), parseFloat(c.height)];
  };
  const is = (s, w, h) => { const [a, b] = box(s); return a === w && (h === undefined || b === h); };
  // the scroll frame starts under the back tab (y=124) and runs to the frame bottom
  ok('pack detail scrolls from below the back tab to the node\'s clip line', is('.watch-scroll', 360, 413));
  ok('the info block scrolls with it', !!document.querySelector('.watch-scroll .watch-info'));
  ok('Main workout has no Skip', appbar.dataset.skip === 'off');
  ok('hero is 360×519.5 r40', is('.hero', 360, 519.5));
  /* node 138:4986, measured on the card the deck opens: its title is one line, which is what
     308.81 assumes — a card whose title wraps is taller by a line and always was. The height is
     a thumbnail plus a text row plus two paddings, so it lands a fraction off what Figma
     reports; a pixel of tolerance, not an exact match. */
  {
    const c = document.querySelectorAll('.deck .slot')[deckOpens].querySelector('.packcard');
    const s = getComputedStyle(c);
    ok('the pack card is the 377 × 308.8 r40 the deck was drawn with',
       parseFloat(s.width) === 377 && Math.abs(parseFloat(s.height) - 308.81) < 1 &&
       s.borderRadius === '40px');
  }
  ok('Total card is 360×171', is('.total', 360, 171));
  ok('graph bars are 105 / 210', is('.tbar--stretch', 105) && is('.tbar--learn', 210));

  /* 웹 뷰: the footage off leaves the design as designed — flat, unrigged, no projection look —
     and auto play still has a clock, because the clip keeps running as one. A beat fired here
     has no tracked fingertip to aim at, so it has to fall back to the control it presses. */
  {
    const deskBox = document.getElementById('deskOn');
    const rig = ['--rx', '--ry', '--rz', '--zoom'];
    deskBox.checked = false; deskBox.dispatchEvent(new Event('change'));
    const st = getComputedStyle(stage);
    const m = new DOMMatrix(st.transform);
    ok('the web view lays the frame flat',
       rig.every(p => ['0deg', '1'].includes(st.getPropertyValue(p).trim())) &&
       m.m12 === 0 && m.m21 === 0 && m.m41 === 0 && m.m42 === 0);
    ok('and drops the projection look along with the desk it was landing on',
       !document.body.classList.contains('is-preview') && st.filter === 'none');
    deskBox.checked = true; deskBox.dispatchEvent(new Event('change'));
  }

  ok('Total starts at the pack minutes', totalMin.textContent === String(STRETCH + LEARN));
  ok('run row starts as a placeholder', runLabel.textContent === '');
  const step = d => document.querySelector(`[data-step-delta="${d}"]`).click();
  for (let i = 0; i < MAX_ROUNDS + 3; i++) step(-1);
  ok('stepper floors at 1', rounds.textContent === '1');
  for (let i = 0; i < 5; i++) step(1);
  ok('Set up drives Total', rounds.textContent === '6' && totalMin.textContent === '35');
  ok('Strike carries its own minutes', runLabel.textContent === '23m');
  // read the target width, not the mid-transition one
  ok('top bars shrink to stay proportional',
     parseFloat(document.querySelector('.tbar--stretch').style.width) < 105 &&
     parseFloat(document.querySelector('.tbar--learn').style.width) < 210);
})();

/* ── dev-only live reload: poll Last-Modified, no deps ──── */
if (['localhost', '127.0.0.1'].includes(location.hostname)) {
  const files = ['index.html', 'style.css', 'app.js'];
  const seen = {};
  setInterval(async () => {
    for (const f of files) {
      const r = await fetch(f, { method: 'HEAD', cache: 'no-store' }).catch(() => null);
      const t = r && r.headers.get('last-modified');
      if (!t) continue;
      // stay on the screen being worked on — only a manual refresh restarts the flow
      if (seen[f] && seen[f] !== t) {
        sessionStorage.setItem('keep-screen', order[at]);
        return location.reload();
      }
      seen[f] = t;
    }
  }, 1000);
}
