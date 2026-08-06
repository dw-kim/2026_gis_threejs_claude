import LiveBusFleet from './component/liveBusFleet.js';
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
    zoom: 18,
    pitch: 66.9,
    bearing: -35.2,
    maxPitch: 85
});

map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }));
map.addControl(new maplibregl.TerrainControl({ source: 'terrainSource' }));

// 서울시 버스 실시간 위치 API 응답(itemList) 개수만큼 버스를 그리는 레이어.
// 항목 수가 호출마다 달라질 수 있어 plainNo(차량 번호판)를 키로 버스별
// Object3D/라벨을 새로 만들거나 재사용하거나(운행 종료 등으로) 없어지면 정리한다.
const liveBusFleetLayer = new LiveBusFleet(map, {
    rotateOffset: [Math.PI / 2, 0, 0],
    elevationOffset: 1,
    scaleMultiplier: 1,
    moveDurationMs: 10000
});

map.on('load', () => {
    map.addLayer(liveBusFleetLayer);
});

// ===== 오른쪽 버스 정보 패널 =====
const busPanelBody = document.getElementById('bus-panel-body');
const busPanelRowsById = new Map(); // plainNo -> 행 DOM 참조
let followedBusId = null;

// map.easeTo()는 애니메이션 도중 map.jumpTo()가 한 번이라도 호출되면 즉시
// 끊겨버리는데, 팔로우 루프는 버스를 따라가려고 매 프레임 jumpTo(center)를
// 불러야 해서 easeTo와 같이 쓸 수 없다. 그래서 줌 전환은 직접 rAF로 보간해서
// 매 프레임 center와 함께 한 번의 jumpTo로 같이 적용한다.
let zoomAnim = null; // { fromZoom, toZoom, startTime, durationMs }

function startZoomAnim(toZoom, durationMs = 600) {
    zoomAnim = { fromZoom: map.getZoom(), toZoom, startTime: performance.now(), durationMs };
}

function easeInOutQuad(t) {
    return t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;
}

// 진행 중인 줌 애니메이션 값을 계산하고, 끝났으면 애니메이션 상태를 정리한다.
function getAnimatedZoom(now) {
    const t = Math.min(1, (now - zoomAnim.startTime) / zoomAnim.durationMs);
    const zoom = zoomAnim.fromZoom + (zoomAnim.toZoom - zoomAnim.fromZoom) * easeInOutQuad(t);
    if (t >= 1) zoomAnim = null;
    return zoom;
}

function setFollowedBus(id) {
    // 같은 행을 다시 클릭하면 추적을 해제한다.
    followedBusId = followedBusId === id ? null : id;

    busPanelRowsById.forEach((row, rowId) => {
        row.tr.classList.toggle('selected', rowId === followedBusId);
    });

    startZoomAnim(followedBusId !== null ? 20 : 18);
}

// API 응답을 받을 때마다 호출: 패널 행을 최신 목록에 맞게 갱신한다.
// (행 DOM은 plainNo별로 재사용하고, 이번 응답에 없는 버스만 행을 지운다)
function renderBusPanel(items) {
    const seenIds = new Set(items.map((item) => item.id));

    Array.from(busPanelRowsById.keys()).forEach((id) => {
        if (seenIds.has(id)) return;

        busPanelRowsById.get(id).tr.remove();
        busPanelRowsById.delete(id);
        if (followedBusId === id) followedBusId = null;
    });

    items.forEach((item) => {
        let row = busPanelRowsById.get(item.id);
        if (!row) {
            const tr = document.createElement('tr');
            const statusTd = document.createElement('td');
            const statusDot = document.createElement('span');
            const labelTd = document.createElement('td');
            const lngTd = document.createElement('td');
            const latTd = document.createElement('td');

            statusDot.className = 'bus-status-dot';
            statusTd.appendChild(statusDot);
            tr.append(statusTd, labelTd, lngTd, latTd);
            tr.addEventListener('click', () => setFollowedBus(item.id));
            busPanelBody.appendChild(tr);

            row = { tr, statusDot, labelTd, lngTd, latTd };
            busPanelRowsById.set(item.id, row);
        }

        row.labelTd.textContent = item.label;
        row.lngTd.textContent = item.lng.toFixed(6);
        row.latTd.textContent = item.lat.toFixed(6);
        row.statusDot.style.background = item.isMoving ? '#4caf50' : '#f44336';
        row.tr.classList.toggle('selected', item.id === followedBusId);
    });
}

// BusApiMixin을 명시적으로 섞은 컴포넌트만 (서울시) 버스 위치 API를 호출한다.
// (믹스인을 적용하지 않으면 startBusPositionPolling 자체가 없어 호출이 전혀 일어나지 않는다)
Object.assign(LiveBusFleet.prototype, BusApiMixin);

// 로컬 개발 서버/직접 배포한 서버에서는 프론트와 /api가 같은 origin이라 상대경로면
// 충분하지만, GitHub Pages는 정적 파일만 서빙해서 /api 자체가 없다. 그래서 Pages에서
// 열렸을 때만 별도로 띄워둔 백엔드(API_BASE_URL)를 절대경로로 호출하도록 분기한다.
// (백엔드를 아직 배포하지 않았다면 빈 문자열로 두고, 배포 후 여기에 주소를 채운다)
const REMOTE_API_BASE_URL = 'https://2026-gis-threejs-claude.fly.dev/';
const API_BASE_URL = location.hostname.endsWith('github.io') ? REMOTE_API_BASE_URL : '';

// 지정한 노선ID로 폴링을 (다시) 시작한다. 노선을 바꿀 때 이전 노선의 버스가
// 화면/패널에 남아있지 않도록 먼저 비운다.
function startPollingForRoute(busRouteId) {
    liveBusFleetLayer.setBuses([]);
    busPanelRowsById.forEach((row) => row.tr.remove());
    busPanelRowsById.clear();
    followedBusId = null;

    liveBusFleetLayer.startBusPositionPolling({
        busRouteId,
        apiBaseUrl: API_BASE_URL,
        intervalMs: 10000, // 10초마다 호출
        onUpdate: (positions) => {
            // plainNo(차량 번호판)를 키로 써서, 다음 호출에서도 같은 버스면 새로
            // 만들지 않고 기존 버스의 위치만 갱신하도록 한다.
            const items = positions.map((p) => ({
                id: p.plainNo,
                label: p.plainNo,
                lng: p.lng,
                lat: p.lat
            }));
            liveBusFleetLayer.setBuses(items);

            // 이동 여부는 liveBusFleetLayer가 직전 좌표와 비교해 직접 계산하므로,
            // 패널도 API의 stopFlag가 아니라 그 계산 결과를 그대로 가져다 쓴다
            // (3D 라벨의 점 색과 패널의 점 색이 항상 같은 기준으로 일치하게 됨).
            const panelItems = items.map((item) => ({
                ...item,
                isMoving: liveBusFleetLayer.busesById.get(item.id)?.isMoving ?? false
            }));
            renderBusPanel(panelItems);
        }
    });
}

// 우측 상단 노선 선택 드롭다운: /json/bus_routeid.json(노선명/ROUTEID 목록)을
// 읽어 옵션을 채우고, 고른 노선ID로 API 호출을 시작/전환한다.
const busRouteSelect = document.getElementById('bus-route-select');

// 절대경로('/json/...')는 GitHub Pages처럼 사이트가 도메인 루트가 아니라
// 서브경로(레포명)에 떠 있을 때 그 경로를 무시하고 도메인 루트를 가리켜버려
// 404가 난다. 상대경로로 두면 로컬 개발 서버/정적 호스팅 양쪽에서 다 맞는다.
fetch('json/bus_routeid.json')
    .then((response) => response.json())
    .then((routes) => {
        busRouteSelect.innerHTML = '';
        routes.forEach((route) => {
            const option = document.createElement('option');
            option.value = route.ROUTEID;
            option.textContent = route['노선명'];
            busRouteSelect.appendChild(option);
        });

        busRouteSelect.addEventListener('change', () => {
            startPollingForRoute(busRouteSelect.value);
        });

        // 처음엔 목록의 첫 노선으로 바로 조회를 시작한다.
        if (routes.length > 0) {
            busRouteSelect.value = routes[0].ROUTEID;
            startPollingForRoute(String(routes[0].ROUTEID));
        }
    })
    .catch((error) => {
        console.error('버스 노선 목록 로드 실패:', error);
    });

// 선택된 버스가 있으면 카메라 중심을 계속 그 버스 위치로 고정해 따라가게 한다.
// (center만 덮어써서 피치/베어링은 사용자가 계속 조작할 수 있다) 줌 전환
// 애니메이션이 진행 중이면 같은 jumpTo 호출에 묶어서 함께 적용한다.
function updateCameraFollow(now) {
    if (followedBusId !== null) {
        const bus = liveBusFleetLayer.busesById.get(followedBusId);
        if (bus) {
            if (zoomAnim) {
                map.jumpTo({ center: [bus.lng, bus.lat], zoom: getAnimatedZoom(now) });
            } else {
                map.jumpTo({ center: [bus.lng, bus.lat] });
            }
        }
    } else if (zoomAnim) {
        map.jumpTo({ zoom: getAnimatedZoom(now) });
    }

    requestAnimationFrame(updateCameraFollow);
}
requestAnimationFrame(updateCameraFollow);

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
