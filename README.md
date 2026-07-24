# 2026_gis_threejs_claude

토이 프로젝트 — Claude Code로 만든 GIS 실시간 위치 공유 서비스

## 소개

MapLibre GL JS로 3D 지형 지도를 띄우고, Socket.IO로 여러 사용자의 실시간 위치를 지도 위 마커로 공유합니다. three.js 커스텀 레이어를 이용해 지도 위에 3D 모델(GLTF, 공항)을 지형 고도에 맞춰 배치합니다.

**주요 기능**
- MapLibre GL JS 기반 3D 지형(terrain) 지도
- Socket.IO를 통한 사용자 실시간 위치 공유 (Geolocation API)
- three.js 커스텀 레이어로 지도 위에 3D GLTF 모델(공항) 렌더링
- 마우스 드래그로 3D 모델 위치/고도 조정

## 기술 스택

- Node.js + Express (서버)
- Socket.IO (실시간 위치 동기화)
- MapLibre GL JS (지도)
- three.js (3D 모델 렌더링)
- Vanilla JS (프론트엔드, 별도 번들러 없음 — `<script type="module">` + import map 사용)

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

`dist/` 폴더에 정적 자산(`public/`)과 `server.js`, 프로덕션용 `package.json`이 생성됩니다.

```bash
cd dist
npm install --omit=dev
npm start
```

## 프로젝트 구조

```
public/
  index.html        # 진입 페이지
  app.js            # 지도 초기화, 실시간 위치, 3D 모델 레이어
  modeling/airport/ # 3D 모델(GLTF) 리소스
server.js            # Express + Socket.IO 서버
build.js              # dist/ 배포용 빌드 스크립트
```
