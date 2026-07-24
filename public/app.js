import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

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

// three.js로 3D 모델(공항)을 지도 위에 올리기 위한 커스텀 레이어
const modelOrigin = [126.4280, 37.4600]; // 모델을 배치할 위경도
const modelRotate = [Math.PI / 2, 0, 0];
let modelElevationOffset = -530; // 값을 더 낮추면(음수를 키우면) 모델이 지면 아래로 더 내려감

// terrain이 켜져 있으면 지표면 높이가 0(해수면)이 아니므로,
// 매 프레임 해당 지점의 실제 지형 고도를 구해 모델을 지면에 붙인다.
function getModelTransform() {
    const elevation = (map.queryTerrainElevation(modelOrigin) || 0) + modelElevationOffset;
    const modelAsMercatorCoordinate = maplibregl.MercatorCoordinate.fromLngLat(
        modelOrigin,
        elevation
    );

    return {
        translateX: modelAsMercatorCoordinate.x,
        translateY: modelAsMercatorCoordinate.y,
        translateZ: modelAsMercatorCoordinate.z,
        rotateX: modelRotate[0],
        rotateY: modelRotate[1],
        rotateZ: modelRotate[2],
        // 미터 단위를 머케이터 좌표 단위로 환산 (모델 스케일 조정 시 여기에 배율을 곱하면 됨)
        scale: modelAsMercatorCoordinate.meterInMercatorCoordinateUnits() * 3
    };
}

const airportModelLayer = {
    id: '3d-airport-model',
    type: 'custom',
    renderingMode: '3d',
    onAdd(map, gl) {
        this.camera = new THREE.Camera();
        this.scene = new THREE.Scene();

        const directionalLight = new THREE.DirectionalLight(0xffffff);
        directionalLight.position.set(0, -70, 100).normalize();
        this.scene.add(directionalLight);

        const directionalLight2 = new THREE.DirectionalLight(0xffffff);
        directionalLight2.position.set(0, 70, 100).normalize();
        this.scene.add(directionalLight2);

        const loader = new GLTFLoader();
        loader.load(
            '/modeling/airport/airport.gltf',
            (gltf) => {
                this.scene.add(gltf.scene);
            },
            undefined,
            (error) => {
                console.error('공항 모델 로드 실패:', error);
            }
        );

        this.map = map;
        this.renderer = new THREE.WebGLRenderer({
            canvas: map.getCanvas(),
            context: gl,
            antialias: true
        });
        this.renderer.autoClear = false;
    },
    render(gl, args) {
        const modelTransform = getModelTransform();

        const rotationX = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(1, 0, 0), modelTransform.rotateX);
        const rotationY = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(0, 1, 0), modelTransform.rotateY);
        const rotationZ = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(0, 0, 1), modelTransform.rotateZ);

        const m = new THREE.Matrix4().fromArray(args.defaultProjectionData.mainMatrix);
        const l = new THREE.Matrix4()
            .makeTranslation(modelTransform.translateX, modelTransform.translateY, modelTransform.translateZ)
            .scale(new THREE.Vector3(modelTransform.scale, -modelTransform.scale, modelTransform.scale))
            .multiply(rotationX)
            .multiply(rotationY)
            .multiply(rotationZ);

        this.camera.projectionMatrix = m.multiply(l);
        this.renderer.resetState();
        this.renderer.render(this.scene, this.camera);
        this.map.triggerRepaint();
    }
};

// 토끼 모델 배치 (별도 위경도/회전)
const rabbitOrigin = [126.4509, 37.4500419];
const rabbitRotate = [Math.PI / 2, THREE.MathUtils.degToRad(0.2), 0];
const rabbitElevationOffset = -70;

function getRabbitModelTransform() {
    const elevation = (map.queryTerrainElevation(rabbitOrigin) || 0) + rabbitElevationOffset;
    const modelAsMercatorCoordinate = maplibregl.MercatorCoordinate.fromLngLat(
        rabbitOrigin,
        elevation
    );

    return {
        translateX: modelAsMercatorCoordinate.x,
        translateY: modelAsMercatorCoordinate.y,
        translateZ: modelAsMercatorCoordinate.z,
        rotateX: rabbitRotate[0],
        rotateY: rabbitRotate[1],
        rotateZ: rabbitRotate[2],
        scale: modelAsMercatorCoordinate.meterInMercatorCoordinateUnits() / 40
    };
}

const rabbitModelLayer = {
    id: '3d-rabbit-model',
    type: 'custom',
    renderingMode: '3d',
    onAdd(map, gl) {
        this.camera = new THREE.Camera();
        this.scene = new THREE.Scene();

        const directionalLight = new THREE.DirectionalLight(0xffffff);
        directionalLight.position.set(0, -70, 100).normalize();
        this.scene.add(directionalLight);

        const directionalLight2 = new THREE.DirectionalLight(0xffffff);
        directionalLight2.position.set(0, 70, 100).normalize();
        this.scene.add(directionalLight2);

        const loader = new GLTFLoader();
        loader.load(
            '/modeling/airport/korean_rabbit.gltf',
            (gltf) => {
                gltf.scene.scale.set(1, 3, 1);
                this.scene.add(gltf.scene);
            },
            undefined,
            (error) => {
                console.error('토끼 모델 로드 실패:', error);
            }
        );

        this.map = map;
        this.renderer = new THREE.WebGLRenderer({
            canvas: map.getCanvas(),
            context: gl,
            antialias: true
        });
        this.renderer.autoClear = false;
    },
    render(gl, args) {
        const modelTransform = getRabbitModelTransform();

        const rotationX = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(1, 0, 0), modelTransform.rotateX);
        const rotationY = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(0, 1, 0), modelTransform.rotateY);
        const rotationZ = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(0, 0, 1), modelTransform.rotateZ);

        const m = new THREE.Matrix4().fromArray(args.defaultProjectionData.mainMatrix);
        const l = new THREE.Matrix4()
            .makeTranslation(modelTransform.translateX, modelTransform.translateY, modelTransform.translateZ)
            .scale(new THREE.Vector3(modelTransform.scale, -modelTransform.scale, modelTransform.scale))
            .multiply(rotationX)
            .multiply(rotationY)
            .multiply(rotationZ);

        this.camera.projectionMatrix = m.multiply(l);
        this.renderer.resetState();
        this.renderer.render(this.scene, this.camera);
        this.map.triggerRepaint();
    }
};

// 대한항공 모델이 마우스 포인터가 가리키는 지점을 따라 이동
const koreanAirAltitude = 550; // 비행 고도(m). 값을 키우면 더 높이 뜸
const koreanAirTurnRate = Math.PI; // 회전 속도(rad/sec). 값을 키우면 더 빨리 방향을 튼다
const koreanAirSpeed = 120; // 이동 속도(m/s). 값을 키우면 더 빨리 따라옴
let koreanAirHeading = THREE.MathUtils.degToRad(0);
let koreanAirLastFrameTime = null;
let koreanAirPosition = [modelOrigin[0], modelOrigin[1]];
let koreanAirTarget = [modelOrigin[0], modelOrigin[1]];

// 지도 위 마우스 위치(경위도)를 목표 지점으로 갱신
map.on('mousemove', (e) => {
    koreanAirTarget = [e.lngLat.lng, e.lngLat.lat];
});

function normalizeAngleDiff(diff) {
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    return diff;
}

function getKoreanAirModelTransform() {
    const now = performance.now();
    const dt = koreanAirLastFrameTime === null ? 0 : (now - koreanAirLastFrameTime) / 1000;
    koreanAirLastFrameTime = now;

    // 위경도 차이를 미터 단위로 환산해 목표 지점 방향으로 이동
    const latMetersPerDeg = 111320;
    const lngMetersPerDeg = 111320 * Math.cos(koreanAirPosition[1] * Math.PI / 180);
    const dxMeters = (koreanAirTarget[0] - koreanAirPosition[0]) * lngMetersPerDeg;
    const dyMeters = (koreanAirTarget[1] - koreanAirPosition[1]) * latMetersPerDeg;
    const distMeters = Math.sqrt(dxMeters * dxMeters + dyMeters * dyMeters);

    if (distMeters > 0) {
        const moveRatio = Math.min(1, (koreanAirSpeed * dt) / distMeters);
        koreanAirPosition[0] += (koreanAirTarget[0] - koreanAirPosition[0]) * moveRatio;
        koreanAirPosition[1] += (koreanAirTarget[1] - koreanAirPosition[1]) * moveRatio;
    }

    const elevationOffset = modelElevationOffset + koreanAirAltitude;
    const elevation = (map.queryTerrainElevation(koreanAirPosition) || 0) + elevationOffset;
    const modelAsMercatorCoordinate = maplibregl.MercatorCoordinate.fromLngLat(koreanAirPosition, elevation);

    // 목표 지점을 향하도록 부드럽게 회전 (너무 가까우면 방향 유지)
    if (distMeters >= 1) {
        const targetHeading = Math.atan2(dxMeters, dyMeters);
        const diff = normalizeAngleDiff(targetHeading - koreanAirHeading);
        const maxStep = koreanAirTurnRate * dt;
        if (dt === 0 || Math.abs(diff) <= maxStep) {
            koreanAirHeading = targetHeading;
        } else {
            koreanAirHeading += Math.sign(diff * -1) * maxStep;
        }
    }

    return {
        translateX: modelAsMercatorCoordinate.x,
        translateY: modelAsMercatorCoordinate.y,
        translateZ: modelAsMercatorCoordinate.z,
        rotateX: Math.PI / 2,
        rotateY: koreanAirHeading * -1,
        rotateZ: 0,
        scale: modelAsMercatorCoordinate.meterInMercatorCoordinateUnits() * 3
    };
}

const koreanAirModelLayer = {
    id: '3d-korean-air-model',
    type: 'custom',
    renderingMode: '3d',
    onAdd(map, gl) {
        this.camera = new THREE.Camera();
        this.scene = new THREE.Scene();

        const directionalLight = new THREE.DirectionalLight(0xffffff);
        directionalLight.position.set(0, -70, 100).normalize();
        this.scene.add(directionalLight);

        const directionalLight2 = new THREE.DirectionalLight(0xffffff);
        directionalLight2.position.set(0, 70, 100).normalize();
        this.scene.add(directionalLight2);

        const loader = new GLTFLoader();
        loader.load(
            '/modeling/airport/korean_air.gltf',
            (gltf) => {
                gltf.scene.scale.set(0.02, 0.02, 0.02);
                this.scene.add(gltf.scene);
            },
            undefined,
            (error) => {
                console.error('대한항공 모델 로드 실패:', error);
            }
        );

        this.map = map;
        this.renderer = new THREE.WebGLRenderer({
            canvas: map.getCanvas(),
            context: gl,
            antialias: true
        });
        this.renderer.autoClear = false;
    },
    render(gl, args) {
        const modelTransform = getKoreanAirModelTransform();

        const rotationX = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(1, 0, 0), modelTransform.rotateX);
        const rotationY = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(0, 1, 0), modelTransform.rotateY);
        const rotationZ = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(0, 0, 1), modelTransform.rotateZ);

        const m = new THREE.Matrix4().fromArray(args.defaultProjectionData.mainMatrix);
        const l = new THREE.Matrix4()
            .makeTranslation(modelTransform.translateX, modelTransform.translateY, modelTransform.translateZ)
            .scale(new THREE.Vector3(modelTransform.scale, -modelTransform.scale, modelTransform.scale))
            .multiply(rotationX)
            .multiply(rotationY)
            .multiply(rotationZ);

        this.camera.projectionMatrix = m.multiply(l);
        this.renderer.resetState();
        this.renderer.render(this.scene, this.camera);
        this.map.triggerRepaint();
    }
};

map.on('load', () => {
    map.addLayer(airportModelLayer);
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

// 화면 좌측 상단에 마우스 좌표(경도/위도)와 지도 회전각(bearing) 표시
const coordsEl = document.getElementById('coords');
map.on('mousemove', (e) => {
    coordsEl.textContent = `Lng: ${e.lngLat.lng.toFixed(6)}, Lat: ${e.lngLat.lat.toFixed(6)}, Rotate: ${map.getBearing().toFixed(1)}°`;
});
map.on('rotate', () => {
    coordsEl.textContent = coordsEl.textContent.replace(/Rotate: .*/, `Rotate: ${map.getBearing().toFixed(1)}°`);
});

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
