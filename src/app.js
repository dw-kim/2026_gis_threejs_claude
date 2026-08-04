import BUS_G7 from './component/bus_g7.js';
import BusFleet from './component/busFleet.js';
import RoutePointIcons from './component/routePointIcons.js';
import BusApiMixin from './mixin/api.js';

// MapLibre 초기화
const map = new maplibregl.Map({
    container: 'map',
    style: {
        version: 8,
        sources: {
            'osm': {
                type: 'raster',
                tiles: [
                    'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png'
                ],
                tileSize: 256,
                maxzoom: 19, // 실제 타일은 19까지만 존재 → 그 이상은 자동으로 오버줌(확대)해서 재사용
                attribution: '&copy; OpenStreetMap Contributors'
            },
            'terrainSource': {
                type: 'raster-dem',
                url: 'https://tiles.mapterhorn.com/tilejson.json'
            }
        },
        layers: [
            {
                id: 'osm-layer',
                type: 'raster',
                source: 'osm'
                // 레이어 자체의 maxzoom은 "이 줌부터 레이어를 안 그림"을 뜻하므로
                // 지정하지 않는다 (지정 시 그 줌 이상에서 지도가 하얗게 사라짐).
            }
        ],
        terrain: {
            source: 'terrainSource',
            exaggeration: 0
        },
        sky: {}
    },
    center: [126.925116, 37.557961],
    zoom: 20.5,
    pitch: 66.9,
    bearing: -35.2,
    maxPitch: 85
});

map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }));
map.addControl(new maplibregl.TerrainControl({ source: 'terrainSource' }));

// 버스 초기 위치
const modelOrigin = [126.925116, 37.557961];

// 버스(G7) 모델 배치, modelOrigin을 그대로 써서 클릭 이동에 반영
const busLayer = new BUS_G7(map, {
    origin: modelOrigin,
    rotate: [Math.PI / 2, 0, 0],
    elevationOffset: 1,
    scaleMultiplier: 1
});

// 버스 여러 대를 기준 위치 근처에서 5초마다 랜덤 이동시킨다.
// (InstancedMesh가 아니라 단일 버스와 같은 방식으로 한 대씩 순서대로 그리는데,
// 버스 OBJ는 서브메시가 40개가 넘어 대수를 늘리면 프레임당 draw call이 급격히
// 늘어난다. 자동차 편대는 500대로 실험했었지만 버스는 무거우니 10대로 낮췄다.)
const busFleetLayer = new BusFleet(map, {
    origin: modelOrigin,
    count: 100,
    rotateOffset: [Math.PI / 2, 0, 0],
    elevationOffset: 1,
    scaleMultiplier: 1,
    // 경로를 따라 움직이는 단일 버스(busLayer)도 장애물로 보고 피해간다.
    getExternalObstacles: () => [modelOrigin]
});

map.on('load', () => {
    map.addLayer(busLayer);
    map.addLayer(busFleetLayer);
});

// 정지 상태의 기본 방향은 모델 좌표계 보정값이라, 진행 방향 회전에도 그대로 더해준다.
const busBaseYawOffset = busLayer.rotate[1];
// 이동 중 진행 방향 회전만 따로 보정이 필요할 때 추가로 더해주는 값 (필요시 조정).
const busMoveYawCorrection = 0;
let busHeading = 0; // 현재 heading(라디안). rotate[1] = busHeading * -1 + busBaseYawOffset
let busHeadingAnimationId = null;

function normalizeAngleDiff(diff) {
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    return diff;
}

// 목표 heading까지 순간적으로 꺾지 않고 1초에 걸쳐 부드럽게(최단 경로로) 회전한다.
function rotateBusTowards(targetHeading, durationMs = 1000) {
    if (busHeadingAnimationId !== null) {
        cancelAnimationFrame(busHeadingAnimationId);
    }

    const startHeading = busHeading;
    const diff = normalizeAngleDiff(targetHeading - startHeading);
    const startTime = performance.now();

    function step(now) {
        const t = Math.min(1, (now - startTime) / durationMs);
        busHeading = startHeading + diff * t;

        busLayer.rotate[1] = busHeading * -1 + busBaseYawOffset + busMoveYawCorrection;
        map.triggerRepaint();

        if (t < 1) {
            busHeadingAnimationId = requestAnimationFrame(step);
        } else {
            busHeadingAnimationId = null;
        }
    }

    busHeadingAnimationId = requestAnimationFrame(step);
}

function updateBusHeadingTowards(fromLng, fromLat, toLng, toLat) {
    const latMetersPerDeg = 111320;
    const lngMetersPerDeg = 111320 * Math.cos(fromLat * Math.PI / 180);
    const dx = (toLng - fromLng) * lngMetersPerDeg;
    const dy = (toLat - fromLat) * latMetersPerDeg;

    if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return;

    const targetHeading = Math.atan2(dx, dy);
    rotateBusTowards(targetHeading, 1000);
}

// BusApiMixin을 명시적으로 섞은 컴포넌트만 (서울시) 버스 위치 API를 호출한다.
// (믹스인을 적용하지 않으면 startBusPositionPolling 자체가 없어 호출이 전혀 일어나지 않는다)
// 화면의 버스 모델과는 별개로, 실제 버스 위치 데이터 자체를 계속 폴링해본다.
Object.assign(BUS_G7.prototype, BusApiMixin);
busLayer.startBusPositionPolling({
    busRouteId: '113900012',
    onUpdate: (positions) => {
        console.log('버스 위치:', positions);
    }
});

// 지도를 클릭하면 그 위치까지 항상 정해진 시간에 걸쳐 이동 (거리와 상관없이 소요 시간 고정)
// 이동속도 10배 느리게(1/10) 조정: 3초 -> 30초
const BUS_MOVE_DURATION_MS = 10000;
const BUS_COLLISION_RADIUS_M = 15; // 편대 버스와 이 거리(m) 안으로 가까워지면 잠시 멈춘다
let busMoveAnimationId = null;
let isSingleBusMoving = false; // 버스 정보 패널의 상태 표시(녹색/빨간색)에 쓰인다

// busFleetLayer 소속 버스 중 하나라도 modelOrigin과 이 거리 안에 있는지 확인한다.
function isBusNearFleet() {
    const latMetersPerDeg = 111320;
    const lngMetersPerDeg = 111320 * Math.cos(modelOrigin[1] * Math.PI / 180);

    return busFleetLayer.buses.some((bus) => {
        const dx = (modelOrigin[0] - bus.position[0]) * lngMetersPerDeg;
        const dy = (modelOrigin[1] - bus.position[1]) * latMetersPerDeg;
        return Math.sqrt(dx * dx + dy * dy) < BUS_COLLISION_RADIUS_M;
    });
}

function moveBusTo(targetLngLat, durationMs = BUS_MOVE_DURATION_MS, onArrive) {
    if (busMoveAnimationId !== null) {
        cancelAnimationFrame(busMoveAnimationId);
    }

    const startLng = modelOrigin[0];
    const startLat = modelOrigin[1];
    const endLng = targetLngLat.lng;
    const endLat = targetLngLat.lat;

    updateBusHeadingTowards(startLng, startLat, endLng, endLat);

    // 진행률(t)을 실제 경과 시간(elapsedMs)으로 직접 누적한다. 편대 버스와
    // 충돌 반경 안에 있는 동안은 elapsedMs를 늘리지 않아서, t가 그 자리에서
    // 멈춘 것처럼 보이다가(정지) 반경을 벗어나면 멈췄던 지점부터 그대로
    // 이어서 진행한다(재출발).
    let elapsedMs = 0;
    let lastTime = performance.now();

    function step(now) {
        const dt = now - lastTime;
        lastTime = now;

        const nearFleet = isBusNearFleet();
        isSingleBusMoving = !nearFleet;
        if (!nearFleet) {
            elapsedMs += dt;
        }

        const t = Math.min(1, elapsedMs / durationMs);
        modelOrigin[0] = startLng + (endLng - startLng) * t;
        modelOrigin[1] = startLat + (endLat - startLat) * t;
        map.triggerRepaint();

        if (t < 1) {
            busMoveAnimationId = requestAnimationFrame(step);
        } else {
            busMoveAnimationId = null;
            isSingleBusMoving = false;
            if (onArrive) onArrive();
        }
    }

    busMoveAnimationId = requestAnimationFrame(step);
}

map.on('click', (e) => {
    // moveBusTo(e.lngLat, BUS_MOVE_DURATION_MS);
});

// 버스가 아래 경로(shuttlePoints)를 순서대로 따라가다가 마지막 지점에
// 도착하면 다시 첫 지점부터 반복한다.
const shuttlePoints = [
    { lng: 126.921468, lat: 37.555247 },
    { lng: 126.920576, lat: 37.556000 },
    { lng: 126.921441, lat: 37.556294 },
    { lng: 126.921832, lat: 37.556899 },
    { lng: 126.922311, lat: 37.556489 },
    { lng: 126.923643, lat: 37.557476 },
    { lng: 126.924342, lat: 37.558001 },
    { lng: 126.924894, lat: 37.558680 },
    { lng: 126.925168, lat: 37.558826 },
    { lng: 126.925570, lat: 37.558336 }
];
let shuttleIndex = 0;

// 경로 지점마다 순번이 적힌 아이콘(핀)을 지도 위에 표시한다.
// maplibregl.Marker 대신 커스텀 레이어로 직접 투영해서, 카메라 회전/틸트 시
// maplibregl.Marker의 지형 고도 재조회 버그로 인한 흔들림 없이 GPS 좌표에
// 고정되어 보이게 한다.
const routePointIconsLayer = new RoutePointIcons(map, shuttlePoints);
map.on('load', () => {
    map.addLayer(routePointIconsLayer);
});

// 정해진 시간(setTimeout)이 지나면 무조건 다음 지점으로 넘어가던 방식은,
// 편대 버스와 충돌 반경 안에 들어와 moveBusTo가 잠시 멈춘 사이에도 타이머가
// 그대로 흘러가 실제로 도착하기 전에 다음 지점으로 넘어가 버리는 문제가 있었다.
// 그래서 moveBusTo의 onArrive 콜백으로 "실제로 그 좌표에 도착한 시점"에만
// 바로 다음 지점으로 넘어가도록 바꿨다.
function shuttleNext() {
    moveBusTo(shuttlePoints[shuttleIndex], BUS_MOVE_DURATION_MS, () => {
        // 마지막 지점 다음엔 다시 0번(첫 지점)으로 돌아간다.
        shuttleIndex = (shuttleIndex + 1) % shuttlePoints.length;
        shuttleNext();
    });
}
shuttleNext();

// 스페이스바를 누르고 있는 동안 카메라를 버스 위치에 고정 (떼면 고정 해제)
let isCameraLockedToBus = false;
let cameraLockAnimationId = null;

function cameraLockStep() {
    if (!isCameraLockedToBus) return;
    map.jumpTo({ center: [modelOrigin[0], modelOrigin[1]] });
    cameraLockAnimationId = requestAnimationFrame(cameraLockStep);
}

window.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || e.repeat || isCameraLockedToBus) return;
    e.preventDefault();
    isCameraLockedToBus = true;
    cameraLockAnimationId = requestAnimationFrame(cameraLockStep);
});

window.addEventListener('keyup', (e) => {
    if (e.code !== 'Space') return;
    isCameraLockedToBus = false;
    if (cameraLockAnimationId !== null) {
        cancelAnimationFrame(cameraLockAnimationId);
        cameraLockAnimationId = null;
    }
});

// 화면 좌측 상단에 마우스 좌표(경도/위도), 지도 회전각(bearing), 줌 레벨, FPS 표시
const coordsEl = document.getElementById('coords');
let lastLngLat = null;
let currentFps = 0;

function renderCoordsLabel() {
    const lngText = lastLngLat ? lastLngLat.lng.toFixed(6) : '-';
    const latText = lastLngLat ? lastLngLat.lat.toFixed(6) : '-';
    coordsEl.textContent = `Lng: ${lngText}, Lat: ${latText}, Rotate: ${map.getBearing().toFixed(1)}°, Pitch: ${map.getPitch().toFixed(1)}°, Zoom: ${map.getZoom().toFixed(2)}, FPS: ${currentFps}`;
}

map.on('mousemove', (e) => {
    lastLngLat = e.lngLat;
    renderCoordsLabel();
});
map.on('rotate', renderCoordsLabel);
map.on('zoom', renderCoordsLabel);
map.on('pitch', renderCoordsLabel);

// FPS 계산 (0.5초마다 갱신)
let fpsFrameCount = 0;
let fpsLastTime = performance.now();

function updateFps() {
    fpsFrameCount++;
    const now = performance.now();
    const elapsed = now - fpsLastTime;

    if (elapsed >= 500) {
        currentFps = Math.round((fpsFrameCount * 1000) / elapsed);
        fpsFrameCount = 0;
        fpsLastTime = now;
        renderCoordsLabel();
    }

    requestAnimationFrame(updateFps);
}
requestAnimationFrame(updateFps);

// 지도 회전에 맞춰 동서남북 컴퍼스 회전
const compassEl = document.getElementById('compass');
function updateCompass() {
    compassEl.style.transform = `rotate(${-map.getBearing()}deg)`;
}
map.on('rotate', updateCompass);
updateCompass();

// ===== 오른쪽 버스 정보 패널 =====
// 단일 버스 + 편대 버스 전체를 한 목록으로 모은다. position은 각 컴포넌트가
// 매 프레임 갱신하는 배열을 그대로 참조하므로, 여기서 다시 조회할 필요 없이
// 그 배열의 최신 값을 읽기만 하면 된다.
function getTrackableBuses() {
    const list = [{
        label: 'BUS_G7',
        position: modelOrigin,
        // 편대 버스는 idleMs===0일 때 "이번 프레임에 실제로 움직였다"는 뜻이라
        // 그대로 재사용하고, 단일 버스는 별도로 추적하는 플래그를 읽는다.
        isMoving: () => isSingleBusMoving
    }];
    busFleetLayer.buses.forEach((bus, i) => {
        list.push({
            label: `BusModel-${i}`,
            position: bus.position,
            isMoving: () => bus.idleMs === 0
        });
    });
    return list;
}

const trackableBuses = getTrackableBuses();
const busPanelBody = document.getElementById('bus-panel-body');
const busPanelRows = [];
let followedBusIndex = null;

function setFollowedBus(index) {
    // 같은 행을 다시 클릭하면 추적을 해제한다.
    followedBusIndex = followedBusIndex === index ? null : index;

    busPanelRows.forEach((row, i) => {
        row.tr.classList.toggle('selected', i === followedBusIndex);
    });

    if (followedBusIndex !== null) {
        const target = trackableBuses[followedBusIndex];
        map.easeTo({ center: [target.position[0], target.position[1]], zoom: 20, duration: 800 });
    }
}

// 행(DOM)은 한 번만 만들고, 매 프레임에는 텍스트만 갱신한다 (100여 개를 매번
// 새로 그리면 훨씬 비싸다).
trackableBuses.forEach((bus, i) => {
    const tr = document.createElement('tr');
    const statusTd = document.createElement('td');
    const statusDot = document.createElement('span');
    const labelTd = document.createElement('td');
    const lngTd = document.createElement('td');
    const latTd = document.createElement('td');

    statusDot.className = 'bus-status-dot';
    statusTd.appendChild(statusDot);
    labelTd.textContent = bus.label;
    tr.append(statusTd, labelTd, lngTd, latTd);
    tr.addEventListener('click', () => setFollowedBus(i));
    busPanelBody.appendChild(tr);

    busPanelRows.push({ tr, statusDot, lngTd, latTd });
});

let busPanelLastUpdate = 0;

function updateBusPanel(now) {
    // 단일 버스는 편대와 달리 라벨을 자기 자신(bus_g7.js)이 매 프레임 그리지 않고
    // app.js가 위치를 밀어주는 구조라, 이동 상태 점(dot)도 여기서 함께 갱신한다.
    if (busLayer.label) {
        busLayer.label.setMoving(isSingleBusMoving);
    }

    // 100여 개 행의 텍스트를 매 프레임 갱신하면 부담이 있어 초당 몇 번으로 제한.
    if (now - busPanelLastUpdate >= 200) {
        busPanelLastUpdate = now;
        trackableBuses.forEach((bus, i) => {
            const row = busPanelRows[i];
            row.lngTd.textContent = bus.position[0].toFixed(6);
            row.latTd.textContent = bus.position[1].toFixed(6);
            row.statusDot.style.background = bus.isMoving() ? '#4caf50' : '#f44336';
        });
    }

    // 선택된 버스가 있으면 카메라 중심을 계속 그 버스 위치로 고정해 따라가게 한다.
    // (스페이스바 카메라 고정과 같은 방식: center만 덮어써서 줌/피치/베어링은
    // 사용자가 계속 조작할 수 있다)
    if (followedBusIndex !== null) {
        const target = trackableBuses[followedBusIndex];
        map.jumpTo({ center: [target.position[0], target.position[1]] });
    }

    requestAnimationFrame(updateBusPanel);
}
requestAnimationFrame(updateBusPanel);
