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

/* ── navigation ─────────────────────────────────────────── */
let at = 0;
const onShow = [];      // fns notified with the screen name on every change

function show(i) {
  at = Math.max(0, Math.min(screens.length - 1, i));
  screens.forEach((s, n) => s.classList.toggle('is-active', n === at));

  const cur  = screens[at];
  const step = cur.dataset.step;          // undefined on pack / watch
  const bar  = cur.dataset.appbar;        // 'back' | 'both' | undefined

  appbar.classList.toggle('is-on', !!bar);
  appbar.dataset.back = bar ? 'on' : 'off';
  appbar.dataset.skip = bar === 'both' ? 'on' : 'off';
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

  const key = () => {
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
    video.requestVideoFrameCallback ? video.requestVideoFrameCallback(key) : requestAnimationFrame(key);
  };

  video.addEventListener('loadeddata', () => { video.play().catch(() => {}); key(); }, { once: true });
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
  runLabel.textContent = set ? `${strikeMin}m` : '';
}

/* Entering the step, the total counts up to its current value. */
function countTotal() {
  const t = total();
  let start = null;
  requestAnimationFrame(function step(ts) {
    if (start === null) start = ts;
    const p = Math.min((ts - start) / 700, 1);
    totalMin.textContent = Math.round((1 - (1 - p) ** 2) * t);
    if (p < 1) requestAnimationFrame(step);
  });
}
onShow.push(name => { if (name === 'main') { layoutBars(); countTotal(); } });

document.querySelectorAll('[data-step-delta]').forEach(btn => {
  btn.onclick = () => {
    const next = Math.max(1, Math.min(MAX_ROUNDS, +rounds.textContent + +btn.dataset.stepDelta));
    if (next === +rounds.textContent && strikeMin) return;
    rounds.textContent = next;
    strikeMin = strikeFor(next);
    layoutBars();
    totalMin.textContent = total();
    [rounds, totalMin].forEach(n => {
      n.classList.remove('is-pop');
      void n.offsetWidth;
      n.classList.add('is-pop');
    });
  };
});

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

/* ── projection background picker ───────────────────────── */
{
  const sv = document.getElementById('sv'), hue = document.getElementById('hue');
  const svDot = document.getElementById('svDot'), hueDot = document.getElementById('hueDot');
  const hex = document.getElementById('pickerHex');
  let h = 0, s = 0, v = 8;                                   // #141414

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

  const panel = document.getElementById('picker');
  document.getElementById('pickerFold').onclick = function () {
    panel.classList.toggle('is-folded');
    this.textContent = panel.classList.contains('is-folded') ? '+' : '–';
  };

  paint();
}

/* ── boot ───────────────────────────────────────────────── */
show(Math.max(0, order.indexOf(location.hash.slice(1))));

/* ── self-check: open index.html?selftest and watch the console ──────────
   Covers the two bits with real branching — exclusive multi-select and the
   stepper clamp. Everything else is markup. */
if (location.search.includes('selftest')) {
  const ok = (name, cond) => console[cond ? 'log' : 'error'](`${cond ? 'PASS' : 'FAIL'} — ${name}`);
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

  show(order.indexOf('level'));
  ok('Next dims while a group is empty', !btnNext.classList.contains('is-ready'));
  seg[1].click();
  document.querySelector('.assist').click();
  ok('Next lights up once answered', btnNext.classList.contains('is-ready'));

  show(order.indexOf('main'));

  // geometry that kept drifting away from the Figma nodes — offsetWidth ignores the
  // scale transform the inactive screens carry, so it reads the design units directly
  const box = s => { const e = document.querySelector(s); return [e.offsetWidth, e.offsetHeight]; };
  const is = (s, w, h) => { const [a, b] = box(s); return a === w && (h === undefined || b === h); };
  ok('pack detail scrolls in its 360×221 frame', is('.watch-scroll', 360, 221));
  ok('hero is 360×519 r40', is('.hero', 360, 519));
  ok('Total card is 360×171', is('.total', 360, 171));
  ok('graph bars are 105 / 210', is('.tbar--stretch', 105) && is('.tbar--learn', 210));

  ok('Total starts at the pack minutes', totalMin.textContent === String(STRETCH + LEARN));
  ok('run row starts as a placeholder', runLabel.textContent === '');
  rounds.textContent = 1;
  document.querySelector('[data-step-delta="-1"]').click();
  ok('stepper floors at 1', rounds.textContent === '1');
  rounds.textContent = 5;
  document.querySelector('[data-step-delta="1"]').click();
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
      if (seen[f] && seen[f] !== t) return location.reload();
      seen[f] = t;
    }
  }, 1000);
}
