#!/usr/bin/env node
/* 프로토타입 테이크를 2K 영상으로 뽑는다. 화면녹화가 아니라 익스포터다 — 프레임을 한 장씩
   찍어 ffmpeg 에 바로 밀어넣으므로 드롭이 없고, 해상도는 디스플레이와 무관하다.

     node scripts/export.mjs                    # 2560×1810 (A4 가로 × 1.08) / 30fps
     node scripts/export.mjs --w 3840 --slow 28 # 4K

   원리: DOM 은 three.js 처럼 가상 시계를 꽂을 수가 없다(CSS 애니메이션은 컴포지터 시계로
   돈다). 그래서 페이지 전체를 --slow 배로 늦춰 돌리고 실시간으로 한 장씩 찍은 뒤, 출력에서
   제 속도로 되돌린다. 늦춰야 하는 시계는 넷이고 전부 잡는다:
     · CSS 애니메이션·트랜지션 → CDP Animation.setPlaybackRate
     · setTimeout/setInterval  → 지연시간에 배수를 곱한다 (테이크의 gap 이 여기 있다)
     · performance.now / rAF   → 스케일된 시각을 돌려준다 (스크롤 글라이드·숫자 트윈)
     · <video>                 → playbackRate. 1/16 = 0.0625 가 크롬의 하한이라 slow 의
                                 기본값이 16이다. 더 늦추려면 영상은 이 속도에 머문다.

   렌더는 슬로모지만 출력 프레임 간격은 정확히 1/fps 다. 한 장 찍는 데 예산(slow/fps)보다
   오래 걸리면 그만큼 내용이 앞서가므로, 끝나고 최대 드리프트를 ms 로 보고한다. */

import { spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > -1 ? process.argv[i + 1] : d; };
const W     = +arg('w', 2560);
/* 대지는 A4 가로판보다 pad 배 크다. 프레임(1060×663)은 A4 의 폭에 맞고, 남는 테두리가
   에펙에서 마스크에 페더를 먹일 여유다 — 여백이 없으면 페더가 UI 를 갉아먹는다. */
const PAD   = +arg('pad', 1.08);
const A4W   = W / PAD;                    // A4 가로판의 폭 = 프레임의 폭
const H     = +arg('h', Math.round(A4W * 210 / 297 * PAD / 2) * 2);
const FPS   = +arg('fps', 30);
const SLOW  = +arg('slow', 16);
const TAIL  = +arg('tail', 2.6);          // 마지막 비트 뒤로 붙잡고 있는 초
const OUT   = arg('out', 'out/PAPER_2K');
const HTTP  = +arg('port', 5599);
const CDPP  = +arg('cdpport', 9333);
const LOOK  = arg('look', 'paper');
const SCENE = arg('scene', '');           // 'nudge' 면 테이크 대신 넛지 씬을 찍는다
const FEATH = +arg('feather', 0);         // 0 이면 테두리 페더판을 안 만든다
const PAPER = arg('paper', '#C9C9CA');    // 페더판 프리뷰를 깔아볼 책상 색
const CHROME = arg('chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');

const root = new URL('..', import.meta.url).pathname;
const say = m => console.log(m);
const kids = [];
const bye = () => kids.forEach(p => { try { p.kill('SIGKILL'); } catch {} });
process.on('exit', bye);
process.on('SIGINT', () => { bye(); process.exit(1); });

/* ── 정적 서버 ── 레인지 요청을 answer 하는 저장소의 serve.py 를 그대로 쓴다.
   <video> 는 레인지가 없으면 readyState 0 에서 영영 안 올라온다. */
kids.push(spawn('python3', [join(root, 'serve.py'), String(HTTP)], { cwd: root, stdio: 'ignore' }));

/* ── 크롬 ── */
const profile = join(tmpdir(), 'projui-export-' + process.pid);
kids.push(spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${CDPP}`, `--user-data-dir=${profile}`,
  `--window-size=${W},${H}`, '--force-device-scale-factor=1', '--hide-scrollbars',
  '--mute-audio', '--autoplay-policy=no-user-gesture-required',
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  // 백그라운드 창 취급을 받으면 타이머가 1초로 스로틀되고 rAF 가 멎는다 — 렌더가 죽는다
  '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding', '--disable-features=CalculateNativeWinOcclusion',
  'about:blank',
], { stdio: 'ignore' }));

/* ── CDP ── 의존성 없이. node 22+ 의 전역 WebSocket 이면 충분하다. */
let ws, seq = 0;
const waiting = new Map();
for (let i = 0; i < 100; i++) {
  try {
    const r = await fetch(`http://127.0.0.1:${CDPP}/json/version`);
    ws = new WebSocket((await r.json()).webSocketDebuggerUrl);
    await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });
    break;
  } catch { await sleep(200); }
}
if (!ws) throw new Error('크롬이 안 뜬다');
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  const p = waiting.get(m.id);
  if (!p) return;
  waiting.delete(m.id);
  m.error ? p.no(new Error(m.method + ' ' + m.error.message)) : p.ok(m.result);
};
let session;
const cdp = (method, params = {}, ms = 0) => new Promise((ok, no) => {
  const id = ++seq;
  waiting.set(id, { ok, no });
  ws.send(JSON.stringify({ id, method, params, sessionId: session }));
  // 뒤늦게 답이 와도 waiting 에서 빠진 뒤라 그냥 버려진다
  if (ms) setTimeout(() => { if (waiting.delete(id)) no(new Error(method + ' 무응답')); }, ms);
});

const { targetId } = await cdp('Target.createTarget', { url: 'about:blank' });
({ sessionId: session } = await cdp('Target.attachToTarget', { targetId, flatten: true }));
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Animation.enable');
await cdp('Emulation.setDeviceMetricsOverride', {
  width: W, height: H, deviceScaleFactor: 1, mobile: false,
});

/* 페이지의 스크립트보다 먼저 들어가야 한다 — app.js 가 이미 잡아둔 setTimeout 은 못 바꾼다 */
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
  const N = ${SLOW};
  const P0 = performance.now(), D0 = Date.now();
  const rawNow = performance.now.bind(performance), rawDate = Date.now;
  performance.now = () => P0 + (rawNow() - P0) / N;
  Date.now = () => D0 + (rawDate() - D0) / N;
  const st = setTimeout, si = setInterval;
  window.setTimeout  = (f, d, ...a) => st(f, (d || 0) * N, ...a);
  window.setInterval = (f, d, ...a) => si(f, (d || 0) * N, ...a);
  const raf = requestAnimationFrame.bind(window);
  window.requestAnimationFrame = cb => raf(() => cb(performance.now()));
  // 영상은 자기 시계로 돈다. play() 를 가로채면 나중에 붙는 요소까지 다 잡힌다.
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () { this.playbackRate = 1 / N; return play.call(this); };
})();` });

const url = `http://127.0.0.1:${HTTP}/index.html?look=${LOOK}${SCENE ? '&scene=' + SCENE : ''}`;
say(`○ ${url}  →  ${W}×${H} @${FPS}fps  (${SLOW}× 슬로모 렌더)`);
const loaded = new Promise(ok => {
  ws.addEventListener('message', e => {
    if (JSON.parse(e.data).method === 'Page.loadEventFired') ok();
  });
});
await cdp('Page.navigate', { url });
await loaded;

const evalIn = async expr => {
  const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + expr);
  return r.result.value;
};

/* 패널을 걷어내고 프레임을 출력 해상도에 정확히 맞춘다. fit() 이 매 리사이즈마다 인라인
   스타일을 다시 쓰므로 전부 !important — 인라인은 !important 를 못 이긴다. */
await evalIn(`(() => {
  const s = document.createElement('style');
  s.textContent = \`
    html,body{width:${W}px;height:${H}px;overflow:hidden}
    body{padding:0!important;gap:0!important;display:block!important}
    .picker,.deskbar,.hint,.takebar{display:none!important}
    .fit{position:fixed!important;left:0;top:0;width:${W}px!important;height:${H}px!important}
    .canvas{position:fixed!important;left:0!important;top:0!important;
      width:${W}px!important;height:${H}px!important;margin:0!important;
      box-shadow:none!important;--s:${(A4W / 1060).toFixed(6)}!important}
    /* 비트 사이 정지 구간에서는 화면에 움직이는 게 없어 컴포지터가 새 프레임을 안 내놓고,
       그러면 captureScreenshot 이 다음 프레임을 기다리다 그대로 물린다. 1px 짜리 안 보이는
       애니메이션 하나로 프레임을 계속 돌게 둔다. */
    body::after{content:'';position:fixed;left:0;top:0;width:1px;height:1px;
      background:currentColor;animation:xtick 1s steps(2) infinite}
    @keyframes xtick{from{opacity:.01}to{opacity:0}}\`;
  document.head.append(s);
  dispatchEvent(new Event('resize'));
})()`);

// 폰트와 영상이 다 올라오기 전에 찍으면 첫 몇 초가 대체 폰트와 빈 프레임이다
await evalIn(`document.fonts.ready.then(() => 1)`);
// fonts.ready 는 대체 폰트로 그려도 resolve 한다. 7분 렌더를 대체 폰트로 날리지 않게 확인한다
if (!await evalIn(`document.fonts.check('700 40px Supreme')`))
  throw new Error('Supreme 이 안 올라왔다 — fontshare 연결 확인');
await evalIn(`Promise.all([...document.querySelectorAll('.hero-clip,.figure-src')].map(v =>
  v.readyState >= 3 ? 1 : new Promise(r => v.addEventListener('canplay', r, { once: true })))).then(() => 1)`);
await sleep(1500);

/* rAF 가 도는지 확인한다. 헤드리스에서 컴포지터가 안 돌면 실루엣 캔버스가 백지로 나가고
   숫자 트윈이 끝값으로 튄다 — 다 뽑고 나서 알면 늦다. */
const raf = await evalIn(`new Promise(r => { let n = 0;
  const t = performance.now(), f = () => { n++; performance.now() - t < 300 ? requestAnimationFrame(f) : r(n); };
  requestAnimationFrame(f); })`);
if (raf < 5) throw new Error(`rAF 가 안 돈다 (300ms 에 ${raf}프레임)`);

await cdp('Animation.setPlaybackRate', { playbackRate: 1 / SLOW });

const dur = +arg('dur', 0) || (SCENE ? 6
  : (await evalIn(`__beats.reduce((s, b) => s + (b.gap ?? 1200), 0) / 1000`)) + TAIL);
const frames = Math.round(dur * FPS);
say(`○ 테이크 ${dur.toFixed(2)}초 = ${frames}프레임 · 예상 ${(frames * SLOW / FPS / 60).toFixed(1)}분`);

/* ── ffmpeg ── PNG 를 파일로 남기지 않고 바로 물린다. 2K 780장이면 2.5GB 짜리 중간산출물이다.
   .mov(ProRes 422) 가 본편, .mp4 는 확인용. */
mkdirSync(join(root, OUT, '..'), { recursive: true });
const ff = spawn('ffmpeg', [
  '-y', '-hide_banner', '-loglevel', 'error',
  '-f', 'image2pipe', '-c:v', 'png', '-framerate', String(FPS), '-i', '-',
  '-c:v', 'prores_ks', '-profile:v', '2', '-pix_fmt', 'yuv422p10le', '-vendor', 'apl0', `${OUT}.mov`,
  '-c:v', 'libx264', '-crf', '17', '-preset', 'medium', '-pix_fmt', 'yuv420p',
  '-movflags', '+faststart', `${OUT}.mp4`,
], { cwd: root, stdio: ['pipe', 'inherit', 'inherit'] });
kids.push(ff);
const push = buf => ff.stdin.write(buf) ? Promise.resolve()
  : new Promise(r => ff.stdin.once('drain', r));

/* ── 테이크 시작 ── runTake 는 첫 500ms 를 그냥 흘려보내고 나서 되감으므로, 그만큼
   (페이지 시간으로) 기다렸다가 첫 화면이 슬라이드인 하는 프레임부터 찍는다. */
if (SCENE === 'nudge') {
  await evalIn('window.__nudge(), 1');       // 빈 책상부터 — 되감을 게 없으니 곧바로 찍는다
} else {
  await evalIn('window.__take(), 1');
  await sleep(500 * SLOW);
}

/* captureScreenshot 은 다음 프레임이 나올 때까지 기다린다. 비트 사이의 긴 정지 구간에서는
   페이지가 새 프레임을 안 내놓아 그대로 영영 멈추는 일이 있다 — 실제로 45% 에서 한 번 물렸다.
   그래서 응답에 시한을 두고 세 번 찔러본 뒤, 그래도 없으면 직전 프레임을 한 번 더 쓴다.
   어차피 정지 구간이라 같은 그림이고, 프레임 수와 간격은 흐트러지지 않는다. */
const shoot = async () => {
  for (let i = 0; i < 3; i++) {
    try {
      return (await cdp('Page.captureScreenshot',
        { format: 'png', optimizeForSpeed: true, fromSurface: true, captureBeyondViewport: false },
        3000)).data;
    } catch { /* 다시 */ }
  }
  return null;
};

const budget = SLOW * 1000 / FPS;
const t0 = Date.now();
let late = 0, held = 0, last = null;
for (let k = 0; k < frames; k++) {
  const wait = t0 + k * budget - Date.now();
  if (wait > 0) await sleep(wait); else late = Math.max(late, -wait);
  const data = await shoot();
  if (data) last = Buffer.from(data, 'base64'); else held++;
  if (!last) throw new Error('첫 프레임부터 스크린샷이 안 나온다');
  await push(last);
  if (k % FPS === 0) process.stdout.write(`\r  ${k}/${frames}  ${(k / FPS).toFixed(0)}s`);
}
process.stdout.write('\r' + ' '.repeat(30) + '\r');
if (held) say(`⚠ ${held}프레임은 응답이 없어 직전 프레임을 다시 썼다`);

ff.stdin.end();
await new Promise(r => ff.on('close', r));
rmSync(profile, { recursive: true, force: true });

say(`✓ ${OUT}.mov  (ProRes 422 — 에펙에 넣을 것)`);
say(`✓ ${OUT}.mp4  (확인용)`);

/* ── 테두리 페더판 ── 판은 화면을 꽉 채운 사각형이라, 책상 색을 아무리 맞춰도 남는 오차가
   경계선으로 읽힌다. 바깥 --feather px 를 알파로 흘려보내면 선이 아예 없어진다. 빔 자체가
   가장자리가 무르다는 점에서도 맞다.

   이미 뽑은 .mov 에 알파만 얹는다 — 페더 구간은 어차피 단색 판이라 CSS 로 굽든 여기서
   얹든 결과가 같고, 두 판이 프레임 단위로 정확히 같다는 게 보장된다. RGB 는 건드리지
   않으므로 스트레이트 알파다: 에펙에서 Interpret Footage → Alpha → Straight (Unmatted). */
if (FEATH) {
  const run = a => new Promise((ok, no) => {
    const p = spawn('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...a],
                    { cwd: root, stdio: ['ignore', 'inherit', 'inherit'] });
    p.on('close', c => c ? no(new Error('ffmpeg ' + c)) : ok());
  });
  // 흰 사각형을 F/2 만큼 안쪽에 그리고 sigma F/4 로 흐린다 → 가장자리에서 0, F 안쪽에서 1
  const mask = `${OUT}_mask.png`;
  await run(['-f', 'lavfi', '-i', `color=c=black:s=${W}x${H}:d=1`,
    '-vf', `drawbox=x=${FEATH / 2}:y=${FEATH / 2}:w=${W - FEATH}:h=${H - FEATH}:color=white:t=fill,`
         + `gblur=sigma=${FEATH / 4}`, '-frames:v', '1', mask]);
  // 마스크는 한 장이라 무한 루프로 물린다 — 끝을 -frames:v 로 못박지 않으면 ffmpeg 가
  // 영영 안 끝난다. -shortest 는 필터그래프에서는 이 조합을 끊어주지 못한다.
  await run(['-i', `${OUT}.mov`, '-loop', '1', '-framerate', String(FPS), '-i', mask,
    '-filter_complex', '[0][1]alphamerge', '-frames:v', String(frames),
    '-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le',
    '-vendor', 'apl0', `${OUT}_edge.mov`]);
  await run(['-i', `${OUT}_edge.mov`, '-f', 'lavfi', '-i', `color=c=${PAPER}:s=${W}x${H}:r=${FPS}`,
    '-filter_complex', '[1][0]overlay=shortest=1,format=yuv420p', '-frames:v', String(frames),
    '-c:v', 'libx264', '-crf', '17', '-preset', 'medium', `${OUT}_edge.mp4`]);
  rmSync(join(root, mask), { force: true });
  say(`✓ ${OUT}_edge.mov  (ProRes 4444 — 테두리 ${FEATH}px 페더, 알파는 Straight/Unmatted)`);
  say(`✓ ${OUT}_edge.mp4  (확인용 — 책상색 ${PAPER} 위에 얹어본 것)`);
}
say(late > budget * 0.1
  ? `⚠ 한 장 찍는 게 예산(${budget | 0}ms)보다 최대 ${late | 0}ms 늦었다 = 내용 ${(late / SLOW).toFixed(0)}ms 드리프트. --slow 를 올려라`
  : `  드리프트 최대 ${(late / SLOW).toFixed(1)}ms — 무시해도 된다`);
process.exit(0);
