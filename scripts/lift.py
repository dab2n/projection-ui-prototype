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

# 어두운 자리를 '올린다'가 아니라 '옅은 갈색 쪽으로 섞는다'. 더하기는 원래 값이 얼마였든
# 같은 양을 얹으므로 어두운 자리 사이의 차이가 그대로 남아 만화처럼 뭉친 덩어리가 된다.
# 섞기는 어두울수록 목표색에 가까워지므로 그 안의 대비가 같이 눌린다.
TARGET = (160, 136, 118)          # 옅은 갈색 #A08876 — 사진에서 가장 밝은 갈색 언저리
WMAX, TCUT, C0, C1 = 0.74, 0.46, 0.16, 0.40
# 문지기는 채도(max-min)/max 가 아니라 크로마(max-min)/255 다. 어두운 화소의 채도는
# 분모가 작아 요동친다 — #080402 는 채도 0.75 지만 사실상 검정이다. 그 값으로 문을 닫으면
# 머리카락 안에서 화소마다 지나가고 막히고가 갈려 만화처럼 점점이 남는다.


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
        chroma = (max(r, g, b) - min(r, g, b)) / 255
        wt = WMAX * ss((TCUT - lum) / TCUT) * ss((C1 - chroma) / (C1 - C0))
        if wt <= 0:
            continue
        # 목표색보다 이미 밝은 채널은 건드리지 않는다 — 어디서도 어두워지지 않는다
        for j, c in enumerate((r, g, b)):
            raw[i + j] = int(c + max(0, TARGET[j] - c) * wt)
        n += 1
    # 알파가 있는 PNG 는 알파를 잃는다. 여기 목록은 전부 불투명 사진이라 문제없다.
    subprocess.run(['ffmpeg', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24',
                    '-s', f'{w}x{h}', '-i', '-', '-y', dst], input=bytes(raw), check=True)
    return 100 * n / (len(raw) // 3)


def geq_channel(ch, tint):   # tint = 그 채널의 목표값
    """geq 는 채널마다 식을 따로 받는다. 위 파이썬 루프와 같은 계산을 한 줄로 편 것.
       st/ld 는 geq 의 지역변수 — 같은 식을 세 번 쓰지 않으려고 담아둔다."""
    lum = '(0.2126*r(X,Y)+0.7152*g(X,Y)+0.0722*b(X,Y))'
    mx = 'max(r(X,Y),max(g(X,Y),b(X,Y)))'
    mn = 'min(r(X,Y),min(g(X,Y),b(X,Y)))'
    chroma = f'(({mx}-{mn})/255)'
    return (f'st(0,clip(({TCUT * 255}-{lum})/{TCUT * 255},0,1));'
            f'st(1,clip(({C1}-{chroma})/{C1 - C0},0,1));'
            f'st(2,{WMAX}*ld(0)*ld(0)*(3-2*ld(0))*ld(1)*ld(1)*(3-2*ld(1)));'
            f'{ch}(X,Y)+max(0,{tint}-{ch}(X,Y))*ld(2)')


def lift_video(name):
    src, dst = os.path.join(src_dir, name), os.path.join(out_dir, name)
    # 식 안의 쉼표를 따옴표로 감싸지 않으면 ffmpeg 이 필터 인자 구분자로 읽고 뻗는다
    geq = "format=rgb24,geq=r='%s':g='%s':b='%s'" % tuple(
        geq_channel(c, t) for c, t in zip('rgb', TARGET))
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
