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
    steps.forEach((li, k) => {
      li.classList.toggle('is-now', k === n);
      li.classList.toggle('is-done', k < n);
    });
    flowbar.querySelector('#btnNext').firstChild.nodeValue =
      n === steps.length - 1 ? 'Done ' : 'Next ';
  }

  replay(cur);
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
document.querySelectorAll('[data-select]').forEach(group => {
  const multi = group.dataset.select === 'multi';
  group.querySelectorAll('.opt').forEach(opt => {
    opt.onclick = () => {
      if (!multi) {
        group.querySelectorAll('.opt').forEach(o => o.classList.toggle('is-on', o === opt));
        return;
      }
      // multi: a [data-exclusive] option (e.g. "None") clears the rest, and vice versa
      const on = !opt.classList.contains('is-on');
      if (opt.hasAttribute('data-exclusive') && on) {
        group.querySelectorAll('.opt').forEach(o => o.classList.remove('is-on'));
      } else if (on) {
        group.querySelectorAll('.opt[data-exclusive]').forEach(o => o.classList.remove('is-on'));
      }
      opt.classList.toggle('is-on', on);
    };
  });
});

/* ── rounds stepper (drives the Total readout) ──────────── */
const rounds   = document.getElementById('rounds');
const totalMin = document.getElementById('totalMin');
const BASE_MIN = 12;                      // 4m stretch + 8m learn, fixed by the design
const PER_ROUND = 1;                      // 3m work + 1m rest ≈ 1 min of "You Can Choose" per step

document.querySelectorAll('[data-step-delta]').forEach(btn => {
  btn.onclick = () => {
    const next = Math.max(1, Math.min(20, +rounds.textContent + +btn.dataset.stepDelta));
    if (next === +rounds.textContent) return;
    rounds.textContent = next;
    totalMin.textContent = BASE_MIN + next * PER_ROUND;
    [rounds, totalMin].forEach(n => {
      n.classList.remove('is-pop');
      void n.offsetWidth;
      n.classList.add('is-pop');
    });
  };
});

/* ── boot ───────────────────────────────────────────────── */
show(Math.max(0, order.indexOf(location.hash.slice(1))));

/* ── self-check: open index.html?selftest and watch the console ──────────
   Covers the two bits with real branching — exclusive multi-select and the
   stepper clamp. Everything else is markup. */
if (location.search.includes('selftest')) {
  const ok = (name, cond) => console[cond ? 'log' : 'error'](`${cond ? 'PASS' : 'FAIL'} — ${name}`);
  const chips = [...document.querySelectorAll('.chips .opt')];
  const on = () => chips.filter(c => c.classList.contains('is-on')).length;

  chips.forEach(c => c.classList.remove('is-on'));
  chips[3].click(); chips[5].click();
  ok('multi-select keeps both', on() === 2);
  chips[0].click();
  ok('"None" clears the rest', on() === 1 && chips[0].classList.contains('is-on'));
  chips[1].click();
  ok('a body part clears "None"', on() === 1 && chips[1].classList.contains('is-on'));

  const dec = document.querySelector('[data-step-delta="-1"]');
  rounds.textContent = 1;
  dec.click();
  ok('stepper floors at 1', rounds.textContent === '1');
  rounds.textContent = 6;
  document.querySelector('[data-step-delta="1"]').click();
  ok('total tracks rounds', rounds.textContent === '7' && totalMin.textContent === '19');
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
