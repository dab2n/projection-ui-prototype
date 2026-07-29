# Projection UI — 웹 프로토타입

Figma `2026 개인 / UI` 섹션의 프로젝션 온보딩 플로우를 웹으로 옮긴 인터랙티브 프로토타입.
빌드 없음, 의존성 없음 — `index.html` / `style.css` / `app.js` 세 파일.

원본: [Figma 파일](https://www.figma.com/design/lTomHBHHNWFzzYtoGEL5Zt/2026-%EA%B0%9C%EC%9D%B8?node-id=2312-1311)

## 실행

```bash
python3 -m http.server 5555
# http://localhost:5555
```

localhost에서 열면 `index.html` / `style.css` / `app.js`의 `Last-Modified`를 1초마다 폴링해
자동 새로고침한다. 파일 저장하면 브라우저에 바로 반영됨.

자체 점검: `http://localhost:5555/index.html?selftest` → 콘솔에 PASS/FAIL 5줄.

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
- 카드·칩 클릭 → 선택 상태 전환 (Injury check만 다중 선택, "None"은 배타적)
- **Injury check**: 칩으로도, 실루엣 위의 부위를 직접 눌러서도 선택된다. 선택된 부위에는
  `신체 영역` 마커가 올라간다
- **팩 시청**: 오른쪽 정보 영역은 스크롤된다 (Figma에서 프레임으로 표시해둔 360×221 뷰포트, 콘텐츠 860)
- Main workout의 `−` `+` → 라운드 수와 Total 분이 함께 변함
- URL 해시로 특정 화면 직접 열기 (`#level` 등)

## 프로젝션 배경색 테스트

이 UI는 웹이 아니라 **흰 책상 위에 투사**되는 것이 최종 형태라, 배경색은 실제 환경에
올려보고 정해야 하는 값이다. 우측 하단 패널(Figma 컬러 피커와 같은 SV 사각형 + 색상 슬라이더
+ HEX + 프리셋)로 프레임 배경을 실시간으로 바꿔볼 수 있다.

프리셋: Design default(#141414) · Neutral/Black · Neutral/800 · White desk · Warm desk · Wood desk.
헤더의 `–`로 접힌다. 배경은 `--bg` 하나만 바꾸므로 나머지 토큰은 그대로다.

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
- 선택: 흰 카드 → 레드 그라디언트 크로스페이드 + 스케일 팝 + inner glow
- Injury check: 인물 호흡, 바닥 링 펄스, 좌우 축 아이콘 왕복
- 팩 제안: 중앙 카드 부유, 양옆 고스트 카드 드리프트
- 프로젝터 앰비언스: 상단 빔 + 미세 플리커
- `prefers-reduced-motion` 존중

## 폰트

- 본문 전체 **Supreme** (Fontshare)
- 큰 분(minute) 숫자만 **OffBit Trial Dot Bold** — Figma에서 지정한 그 스타일 하나만 쓴다.
  `assets/fonts/OffBitTrial-DotBold.otf`로 번들되어 있다. 트라이얼 폰트이므로 배포 전
  라이선스 확인 필요.

## 알려진 차이

- Assist Mode 카드의 `plus-lighter` 틴트는 브라우저와 Figma의 블렌드 공간 차이로 Load/Boost가
  Figma보다 약간 어둡게 나온다.
- 실루엣 부위 좌표(`PARTS`)는 클립의 한 프레임 기준 고정값이다. 영상 속 인물이 움직이므로
  팔·다리가 크게 움직이는 구간에서는 마커가 살짝 어긋난다.
- 아이콘 중 체크·북마크·공유는 인라인 SVG, 나머지(발자국·바닥 링·화살표·±·뒤로·셰브론)는
  Figma 내보내기 에셋.
