/* Projection UI prototype — flow + selection + motion. No deps. */

const stage   = document.getElementById('stage');
const screens = [...document.querySelectorAll('.screen')];
const order   = screens.map(s => s.dataset.screen);
const appbar  = document.getElementById('appbar');
const flowbar = document.getElementById('flowbar');
const steps   = [...flowbar.querySelectorAll('li')];

/* ── fit the 1060×663 frame to the viewport ─────────────── */
const fit = () => {
  const pad = 64;
  stage.style.setProperty('--s', Math.min(
    (innerWidth - pad) / 1060,
    (innerHeight - pad - 40) / 663,
  ));
};
addEventListener('resize', fit);
fit();

/* client px → design px inside the frame.
   The frame can carry a 3D tilt to match the desk, which makes this a projective map, not a
   scale — an affine inverse drifts further the more it is tilted. On the frame's own plane
   (z=0) the matrix collapses to a 3×3 homography, so drop the z column and solve the 2×2 it
   leaves. The origin is the untransformed centre: every transform here is taken about
   transform-origin:center, and .fit centres the frame without transforming, so .fit's centre
   is that point. */
const unproject = (cx, cy) => {
  const f = document.getElementById('fit').getBoundingClientRect();
  const m = new DOMMatrix(getComputedStyle(stage).transform);
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
const onShow = [];      // fns notified with the screen name on every change

function show(i) {
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
  el.querySelectorAll('[data-anim], .tbar, .bar').forEach(n => {
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

  let looping = false, nudge = 0;
  const key = () => {
    // self-heal: a spell with the tab hidden leaves the clip paused, and nothing else here
    // would ever start it again. Checked a few times a second, not every frame.
    if (video.paused && ++nudge % 20 === 0) video.play().catch(() => {});
    if (video.readyState >= 2) {
      ctx.drawImage(video, 0, 0, W, H);
      const img = ctx.getImageData(0, 0, W, H);
      const p = img.data;
      for (let i = 0; i < p.length; i += 4) {
        // luminance key: the matte is off-white (~#f4f4f4) and compression adds noise,
        // so anything within FLOOR of white drops out and the rest is curved up so the
        // pale head and arms stay readable. Colours are left alone — the clip already
        // carries the gradient the design wants.
        const d = (255 - Math.min(p[i], p[i + 1], p[i + 2]) - FLOOR) / (255 - FLOOR);
        p[i + 3] = d <= 0 ? 0 : Math.min(255, 255 * Math.pow(d, GAMMA));
      }
      ctx.putImageData(img, 0, 0);
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
    countTo(rounds, next, String, 260);
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
  const PACKS = [
    { img: 'more-shadow.png',   title: 'Your First Shadowboxing Flow', kind: 'Creator Pack', len: '23m', pos: '50% 22%' },
    { img: 'more-footwork.png', title: 'Footwork for Small Spaces',    kind: 'Creator Pack', len: '15m', pos: '50% 25%' },
    { img: 'pack-thumb.png',    title: '7m Indoor Boxing Basics',      kind: 'Creator Pack', len: '7m',  pos: '50% 10%', hot: true, go: 'watch' },
    { img: 'rel-boxer.png',     title: 'The Boxer’s Steps',            kind: 'Pro Pack',     len: '12m', pos: '50% 20%' },
    { img: 'more-round.png',    title: 'The First Round',              kind: 'Creator Pack', len: '31m', pos: '50% 45%' },
  ];
  const CENTRE = 2;

  const deck = document.getElementById('deck');
  const tpl  = document.getElementById('packTpl');
  const slots = PACKS.map((p, i) => {
    const slot = tpl.content.firstElementChild.cloneNode(true);
    const img = slot.querySelector('.packcard-thumb > img');
    img.src = `assets/${p.img}`;
    img.alt = p.title;
    img.style.setProperty('--pos', p.pos);
    slot.querySelector('.t2').textContent = p.title;
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

  /* No palette remap. The rule is: keep the designed colour and lower its opacity — hue and
     value stay exactly as drawn, and after the additive composite a lowered alpha lands nearer
     the floor on its own. Recomputing colours per token is what made every inactive tab a
     different hue. The only knobs left are physical: the desk, the room, the projector. */
  const apply = () => {
    // the desk is whatever the panel's picker is set to — there is only one colour here
    const n = parseInt(/([\da-f]{6})/i.exec(getComputedStyle(stage).getPropertyValue('--bg'))[1], 16);
    // real projection view: the desk sits at its own colour, so every black area of the frame
    // simply shows the desk. Ambient stops applying — that is the point of the view.
    // real view: the desk sits at its own colour and the frame projects nothing on the
    // background, so black areas — including type knocked out of a white card — are the desk
    const a = real.checked ? 1 : +ambient.value / 100;
    const rgb = [0, 1, 2].map(i => Math.round(((n >> (16 - i * 8)) & 255) * a));
    body.style.setProperty('--floor', `rgb(${rgb.join(' ')})`);
    body.style.setProperty('--gain', +gain.value / 100);
    ambientOut.textContent = ambient.value + '%';
    gainOut.textContent = gain.value + '%';
    const on = body.classList.contains('is-preview');
    // a drop shadow is light being removed, and a projector cannot do that
    if (on) body.style.setProperty('--sel-shadow', '0 0 0 rgba(0,0,0,0)');
    else body.style.removeProperty('--sel-shadow');
    brand(rgb.map(v => v / 255), on);
    meter(rgb.map(v => v / 255));
  };

  /* Keeping the red red.
     The floor adds its own light to every channel, so a colour composited over it comes out
     with its dark channels lifted — #FA3030 lands around #FA5353 and the red goes chalky. The
     projector can pull those channels down, though, so solve the composite backwards: emit
     P = 1 - (1-T)/(1-floor) and the desk shows T, the colour as drawn. Below the floor it
     clamps to zero, which is simply as saturated as the surface allows.

     Only the brand and the ramp get this. Neutrals are left alone on purpose — pre-compensating
     those is what previously pulled every token off in its own direction. */
  const RAMP = ['#fa3030', '#fe6e3c', '#fec389', '#d1feff'];
  const precomp = (hex, floor) => {
    const n = parseInt(/([\da-f]{6})/i.exec(hex)[1], 16);
    const ch = i => {
      const t = ((n >> (16 - i * 8)) & 255) / 255;
      const p = 1 - (1 - t) / (1 - floor[i]);
      return Math.round(Math.max(0, Math.min(1, p)) * 255).toString(16).padStart(2, '0');
    };
    return '#' + ch(0) + ch(1) + ch(2);
  };

  function brand(floor, on) {
    if (!on) {
      ['--brand', '--sel', '--bar-ramp'].forEach(k => body.style.removeProperty(k));
      return;
    }
    const r = RAMP.map(h => precomp(h, floor));
    body.style.setProperty('--brand', r[0]);
    body.style.setProperty('--sel',
      `linear-gradient(180deg,${r[0]} 53.869%,${r[1]} 85.083%,${r[2]} 104.71%,${r[3]} 104.72%)`);
    body.style.setProperty('--bar-ramp',
      `linear-gradient(90deg,${r[0]} 63.043%,${r[1]} 89.902%,${r[2]} 101.08%,${r[3]} 108.1%)`);
  }

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
  const screenOver = (c, floor) => c.map((v, i) => 1 - (1 - v) * (1 - floor[i]));

  function meter(floor) {
    const on = body.classList.contains('is-preview');
    const pairs = [
      ['배경 위 텍스트', rd('--ink'), rd('--bg')],
      ['카드 위 텍스트', rd('--ink-2'), rd('--surface')],
      ['브랜드 / 배경', rd('--brand'), rd('--bg')],
    ];
    out.innerHTML = pairs.map(([name, fg, bg]) => {
      const r = on ? ratio(screenOver(fg, floor), screenOver(bg, floor)) : ratio(fg, bg);
      return `<dt>${name}</dt><dd class="${r < 4.5 ? 'is-bad' : ''}">${r.toFixed(1)}:1</dd>`;
    }).join('');
  }

  on.onchange = () => {
    body.classList.toggle('is-preview', on.checked);
    body.classList.toggle('is-real', real.checked && on.checked);   // real view lives inside it
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
  unlit.onchange = () => body.classList.toggle('is-unlit', unlit.checked && on.checked);
  [ambient, gain].forEach(el => el.oninput = apply);
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
  const SRC = 'Projection GUI.mov';        // the 4K original the cut should be taken from

  /* ── perspective rig ──
     Defaults measured off the A4 sheet lying on the desk in the footage: it is foreshortened to
     0.54 of the height it would have flat on, so cos⁻¹(0.54) ≈ 56°, and its edges converge at
     the rate a camera ~3000px back gives at this frame size.
     원근 does nothing at 기울기 0° — a plane square to the camera has no depth to project —
     which is why it read as a dead control before the frame was laid down. */
  const KNOBS = [
    ['rx',    '기울기', -70,   70,   56, 'deg', '°'],
    ['ry',    '좌우',   -70,   70,    0, 'deg', '°'],
    ['rz',    '회전',   -45,   45,    0, 'deg', '°'],
    ['persp', '원근',   300, 4000, 3000, 'px',  'px'],
    ['zoom',  '크기',    15,  160,  112, '%',   '%'],
    ['tx',    'X',     -700,  700,  -25, 'px',  'px'],
    ['ty',    'Y',     -500,  500,  105, 'px',  'px'],
  ];
  // rig2: the defaults changed, and a saved rig from before would have hidden them
  const saved = JSON.parse(localStorage.getItem('rig2') || '{}');
  const rigRow = document.getElementById('rig');
  const inputs = {};

  KNOBS.forEach(([k, label, min, max, def, unit, suffix]) => {
    const el = document.createElement('label');
    el.innerHTML = `${label}<input type="range" min="${min}" max="${max}" value="${def}"
      aria-label="${label}"><b></b>`;
    rigRow.insertBefore(el, document.getElementById('rigReset'));
    const r = inputs[k] = el.querySelector('input');
    r.value = saved[k] ?? def;
    r.oninput = () => {
      // % is a ratio in CSS terms, the rest carry their unit through untouched
      stage.style.setProperty('--' + k, unit === '%' ? r.value / 100 : r.value + unit);
      el.querySelector('b').textContent = r.value + suffix;
      localStorage.setItem('rig2', JSON.stringify(
        Object.fromEntries(Object.entries(inputs).map(([n, i]) => [n, +i.value]))));
    };
    r.oninput();
  });
  document.getElementById('rigReset').onclick = () =>
    KNOBS.forEach(([k, , , , def]) => { inputs[k].value = def; inputs[k].oninput(); });

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

  document.getElementById('fullOn').onclick = () => document.fullscreenElement
    ? document.exitFullscreen() : document.documentElement.requestFullscreen();

  /* space plays, unless something focused wants it (a range steps, a button clicks) */
  addEventListener('keydown', e => {
    if (e.code === 'Space' && !/INPUT|BUTTON|TEXTAREA/.test(document.activeElement.tagName)) {
      e.preventDefault(); play.click();
    }
  });

  const deskOn = document.getElementById('deskOn');
  deskOn.onchange = () => { body.classList.toggle('is-desk', deskOn.checked); if (!deskOn.checked) vid.pause(); };
  deskOn.dispatchEvent(new Event('change'));

  const foldBar = document.getElementById('deskbar');
  document.getElementById('deskFold').onclick = e => {
    foldBar.classList.toggle('is-folded');
    e.target.textContent = foldBar.classList.contains('is-folded') ? '+' : '–';
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
  stage.addEventListener('pointerdown', e => {
    dot.classList.add('is-down');
    const [px, py] = toStage(e);
    const ring = document.createElement('span');
    ring.className = 'tap';
    ring.style.left = px + 'px';
    ring.style.top = py + 'px';
    taps.append(ring);
    ring.addEventListener('animationend', () => ring.remove());
  });
  addEventListener('pointerup', () => dot.classList.remove('is-down'));

  (function follow() {
    x += (tx - x) * EASE;
    y += (ty - y) * EASE;
    dot.style.transform = `translate(${x}px,${y}px)`;
    requestAnimationFrame(follow);
  })();
}

/* ── self-check: open index.html?selftest and watch the console ──────────
   Covers the two bits with real branching — exclusive multi-select and the
   stepper clamp. Everything else is markup. */
if (location.search.includes('selftest')) {
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

  {   /* the brand is pre-compensated for the floor, so the projected red comes back out as the
         red that was drawn rather than a chalky version of it */
    const box = document.getElementById('previewOn');
    box.checked = true; box.dispatchEvent(new Event('change'));
    const val = k => getComputedStyle(document.body).getPropertyValue(k).trim();
    const floorRGB = /rgb\((\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(val('--floor')).slice(1).map(v => +v / 255);
    const p = /([\da-f]{6})/i.exec(val('--brand'))[1];
    const out = [0, 1, 2].map(i => {
      const c = parseInt(p.slice(i * 2, i * 2 + 2), 16) / 255;
      return Math.round((1 - (1 - c) * (1 - floorRGB[i])) * 255);
    });
    ok('the projected brand red lands back on #FA3030',
       Math.abs(out[0] - 250) <= 2 && Math.abs(out[1] - 48) <= 2 && Math.abs(out[2] - 48) <= 2);
    box.checked = false; box.dispatchEvent(new Event('change'));
    // inline props are what the preview writes; the computed value would inherit from :root
    ok('and the token is released when preview is off',
       document.body.style.getPropertyValue('--brand') === '');

    /* real projection view: the frame stops projecting its background, and the desk takes the
       picked background colour — so a black glyph inside a white card is a hole onto the desk */
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
  ok('the boxing pack starts centred', cards[2].dataset.d === '0');
  // the blur has to land between the side cards and the middle one, or it has nothing to blur
  ok('the deck blur sits under the middle card and over the rest',
     getComputedStyle(document.querySelector('.deck-haze')).zIndex === '7' &&
     cards[2].style.zIndex === '9' && cards[1].style.zIndex === '6');
  cards[3].click();
  ok('tapping a side card centres it', cards[3].dataset.d === '0' && cards[2].dataset.d === '-1');

  // recording aids: the system pointer is replaced, taps leave a ring, a swipe leaves a trail
  ok('the frame hides the system cursor', getComputedStyle(stage).cursor === 'none');
  stage.dispatchEvent(new PointerEvent('pointerdown', { clientX: 400, clientY: 300, bubbles: true }));
  ok('a tap spawns a ripple', document.querySelectorAll('.taps .tap').length === 1);
  ok('no selectable control shows a system cursor',
     [...document.querySelectorAll('.card,.chip,.slot,.btn')].every(e => getComputedStyle(e).cursor === 'none'));

  // desk plate: the footage has to be inside .fit, or the preview's screen blend composites
  // the frame against nothing and the "projection onto the desk" is just an overlay
  ok('the desk footage is the plate the frame blends onto',
     document.getElementById('deskVid').parentElement === document.getElementById('fit'));
  // tilted, pointer→design is projective; an affine inverse looks right at the centre and
  // drifts at the corners, which is exactly where the frame's controls are
  {
    stage.style.setProperty('--rx', '38deg');
    stage.style.setProperty('--rz', '9deg');
    const fwd = (x, y) => {                       // forward projection, via a different path
      // read the frame's box here, not once up front: a scrollbar appearing mid-test moves the
      // centre 7.5px and the round-trip fails on the reference point, not on the maths
      const f = document.getElementById('fit').getBoundingClientRect();
      const p = new DOMMatrix(getComputedStyle(stage).transform)
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
  ok('Total card is 360×171', is('.total', 360, 171));
  ok('graph bars are 105 / 210', is('.tbar--stretch', 105) && is('.tbar--learn', 210));

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
}

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
