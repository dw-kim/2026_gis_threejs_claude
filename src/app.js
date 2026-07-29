import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import BUS_G7 from './component/bus_g7.js';
import BusApiMixin from './mixin/api.js';

const socket = io();

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
    center: [126.925173, 37.557784],
    zoom: 20.5,
    pitch: 66.9,
    bearing: -35.2,
    maxPitch: 85
});

map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }));
map.addControl(new maplibregl.TerrainControl({ source: 'terrainSource' }));

// 드래그 이동 대상 기준 좌표
const modelOrigin = [126.925220, 37.557808];

// 버스(G7 1350 6x4) 모델 배치, modelOrigin을 그대로 써서 드래그로 이동 가능
const busG7Layer = new BUS_G7(map, {
    origin: modelOrigin,
    rotate: [Math.PI / 2, THREE.MathUtils.degToRad(-45), 0],
    elevationOffset: 1,
    scaleMultiplier: 1
});

map.on('load', () => {
    map.addLayer(busG7Layer);
});

// BusApiMixin을 명시적으로 섞은 컴포넌트만 버스 위치 API를 호출한다.
// (믹스인을 적용하지 않으면 startBusPositionPolling 자체가 없어 호출이 전혀 일어나지 않는다)
Object.assign(BUS_G7.prototype, BusApiMixin);
busG7Layer.startBusPositionPolling({
    busRouteId: '113900012',
    onUpdate: (positions) => {
        console.log('버스 위치:', positions);
    }
});

// 마우스 드래그로 모델 이동 (모델 근처 클릭 후 드래그: 수평 이동 / Shift+드래그: 고도 이동)
let isDraggingModel = false;
let isVerticalDrag = false;
let dragLastPoint = null;

map.on('mousedown', (e) => {
    const originPoint = map.project(modelOrigin);
    const dx = e.point.x - originPoint.x;
    const dy = e.point.y - originPoint.y;

    if (Math.sqrt(dx * dx + dy * dy) < 40) {
        isDraggingModel = true;
        isVerticalDrag = e.originalEvent.shiftKey;
        dragLastPoint = e.point;

        map.dragPan.disable();
        map.dragRotate.disable();
        map.getCanvas().style.cursor = isVerticalDrag ? 'ns-resize' : 'move';
    }
});

map.on('mousemove', (e) => {
    if (!isDraggingModel) return;

    if (isVerticalDrag) {
        const deltaY = dragLastPoint.y - e.point.y; // 위로 드래그하면 고도 증가
        busG7Layer.elevationOffset += deltaY * 2; // 픽셀당 약 2m, 필요시 배율 조정
    } else {
        const newLngLat = map.unproject(e.point);
        modelOrigin[0] = newLngLat.lng;
        modelOrigin[1] = newLngLat.lat;
    }

    dragLastPoint = e.point;
    map.triggerRepaint();
});

function endModelDrag() {
    if (!isDraggingModel) return;
    isDraggingModel = false;
    map.dragPan.enable();
    map.dragRotate.enable();
    map.getCanvas().style.cursor = '';
    console.log('modelOrigin:', modelOrigin, 'modelElevationOffset:', busG7Layer.elevationOffset);
}

map.on('mouseup', endModelDrag);
map.on('mouseleave', endModelDrag);

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
