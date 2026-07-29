# Projection UI — 웹 프로토타입

Figma `2026 개인 / UI` 섹션의 프로젝션 온보딩 플로우를 웹으로 옮긴 인터랙티브 프로토타입.
빌드 없음, 의존성 없음 — `index.html` / `style.css` / `app.js` 세 파일.

원본: [NEWTON GUI 작업](https://www.figma.com/design/m8cFjM9O4KoY3BeJswU1rJ/NEWTON-GUI-%EC%9E%91%EC%97%85) — 팩 시청 `705:7647`,
Level/Mode `205:10018`, Main workout `143:7373`, Total 컨테이너 `759:8520`.

## 실행

```bash
python3 -m http.server 5555
# http://localhost:5555
```

localhost에서 열면 `index.html` / `style.css` / `app.js`의 `Last-Modified`를 1초마다 폴링해
자동 새로고침한다. 파일 저장하면 브라우저에 바로 반영됨.

자체 점검: `http://localhost:5555/index.html?selftest` → 콘솔에 PASS/FAIL.
동작뿐 아니라 **핵심 치수(스크롤 프레임 360×221, 히어로 360×519, Total 360×171, 바 105/210)**도
같이 검사한다 — 이 값들이 계속 어긋났기 때문.

## 화면 (7개)

| # | 해시 | Figma 프레임 |
|---|------|--------------|
| 0 | `#pack` | 팩 제안 |
| 1 | `#watch` | 팩 시청 |
| 2 | `#location` | Location/Goal |
| 3 | `#condition` | Onboarding_Sport Selection |
| 4 | `#injury` | injury check |
| 5 | `#level` | Level/Mode |
| 6 | `#main` | Main workout |

## 조작

- `←` `→` 방향키, 또는 Next / Skip / 뒤로가기 버튼
- 카드·칩 클릭 → 선택 상태 전환. **한 번 더 누르면 해제**된다 (단일 선택 그룹도 마찬가지).
  Injury check만 다중 선택이고 "None"은 배타적
- Next는 그 스텝의 모든 그룹에 답이 있어야 흰색으로 켜진다 (그 전엔 Neutral/500)
- **Injury check**: 칩으로도, 실루엣 위의 부위를 직접 눌러서도 선택된다. 선택된 부위에는
  `신체 영역` 마커가 올라간다
- **팩 시청**: 상단 뒤로가기 바를 뺀 아래 영역 전체가 스크롤된다
- Main workout의 `−` `+` → 라운드 수와 Total 분이 함께 변함
- URL 해시로 특정 화면 직접 열기 (`#level` 등)

## 프로젝션 배경색 테스트

이 UI는 웹이 아니라 **흰 책상 위에 투사**되는 것이 최종 형태라, 배경색은 실제 환경에
올려보고 정해야 하는 값이다. 우측 하단 패널(Figma 컬러 피커와 같은 SV 사각형 + 색상 슬라이더
+ HEX + 프리셋)로 프레임 배경을 실시간으로 바꿔볼 수 있다.

프리셋: Design default(#141414) · Neutral/Black · Neutral/800 · White desk · Warm desk · Wood desk.
헤더의 `–`로 접힌다. 배경은 `--bg` 하나만 바꾸므로 나머지 토큰은 그대로다.

## 팩 시청 (`705:7647`)

레이아웃은 노드 좌표 그대로다. 히어로 360×519.5 @(140,72) r40, 정보 블록 @(576,124),
Start 버튼 328폭 @(576,521).

- **스크롤 영역은 (560,316)의 360×221 프레임 하나뿐**이다. Figma가 그 프레임만 클립하고
  안쪽 콘텐츠를 흘려보내므로, 화면 전체가 스크롤되지 않는다
- 히어로는 썸네일로 시작해 **1초 뒤 클립이 크로스 디졸브**로 들어오고, 새로고침 전까지 반복 재생
- 프레임 하단의 흐린 효과는 32px 배경 블러 + 낮은 불투명도의 갈색 그라디언트를 위로 페이드시킨 것
- 불 아이콘은 `solar:fire-bold-duotone` 에셋 2개 (24px, 18.67px 13.68° 회전)

## Main workout (`143:7373` · `759:8520`)

**Total은 조작란이 아니라 표시용**이다. 오른쪽 Set up의 Rounds / Time이 Strike 시간을 정한다.

- 팩의 STRETCH 5분 · LEARN 7분은 고정 (바 폭도 105 / 210으로 고정)
- 한 라운드 = 3m Work + 1m Rest = 4분. `−` `+`로 라운드를 바꾸면 Strike 시간이 바뀌고
  Total이 자동으로 다시 계산된다
- Strike! 칩이 run 행의 채움 역할을 해서, 라운드가 늘어나면 왼쪽으로 자란다 (0.55s)
- 스텝 진입 시 Total이 700ms 동안 카운트업한다

## 실루엣

Injury check의 인물은 `assets/injury-silhouette.mp4`. 원본이 **흰 매트 위 주황 실루엣**이라
`app.js`가 매 프레임 캔버스에서 흰 배경을 알파로 키잉한다 (`FLOOR`/`GAMMA`로 조절).
덕분에 배경색을 어떤 색으로 바꿔도 실루엣이 살아있다.

부위별 위치는 `app.js`의 `PARTS` 테이블 하나에 정규화 좌표로 모여 있다. 클립을 다시 찍으면
이 표만 고치면 된다.

## 구조

프레임은 Figma와 동일한 **1060 × 663** 고정 크기. `.stage`를 뷰포트에 맞춰
`transform: scale()`로만 축소하므로 모든 좌표·타이포가 디자인 값 그대로다.

디자인 토큰(색, 그라디언트, 그림자, 타이포)은 `style.css` 상단 `:root`에 Figma 값 그대로 들어있다.
선택 상태 그라디언트 `--sel`, 그림자 `--sel-shadow` / `--sel-inner`가 Figma의 `직사각형_Selected` 스타일.

## 모션

- 화면 전환: 크로스페이드 + 미세 스케일
- 진입: `[data-anim]` 요소가 `--i` 순서대로 stagger fade-up
- 선택: 흰 카드 → 레드 그라디언트 크로스페이드 + 스케일 팝 + inner glow.
  Assist Mode는 디폴트 아트와 그라디언트가 구워진 선택 아트를 교체한다
- Injury check: 실루엣 클립 재생, 바닥 링 펄스, 좌우 축 아이콘 왕복, 마커 펄스.
  **부위 좌표는 미리 노출하지 않는다** — 탭 영역은 투명하고, 고른 부위에만 마커가 뜬다
- 팩 제안: 중앙 카드 부유, 양옆 고스트 카드 드리프트
- 프로젝터 앰비언스: 상단 빔 + 미세 플리커
- `prefers-reduced-motion` 존중

## Newton 앱 프로토타입과 공유하는 것

같은 디자인 시스템을 쓰는 [figma-prototype](https://github.com/dab2n/figma-prototype)에서
이미 개발된 규칙을 그대로 가져왔다 (원본은 읽기만 했고 아무것도 바꾸지 않았다):

- **체크 배지** — `assets/check-circle.png`. 에셋이 그림자를 투명 여백으로 갖고 있어
  52px 박스가 28px 원을 그린다. 모든 카드(Location·Today's Goal·Condition·Assist Mode)에
  일관되게 붙고, 난이도 세그먼트와 부위 칩에는 붙지 않는다
- **선택 토글 방식** — 한 번 더 누르면 해제. 단일 선택 그룹도 라디오처럼 동작하되 끌 수 있다
- **Assist Mode 선택 그림자** — 라이브러리의 58px/10px 그림자는 작은 카드에서 회색 띠로 보여서
  앱과 같이 `0 5px 14px rgba(0,0,0,.10)` + 흰 inner glow로 좁혔다. 선택되면 Recommended
  배지 자리를 체크가 대신한다
- **Next 활성화** — 답이 채워지기 전엔 Neutral/500, 채워지면 화이트
- **신체 부위 좌표** — 앱의 `injury-map`에 있는 값(312×554 기준)을 그대로 정규화해서 썼다.
  같은 클립이라 두 프로토타입이 어긋나지 않는다

## 폰트

- 본문 전체 **Supreme** (Fontshare)
- 큰 분(minute) 숫자만 **OffBit Trial Dot Bold** — Figma에서 지정한 그 스타일 하나만 쓴다.
  `assets/fonts/OffBitTrial-DotBold.otf`로 번들되어 있다. 트라이얼 폰트이므로 배포 전
  라이선스 확인 필요.

## 알려진 차이

- 실루엣 부위 좌표(`PARTS`)는 클립의 한 프레임 기준 고정값이다. 영상 속 인물이 움직이므로
  팔·다리가 크게 움직이는 구간에서는 마커가 살짝 어긋난다.
- 아이콘 중 북마크·공유는 인라인 SVG, 나머지(체크·신발/맨발·바닥 링·화살표·±·뒤로·셰브론)는
  전달받은 에셋 또는 Figma 내보내기.
- 프로젝션-터치 환경이라 **호버 애니메이션은 전부 제거**했다 (우측 하단 컬러 패널은 개발용
  크롬이라 예외).
