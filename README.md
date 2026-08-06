# 2026_gis_threejs_claude

토이 프로젝트 — Claude Code로 만든 GIS 3D 모델 연동 서비스

## 소개

MapLibre GL JS로 3D 지형 지도를 띄우고, three.js 커스텀 레이어로 지도 위에 서울시 버스 실시간 위치 공공 API 데이터를 3D 버스 모델로 시각화합니다. 오른쪽 드롭다운에서 버스 노선을 고르면 그 노선의 실시간 버스 위치를 주기적으로 조회해, 응답에 들어있는 버스 수만큼 모델을 만들고 위치가 바뀔 때마다 순간이동이 아니라 부드럽게 이동하도록 애니메이션합니다.

**주요 기능**
- MapLibre GL JS 기반 3D 지형(terrain) 지도, 좌측 상단에 마우스 좌표/지도 회전각·기울기/줌/FPS 표시
- **노선 선택 드롭다운**: `public/json/bus_routeid.json`(노선명/ROUTEID 723개 목록)을 읽어 채우고, 고른 노선으로 실시간 위치 조회를 시작/전환. 노선을 바꾸면 이전 노선의 버스를 화면과 패널에서 모두 정리
- **실시간 버스 시각화(`LiveBusFleet`)**: 서울시 버스 위치 API 응답(itemList)의 버스 수만큼 3D 모델을 그리고, 새 응답이 올 때마다 `plainNo`(차량 번호판)를 키로 기존 버스는 재사용(위치만 갱신)하고 없어진 버스는 정리. 위치가 바뀌면 그 자리로 순간이동하지 않고 API 호출 주기(기본 10초)에 맞춰 그 시간 동안 부드럽게 이동 + 진행 방향으로 회전
- **이동/정지 상태 표시**: API의 `stopFlag`(정류소 정차 여부)가 아니라 직전 좌표와 새 좌표의 실제 거리 차이(3m 초과)로 이동 여부를 직접 계산해, 모델 위 라벨과 오른쪽 패널의 점(녹색=이동, 빨간색=정지)이 항상 같은 기준으로 표시되도록 함. 처음 나타난 버스는 기본값으로 이동 중(녹색)으로 시작
- **오른쪽 버스 정보 패널**: 현재 조회 중인 노선의 버스 전체를 표(상태점/차량번호/Lng/Lat)로 표시하고, `plainNo` 기준으로 행을 재사용해 갱신. 행을 클릭하면 그 버스 위치로 줌 20까지 이동한 뒤 카메라가 계속 따라가고, 같은 행을 다시 클릭하면 추적 해제 (줌 전환은 `map.jumpTo()`를 매 프레임 호출하는 팔로우 루프와 함께 동작해야 해서 `easeTo` 대신 직접 rAF로 보간)
- 마우스 오버 시 `OutlinePass` 기반 파란색 외곽선 하이라이트 (지도/다른 레이어를 가리지 않도록 덧셈 블렌딩으로 직접 합성)
- 서버가 서울시 버스 실시간 위치 공공 API(`ws.bus.go.kr`)를 프록시(`/api/bus-position`) — 서비스키는 서버에만 보관하고 브라우저에는 노출하지 않음
- 클라이언트에서 믹스인(`BusApiMixin`)을 명시적으로 섞은 컴포넌트만 이 API를 주기적으로 폴링하도록 구성 (믹스인을 안 섞으면 호출 자체가 발생하지 않음)

## 기술 스택

- Node.js + Express (서버, 정적 파일 서빙 + `/api` 프록시 라우터)
- MapLibre GL JS (지도)
- three.js (3D 모델 렌더링 — OBJLoader+MTLLoader, 포스트프로세싱 OutlinePass)
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
- `public/`(3D 모델, 이미지, 노선 목록 JSON 등 정적 자산)을 `dist/public/`으로 복사
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
  index.html                   # 진입 페이지, importmap(three/maplibre-gl), 노선 드롭다운 + 버스 패널 마크업
  app.js                        # 지도 초기화, 노선 드롭다운/API 폴링 전환, 버스 정보 패널, 카메라 팔로우,
                                  # 좌표/FPS/컴퍼스 표시
  base/
    BaseModel.js                 # 3D 모델 레이어 공통 베이스 클래스 (카메라/씬/조명/렌더러/호버 아웃라인 초기화,
                                  # 좌표 변환·라벨 위치 계산, 캔버스 리사이즈 대응)
  component/
    liveBusFleet.js              # LiveBusFleet — 서울시 버스 위치 API 응답으로 버스를 그리는 레이어.
                                  # plainNo를 키로 버스별 Object3D/라벨을 관리하고, 위치 갱신 시 부드럽게
                                  # 이동하도록 보간한다 (현재 지도에서 쓰는 컴포넌트)
    modelLabel.js                # 모델 위에 뜨는 이름 라벨(DOM) + 이동/정지 상태 점
    bus_g7.js                    # BUS_G7 — OBJ/MTL 단일 버스 모델 레이어 (현재 미사용, 예전 클릭 이동 버전)
    busFleet.js                  # BusFleet — 랜덤 이동 + 충돌 회피 버스 편대 레이어 (현재 미사용, 예전 버전)
    routePointIcons.js           # 경로 지점(GPS 좌표)마다 순번 아이콘을 고정 표시하는 커스텀 레이어
                                  # (현재 미사용, shuttlePoints 경로 기반 버전에서 쓰던 컴포넌트)
    carm.js                      # CarModel — 단일 GLTF 자동차 모델 레이어 (현재 미사용)
    carFleet.js                  # CarFleet — 자동차 편대 레이어 (현재 미사용)
    airport_1terminal.js         # RabbitModel — 고정 위치 GLTF 모델 레이어 (현재 미사용)
    airplain.js                  # KoreanAirModel — InstancedMesh 비행기 편대 레이어 (현재 미사용)
  effect/
    hoverOutline.js               # OutlinePass 기반 마우스오버 외곽선 헬퍼
  mixin/
    api.js                        # BusApiMixin — /api/bus-position을 주기적으로 폴링하는 클라이언트 믹스인
                                  # (plainNo/tmX/tmY/stopFlag 등 실제 API 응답 필드로 파싱)
public/                        # 정적 자산 (개발 서버가 src/와 함께 같은 루트로 서빙)
  modeling/                      # 3D 모델 리소스 (GLTF, OBJ/MTL 등)
  images/
  json/
    bus_routeid.json             # 노선명/ROUTEID 목록 (드롭다운 데이터 소스)
server.js                     # Express 서버, src/·public/ 정적 서빙 + /api 라우터 마운트
router.js                     # /api 라우터 — 서울시 버스 위치 API 프록시(서비스키는 서버에만 보관)
build.js                      # esbuild 기반 배포용 빌드 스크립트
```

## 현재 지도에 표시되는 모델

`app.js`는 페이지가 뜨면 `/json/bus_routeid.json`을 불러와 오른쪽 패널 위 드롭다운을 채우고, 목록의 첫 노선으로 바로 실시간 조회를 시작합니다.

- `LiveBusFleet` 레이어가 API 응답(itemList) 개수만큼 버스 모델을 그리고, 10초마다 위치를 다시 조회해 그 시간에 맞춰 부드럽게 이동시킵니다.
- 드롭다운에서 다른 노선을 고르면 이전 노선의 버스가 화면과 패널에서 모두 사라지고 새 노선으로 전환됩니다.
- 오른쪽 버스 정보 패널에서 원하는 버스 행을 클릭하면 그 버스를 줌 20으로 따라가고, 모든 버스 라벨과 패널 행에는 실제 이동 거리 기반의 이동 중(녹색)/정지(빨간색) 상태 점이 표시됩니다.

`BUS_G7`/`BusFleet`/`RoutePointIcons`(예전 shuttlePoints 경로·랜덤 이동 버전)와 `CarModel`/`CarFleet`/`RabbitModel`/`KoreanAirModel`은 컴포넌트로 구현되어 있지만 현재 `app.js`에서 사용하지 않는 상태입니다.
