import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import KoreanAirModel from './component/airplain.js';
import RabbitModel from './component/airport_1terminal.js';

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
                source: 'osm',
                minzoom: 0,
                maxzoom: 19
            }
        ],
        terrain: {
            source: 'terrainSource',
            exaggeration: 0
        },
        sky: {}
    },
    center: [126.4570, 37.4780], // 인천공항 화물터미널 C동 인근
    zoom: 14.5,
    pitch: 65,
    bearing: -125, // 터미널 방향에 맞춰 약간 회전
    maxPitch: 85
});

map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }));
map.addControl(new maplibregl.TerrainControl({ source: 'terrainSource' }));

// 드래그 이동 및 대한항공 함대의 기준 위치로 쓰이는 좌표(공항 모델은 제거됨)
const modelOrigin = [126.4280, 37.4600];
let modelElevationOffset = -530;

// 토끼 모델 배치 (별도 위경도/회전)
const rabbitModelLayer = new RabbitModel(map, {
    origin: [126.4509, 37.4500419],
    rotate: [Math.PI / 2, THREE.MathUtils.degToRad(0.2), 0],
    elevationOffset: -70
});

// 대한항공 모델 20대를 InstancedMesh 하나로 그려 기준 위치 근처에서 랜덤 비행
const koreanAirModelLayer = new KoreanAirModel(map, {
    count: 1000,
    labelPrefix: 'KoreanAirModel',
    origin: modelOrigin,
    getElevationOffsetBase: () => modelElevationOffset
});

map.on('load', () => {
    map.addLayer(rabbitModelLayer);
    map.addLayer(koreanAirModelLayer);
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
        modelElevationOffset += deltaY * 2; // 픽셀당 약 2m, 필요시 배율 조정
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
    console.log('modelOrigin:', modelOrigin, 'modelElevationOffset:', modelElevationOffset);
}

map.on('mouseup', endModelDrag);
map.on('mouseleave', endModelDrag);

// 화면 좌측 상단에 마우스 좌표(경도/위도), 지도 회전각(bearing), FPS 표시
const coordsEl = document.getElementById('coords');
let lastLngLat = null;
let currentFps = 0;

function renderCoordsLabel() {
    const lngText = lastLngLat ? lastLngLat.lng.toFixed(6) : '-';
    const latText = lastLngLat ? lastLngLat.lat.toFixed(6) : '-';
    coordsEl.textContent = `Lng: ${lngText}, Lat: ${latText}, Rotate: ${map.getBearing().toFixed(1)}°, FPS: ${currentFps}`;
}

map.on('mousemove', (e) => {
    lastLngLat = e.lngLat;
    renderCoordsLabel();
});
map.on('rotate', renderCoordsLabel);

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

const markers = new Map();

// 내 위치 추적 및 전송
if ("geolocation" in navigator) {
    navigator.geolocation.watchPosition((position) => {
        const { latitude, longitude } = position.coords;
        
        socket.emit('update-location', {
            lat: latitude,
            lng: longitude
        });

        // 맵 중심 이동 (옵션: 처음 한번만 하거나 버튼 클릭 시)
        // map.flyTo({ center: [longitude, latitude] });
    }, (error) => {
        console.error("Error getting location:", error);
    }, {
        enableHighAccuracy: true,
        timeout: 5000,
        maximumAge: 0
    });
} else {
    alert("Geolocation을 지원하지 않는 브라우저입니다.");
}

// 다른 사용자 위치 업데이트 수신
socket.on('locations-updated', (usersArray) => {
    // usersArray: [ [socketId, {lat, lng}], ... ]
    
    // 현재 활성 사용자 ID 세트
    const currentIds = new Set(usersArray.map(([id]) => id));

    // 연결 끊긴 마커 제거
    for (const [id, marker] of markers.entries()) {
        if (!currentIds.has(id)) {
            marker.remove();
            markers.delete(id);
        }
    }

    // 위치 업데이트 또는 새 마커 생성
    usersArray.forEach(([id, data]) => {
        if (markers.has(id)) {
            markers.get(id).setLngLat([data.lng, data.lat]);
        } else {
            const el = document.createElement('div');
            el.className = 'user-marker';
            if (id === socket.id) el.classList.add('self-marker');

            const marker = new maplibregl.Marker(el)
                .setLngLat([data.lng, data.lat])
                .addTo(map);
            
            markers.set(id, marker);
        }
    });
});
