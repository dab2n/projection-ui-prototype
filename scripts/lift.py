#!/usr/bin/env python3
"""투사면에 얹힐 사진·영상의 어두운 자리만 끌어올려 assets/lift/ 에 굽는다.

   프로젝터는 빛을 더할 뿐 덜어내지 못한다. 검정은 빔이 못 쏘는 색이라 그대로 두면
   화면에 구멍이 뚫린 것처럼 보인다. 그렇다고 전체 투명도를 낮추면 사진만 바래고
   검정은 여전히 상대적으로 가장 어둡다 — 어두운 자리에만 바닥을 깔아야 한다.

   채도로 거른다. 밝기만 보고 올리면 빨간 글러브의 G·B 까지 같이 올라가 붉은색이
   분홍으로 바랜다. 어둡고 '중성에 가까운' 자리(머리카락, 네이비, 갈색)만 올리고
   어둡지만 채도가 높은 자리(빨강)는 원본 그대로 둔다.

   런타임 필터(filter:url(#...))로 하지 않는 이유: 카드가 커지는 동안 브라우저가
   필터를 매 프레임 다시 래스터하면서 한 프레임 튄다.

     python3 scripts/lift.py
"""
import os, subprocess, sys

FLOOR, TCUT, S0, S1 = 0.30, 0.45, 0.40, 1.05
# 올리는 빛의 색. 세 채널을 똑같이 더하면 갈색이 회색으로 빠져 원래 갈색과 경계가 진다.
# 붉은 쪽을 더 얹어 '옅은 갈색'으로 올라가게 한다.
TINT = (1.00, 0.90, 0.80)


def ss(t):
    """경계를 부드럽게. 선형 램프는 끝점에서 기울기가 꺾여 그 선이 그대로 보인다."""
    t = 0.0 if t < 0 else (1.0 if t > 1 else t)
    return t * t * (3 - 2 * t)

IMAGES = """
assist-boost.png assist-boost-sel.png assist-load.png assist-load-sel.png
assist-pace.png assist-pace-sel.png assist-quiet.png assist-quiet-sel.png
creator-avatar.png hero-boxing.png joined-1.png joined-2.png joined-3.png
more-footwork.png more-round.png more-shadow.png
pack-thumb.png rel-boxer.png rel-challenge.png
avatar-devon.jpg avatar-sena.jpg avatar-laan.png avatar-junho.jpg avatar-noel.jpg
""".split()
# 실루엣은 뺀다 — 키잉해서 주황 한 색으로 칠하는 소스라 올릴 어두운 자리가 없다
VIDEOS = ['pack-hero.mp4']

root = os.path.join(os.path.dirname(__file__), '..')
src_dir = os.path.join(root, 'assets')
out_dir = os.path.join(src_dir, 'lift')
os.makedirs(out_dir, exist_ok=True)


def size(p):
    o = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0',
                        '-show_entries', 'stream=width,height', '-of', 'csv=p=0', p],
                       capture_output=True).stdout.decode().strip().split(',')
    return int(o[0]), int(o[1])


def lift_image(name):
    src, dst = os.path.join(src_dir, name), os.path.join(out_dir, name)
    w, h = size(src)
    raw = bytearray(subprocess.run(
        ['ffmpeg', '-v', 'error', '-i', src, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
        capture_output=True).stdout)
    n = 0
    for i in range(0, len(raw), 3):
        r, g, b = raw[i], raw[i + 1], raw[i + 2]
        lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
        if lum >= TCUT:
            continue
        mx, mn = max(r, g, b), min(r, g, b)
        sat = 0.0 if mx == 0 else (mx - mn) / mx
        k = FLOOR * ss((TCUT - lum) / TCUT) * ss((S1 - sat) / (S1 - S0)) * 255
        if k <= 0:
            continue
        raw[i] = min(255, int(r + k * TINT[0]))
        raw[i + 1] = min(255, int(g + k * TINT[1]))
        raw[i + 2] = min(255, int(b + k * TINT[2]))
        n += 1
    # 알파가 있는 PNG 는 알파를 잃는다. 여기 목록은 전부 불투명 사진이라 문제없다.
    subprocess.run(['ffmpeg', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24',
                    '-s', f'{w}x{h}', '-i', '-', '-y', dst], input=bytes(raw), check=True)
    return 100 * n / (len(raw) // 3)


def geq_channel(ch, tint):
    """geq 는 채널마다 식을 따로 받는다. 위 파이썬 루프와 같은 계산을 한 줄로 편 것.
       st/ld 는 geq 의 지역변수 — 같은 식을 세 번 쓰지 않으려고 담아둔다."""
    lum = '(0.2126*r(X,Y)+0.7152*g(X,Y)+0.0722*b(X,Y))'
    mx = 'max(r(X,Y),max(g(X,Y),b(X,Y)))'
    mn = 'min(r(X,Y),min(g(X,Y),b(X,Y)))'
    sat = f'(({mx}-{mn})/max({mx},1))'
    return (f'st(0,clip(({TCUT * 255}-{lum})/{TCUT * 255},0,1));'
            f'st(1,clip(({S1}-{sat})/{S1 - S0},0,1));'
            f'min(255,{ch}(X,Y)+{FLOOR * 255 * tint}'
            f'*ld(0)*ld(0)*(3-2*ld(0))*ld(1)*ld(1)*(3-2*ld(1)))')


def lift_video(name):
    src, dst = os.path.join(src_dir, name), os.path.join(out_dir, name)
    # 식 안의 쉼표를 따옴표로 감싸지 않으면 ffmpeg 이 필터 인자 구분자로 읽고 뻗는다
    geq = "format=rgb24,geq=r='%s':g='%s':b='%s'" % tuple(
        geq_channel(c, t) for c, t in zip('rgb', TINT))
    subprocess.run(['ffmpeg', '-v', 'error', '-i', src, '-vf', geq,
                    '-c:v', 'libx264', '-crf', '14', '-preset', 'medium',
                    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', '-y', dst], check=True)


for name in IMAGES:
    pct = lift_image(name)
    print('  %-24s %5.1f%% 올림' % (name, pct))
for name in VIDEOS:
    lift_video(name)
    print('  %-24s 영상' % name)
print('→ assets/lift/')
