# 2026_gis_threejs_claude

토이 프로젝트 — Claude Code로 만든 GIS 실시간 위치 공유 서비스

## 소개

MapLibre GL JS로 3D 지형 지도를 띄우고, Socket.IO로 여러 사용자의 실시간 위치를 지도 위 마커로 공유합니다. three.js 커스텀 레이어로 지도 위에 3D 모델(버스 등)을 지형 고도에 맞춰 배치하고, 마우스 오버 시 파란색 외곽선(OutlinePass)으로 하이라이트합니다. 서울시 버스 실시간 위치 공공 API를 서버에서 프록시해 지도에 연동하는 작업을 진행 중입니다.

**주요 기능**
- MapLibre GL JS 기반 3D 지형(terrain) 지도, 좌측 상단에 마우스 좌표/지도 회전각·기울기/줌/FPS 표시
- Socket.IO를 통한 사용자 실시간 위치 공유 (Geolocation API)
- three.js 커스텀 레이어로 지도 위에 3D 모델 렌더링, 모델 위에 이름 라벨(DOM) 표시
- 마우스 오버 시 `OutlinePass` 기반 파란색 외곽선 하이라이트 (지도/다른 레이어를 가리지 않도록 덧셈 블렌딩으로 직접 합성)
- 서버가 서울시 버스 실시간 위치 공공 API(`ws.bus.go.kr`)를 프록시(`/api/bus-position`) — 서비스키는 서버에만 보관하고 브라우저에는 노출하지 않음
- 클라이언트에서 믹스인(`BusApiMixin`)을 명시적으로 섞은 컴포넌트만 이 API를 주기적으로 폴링하도록 구성 (믹스인을 안 섞으면 호출 자체가 발생하지 않음)

## 기술 스택

- Node.js + Express (서버, 정적 파일 서빙 + `/api` 프록시 라우터)
- Socket.IO (실시간 위치 동기화)
- MapLibre GL JS (지도)
- three.js (3D 모델 렌더링 — GLTFLoader/OBJLoader+MTLLoader, InstancedMesh, 포스트프로세싱 OutlinePass)
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

### 환경변수 (.env)

서울시 버스 실시간 위치 API를 쓰려면 프로젝트 루트에 `.env` 파일을 만들고 서비스키를 넣어야 합니다 (`.env`는 gitignore되어 있어 커밋/배포 산출물에 포함되지 않습니다).

```
SEOUL_BUS_API_KEY=발급받은_서비스키
```

`.env`가 없어도 서버는 죽지 않고 경고만 찍고 계속 뜹니다(배포 환경에서 환경변수를 플랫폼이 직접 주입하는 경우를 고려한 동작). 다만 이 경우 버스 위치 API 호출은 인증 실패로 응답합니다.

## 배포용 빌드

```bash
npm run build
```

`build.js`가 하는 일:
- `public/`(3D 모델, 이미지 등 정적 자산)을 `dist/public/`으로 복사
- `src/index.html`을 `dist/public/index.html`로 복사
- `src/app.js`와 그 안에서 import하는 `component/`, `base/`, `effect/`, `mixin/` 하위 소스를 esbuild로 하나의 파일로 번들링·최소화·ES2020 트랜스파일해 `dist/public/app.js`로 생성 (소스맵 포함)
  - `three`, `three/addons/*`는 npm 패키지가 아니라 `index.html`의 importmap으로 CDN에서 로드하므로 번들에서 제외(external)
- `server.js`, `router.js`(서버 API 라우터)를 `dist/`로 복사
- 런타임 의존성만 포함한 프로덕션용 `package.json`을 `dist/`에 생성 (`maplibre-gl`처럼 브라우저 CDN으로만 쓰는 패키지는 제외)

```bash
cd dist
npm install --omit=dev
npm start
```

## 프로젝트 구조

```
src/                          # 프론트엔드 소스 (개발 서버가 정적 루트로 서빙)
  index.html                   # 진입 페이지, importmap(three/maplibre-gl)
  app.js                        # 지도 초기화, 모델 배치, 드래그 이동, 좌표/FPS 표시, 실시간 위치 마커
  base/
    BaseModel.js                 # 3D 모델 레이어 공통 베이스 클래스 (카메라/씬/조명/렌더러/호버 아웃라인 초기화,
                                  # 좌표 변환·라벨 위치 계산, 캔버스 리사이즈 대응)
  component/
    bus_g7.js                    # BUS_G7 — BaseModel 상속, OBJ/MTL 버스 모델 레이어
    airport_1terminal.js         # RabbitModel — BaseModel 상속, 고정 위치 GLTF 모델 레이어
    airplain.js                  # KoreanAirModel — BaseModel 상속, InstancedMesh 비행기 편대 레이어
    modelLabel.js                # 모델 위에 뜨는 이름 라벨(DOM)
  effect/
    hoverOutline.js               # OutlinePass 기반 마우스오버 외곽선 헬퍼
  mixin/
    api.js                        # BusApiMixin — /api/bus-position을 주기적으로 폴링하는 클라이언트 믹스인
public/                        # 정적 자산 (개발 서버가 src/와 함께 같은 루트로 서빙)
  modeling/                      # 3D 모델 리소스 (GLTF, OBJ/MTL 등)
  images/
server.js                     # Express + Socket.IO 서버, src/·public/ 정적 서빙 + /api 라우터 마운트
router.js                     # /api 라우터 — 서울시 버스 위치 API 프록시(서비스키는 서버에만 보관)
build.js                      # esbuild 기반 배포용 빌드 스크립트
```

## 현재 지도에 표시되는 모델

`app.js`에는 현재 버스 모델(`BUS_G7`)만 실제로 지도에 추가되어 있습니다(`RabbitModel`/`KoreanAirModel`은 컴포넌트로 구현되어 있지만 현재 `app.js`에서 사용하지 않는 상태입니다). 버스는 클릭 후 드래그로 위치를 옮길 수 있고(Shift+드래그는 고도 조정), `BusApiMixin`을 통해 5초 주기로 `/api/bus-position`을 폴링해 콘솔에 로그를 남기도록 연결되어 있습니다(아직 실제 좌표로 모델을 움직이는 연결은 하지 않았습니다).
