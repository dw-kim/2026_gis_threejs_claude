# 2026_gis_threejs_claude

토이 프로젝트 — Claude Code로 만든 GIS 3D 모델 연동 서비스

## 소개

MapLibre GL JS로 3D 지형 지도를 띄우고, three.js 커스텀 레이어로 지도 위에 3D 버스 모델을 지형 고도에 맞춰 배치합니다. 버스 한 대는 정해진 경로(좌표 목록)를 순환하며 이동하고, 100대의 버스 편대는 기준 위치 주변을 랜덤하게 돌아다닙니다. 두 그룹 모두 서로 부딪히지 않도록 충돌 회피/정지 로직이 붙어 있고, 마우스 오버 시 파란색 외곽선(OutlinePass)으로 하이라이트됩니다. 서울시 버스 실시간 위치 공공 API를 서버에서 프록시해 지도에 연동하는 작업을 진행 중입니다.

**주요 기능**
- MapLibre GL JS 기반 3D 지형(terrain) 지도, 좌측 상단에 마우스 좌표/지도 회전각·기울기/줌/FPS 표시
- three.js 커스텀 레이어로 지도 위에 3D 모델 렌더링, 모델 위에 이름 라벨(DOM) + 이동/정지 상태 점(녹색/빨간색) 표시
- **단일 버스(`BUS_G7`)**: 미리 정의한 경로(`shuttlePoints`)를 순서대로 따라가다 마지막 지점에서 다시 처음으로 돌아가는 순환 이동 — 정해진 시간이 아니라 실제로 그 좌표에 "도착한 시점"에 다음 좌표로 넘어감 (지도 클릭으로 목적지를 지정하는 기능도 구현돼 있으나 현재 코드에서 비활성화된 상태)
- **버스 편대(`BusFleet`, 100대)**: 기준 위치 주변에서 일정 주기로 랜덤한 목표 지점을 골라 이동. 서로 가까워지면 밀어내는 방향을 진행 방향에 섞어 충돌을 피하고(separation steering), 목표에 도착했거나 회피끼리 상쇄돼 멈춘 지 3초가 지나면 대기하지 않고 바로 새 목표를 골라 다시 움직임
- **버스 ↔ 편대 상호 회피**: 편대 버스들은 경로를 도는 단일 버스도 장애물로 보고 피해가고, 반대로 단일 버스는 편대 버스와 일정 거리 안으로 가까워지면 이동을 잠시 멈췄다가 거리가 벌어지면 멈췄던 지점부터 다시 출발
- 경로 지점마다 순번이 적힌 아이콘을 지도에 표시 — `maplibregl.Marker`가 아니라 커스텀 레이어로 직접 투영해서, MapLibre의 지형 고도 재조회 버그로 인한 카메라 회전 시 흔들림 없이 GPS 좌표에 고정되어 보임
- **오른쪽 버스 정보 패널**: 단일 버스 + 편대 버스 전체(101행)를 표(라벨명/Lng/Lat)로 표시하고, 맨 앞 열에 이동/정지 상태를 점(녹색/빨간색)으로 표시. 행을 클릭하면 그 버스 위치로 줌 20까지 이동한 뒤 카메라가 계속 따라가고, 같은 행을 다시 클릭하면 추적 해제
- **스페이스바**를 누르고 있는 동안 카메라가 단일 버스 위치에 고정되고, 떼면 해제
- 마우스 오버 시 `OutlinePass` 기반 파란색 외곽선 하이라이트 (지도/다른 레이어를 가리지 않도록 덧셈 블렌딩으로 직접 합성)
- 서버가 서울시 버스 실시간 위치 공공 API(`ws.bus.go.kr`)를 프록시(`/api/bus-position`) — 서비스키는 서버에만 보관하고 브라우저에는 노출하지 않음
- 클라이언트에서 믹스인(`BusApiMixin`)을 명시적으로 섞은 컴포넌트만 이 API를 주기적으로 폴링하도록 구성 (믹스인을 안 섞으면 호출 자체가 발생하지 않음)

## 기술 스택

- Node.js + Express (서버, 정적 파일 서빙 + `/api` 프록시 라우터)
- MapLibre GL JS (지도)
- three.js (3D 모델 렌더링 — GLTFLoader/OBJLoader+MTLLoader, 포스트프로세싱 OutlinePass)
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
  app.js                        # 지도 초기화, 버스/버스 편대 배치, 클릭 이동/경로 순환/충돌 회피,
                                  # 카메라 고정, 경로 아이콘, 좌표/FPS 표시
  base/
    BaseModel.js                 # 3D 모델 레이어 공통 베이스 클래스 (카메라/씬/조명/렌더러/호버 아웃라인 초기화,
                                  # 좌표 변환·라벨 위치 계산, 캔버스 리사이즈 대응)
  component/
    bus_g7.js                    # BUS_G7 — BaseModel 상속, OBJ/MTL 단일 버스 모델 레이어 (현재 지도에서 쓰는 모델)
    busFleet.js                  # BusFleet — 버스 여러 대를 각자 전용 투영행렬로 순서대로 그리는 편대 레이어.
                                  # separation steering으로 서로/단일 버스와 충돌을 피하고, 멈춘 지 3초가
                                  # 지나면 자동으로 새 목표를 골라 재출발한다 (현재 지도에서 쓰는 편대)
    routePointIcons.js           # 경로 지점(GPS 좌표)마다 순번 아이콘을 고정 표시하는 커스텀 레이어
                                  # (maplibregl.Marker 대신 직접 투영해 지형 고도 버그로 인한 흔들림을 피함)
    modelLabel.js                # 모델 위에 뜨는 이름 라벨(DOM) + 이동/정지 상태 점
    carm.js                      # CarModel — BaseModel 상속, 단일 GLTF 자동차 모델 레이어 (현재 미사용)
    carFleet.js                  # CarFleet — 자동차 편대 레이어, busFleet.js와 같은 패턴 (현재 미사용)
    airport_1terminal.js         # RabbitModel — BaseModel 상속, 고정 위치 GLTF 모델 레이어 (현재 미사용)
    airplain.js                  # KoreanAirModel — InstancedMesh 비행기 편대 레이어 (현재 미사용)
  effect/
    hoverOutline.js               # OutlinePass 기반 마우스오버 외곽선 헬퍼
  mixin/
    api.js                        # BusApiMixin — /api/bus-position을 주기적으로 폴링하는 클라이언트 믹스인
public/                        # 정적 자산 (개발 서버가 src/와 함께 같은 루트로 서빙)
  modeling/                      # 3D 모델 리소스 (GLTF, OBJ/MTL 등)
  images/
server.js                     # Express 서버, src/·public/ 정적 서빙 + /api 라우터 마운트
router.js                     # /api 라우터 — 서울시 버스 위치 API 프록시(서비스키는 서버에만 보관)
build.js                      # esbuild 기반 배포용 빌드 스크립트
```

## 현재 지도에 표시되는 모델

`app.js`에는 현재 단일 버스(`BUS_G7`, `busLayer`)와 버스 편대(`BusFleet`, `busFleetLayer`, 100대)가 함께 지도에 추가되어 있습니다.

- 단일 버스는 `shuttlePoints` 경로를 순서대로 순환하며 진행 방향으로 회전합니다(지도 클릭 이동 기능은 구현돼 있으나 현재는 꺼져 있습니다). 경로 지점마다 순번 아이콘(`RoutePointIcons`)이 표시됩니다.
- 버스 편대는 기준 위치 주변에서 랜덤한 목표를 골라 계속 움직이며, 서로 및 단일 버스와 부딪히지 않도록 회피 조향이 적용되어 있습니다.
- 화면 오른쪽의 버스 정보 패널에서 원하는 버스 행을 클릭하면 그 버스를 줌 20으로 따라가고, 모든 버스 라벨과 패널 행에는 이동 중(녹색)/정지(빨간색) 상태 점이 표시됩니다.
- 스페이스바를 누르고 있으면 카메라가 단일 버스 위치를 따라갑니다.
- `BusApiMixin`을 통해 5초 주기로 `/api/bus-position`을 폴링해 콘솔에 로그를 남기도록 연결되어 있습니다(아직 실제 좌표로 모델을 움직이는 연결은 하지 않았습니다).

`CarModel`/`CarFleet`/`RabbitModel`/`KoreanAirModel`은 컴포넌트로 구현되어 있지만 현재 `app.js`에서 사용하지 않는 상태입니다.
