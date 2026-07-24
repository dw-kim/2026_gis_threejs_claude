# 2026_gis_threejs_claude

토이 프로젝트 — Claude Code로 만든 GIS 실시간 위치 공유 서비스

## 소개

MapLibre GL JS로 3D 지형 지도를 띄우고, Socket.IO로 여러 사용자의 실시간 위치를 지도 위 마커로 공유합니다. three.js 커스텀 레이어를 이용해 지도 위에 3D GLTF 모델(토끼, 대한항공 비행기 편대)을 지형 고도에 맞춰 배치하고, 마우스 오버 시 파란색 외곽선(OutlinePass)으로 하이라이트합니다.

**주요 기능**
- MapLibre GL JS 기반 3D 지형(terrain) 지도, 좌측 상단에 마우스 좌표/지도 회전각/FPS 표시
- Socket.IO를 통한 사용자 실시간 위치 공유 (Geolocation API)
- three.js 커스텀 레이어로 지도 위에 3D GLTF 모델 렌더링, 각 모델 위에 이름 라벨 표시
- 토끼 모델(`RabbitModel`): 고정 위치에 배치, 마우스 드래그로 위치/고도 조정 가능
- 대한항공 비행기 편대(`KoreanAirModel`): `THREE.InstancedMesh`로 수백 대를 한 번에 렌더링, 각자 주기적으로 랜덤한 목표 지점을 향해 비행
- 마우스 오버 시 `OutlinePass` 기반 파란색 외곽선 하이라이트 (지도/다른 레이어를 가리지 않도록 덧셈 블렌딩으로 직접 합성)

## 기술 스택

- Node.js + Express (서버)
- Socket.IO (실시간 위치 동기화)
- MapLibre GL JS (지도)
- three.js (3D 모델 렌더링, 포스트프로세싱)
- Vanilla JS (프론트엔드 — `<script type="module">` + import map으로 three.js/maplibre-gl 로드, 프레임워크 없음)
- esbuild (프로덕션 빌드 시에만 번들링/최소화/트랜스파일링, 개발 중에는 미사용)

## 실행 방법

```bash
# 의존성 설치
npm install

# 개발 서버 실행 (nodemon, 코드 변경 시 자동 재시작)
npm run dev

# 일반 서버 실행
npm start
```

서버가 뜨면 브라우저에서 http://localhost:3000 으로 접속합니다.

포트를 바꾸려면 `PORT` 환경변수를 지정합니다.

```bash
PORT=4000 npm start
```

## 배포용 빌드

```bash
npm run build
```

`build.js`가 하는 일:
- `public/`을 `dist/public/`으로 복사 (정적 자산 포함)
- `public/app.js`와 그 안에서 import하는 `component/*.js`, `effect/*.js`를 esbuild로 하나의 파일로 번들링·최소화·ES2020 트랜스파일해 `dist/public/app.js`로 생성 (소스맵 포함)
  - `three`, `three/addons/*`는 npm 패키지가 아니라 `index.html`의 importmap으로 CDN에서 로드하므로 번들에서 제외(external)
- 번들에 합쳐진 `component/`, `effect/` 원본 소스는 `dist`에서 정리
- `server.js`와 프로덕션용 `package.json`(런타임 의존성만 포함) 생성

```bash
cd dist
npm install --omit=dev
npm start
```

## 프로젝트 구조

```
public/
  index.html               # 진입 페이지, importmap(three/maplibre-gl)
  app.js                    # 지도 초기화, 드래그 이동, 좌표/FPS 표시, 실시간 위치 마커
  component/
    airport_1terminal.js    # RabbitModel — 고정 위치 3D 모델 레이어
    airplain.js              # KoreanAirModel — InstancedMesh 비행기 편대 레이어
    modelLabel.js             # 모델 위에 뜨는 이름 라벨(DOM)
  effect/
    hoverOutline.js           # OutlinePass 기반 마우스오버 외곽선 헬퍼
  modeling/airport/           # 3D 모델(GLTF) 리소스 (korean_rabbit, korean_air 등)
server.js                    # Express + Socket.IO 서버
build.js                      # esbuild 기반 배포용 빌드 스크립트
```
