import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import ModelLabel from './modelLabel.js';

// 대한항공(korean_air.gltf) 모델 여러 대를 THREE.InstancedMesh 하나로 그리는
// MapLibre 커스텀 레이어 클래스. 비행기가 많아져도 씬/렌더러/드로우콜은 하나뿐이라
// 개별 레이어로 N개를 추가하는 것보다 훨씬 가볍다.
export default class KoreanAirModel {
    constructor(map, {
        id = '3d-korean-air-model',
        modelUrl = '/modeling/airport/korean_air.gltf',
        origin,
        count = 1, // 비행기 대수
        labelPrefix = 'KoreanAirModel',
        getElevationOffsetBase = () => 0,
        altitude = 550, // 비행 고도(m). 값을 키우면 더 높이 뜸
        turnRate = Math.PI, // 회전 속도(rad/sec). 값을 키우면 더 빨리 방향을 튼다
        speed = 120, // 이동 속도(m/s). 값을 키우면 더 빨리 따라옴
        modelScale = 0.01,
        randomMoveIntervalMs = 5000, // 새 목표 지점을 뽑는 주기
        randomMoveRadius = 3000 // 기준 위치로부터 목표 지점을 뽑는 반경(m)
    }) {
        this.id = id;
        this.type = 'custom';
        this.renderingMode = '3d';

        this.map = map;
        this.modelUrl = modelUrl;
        this.count = count;
        this.labelPrefix = labelPrefix;
        this.getElevationOffsetBase = getElevationOffsetBase;
        this.altitude = altitude;
        this.turnRate = turnRate;
        this.speed = speed;
        this.modelScale = modelScale;
        this.randomMoveRadius = randomMoveRadius;

        this.origin = [origin[0], origin[1]]; // 랜덤 목표 지점을 뽑는 기준 위치
        this.lastFrameTime = null;

        // 비행기별 상태(위치/목표/방향)
        this.planes = Array.from({ length: count }, () => ({
            heading: 0,
            position: [origin[0], origin[1]],
            target: [origin[0], origin[1]]
        }));
        this.planes.forEach((plane) => this.pickRandomTarget(plane));

        // 5초(기본값)마다 비행기별로 기준 위치 근처의 랜덤한 지점을 새 목표로 지정
        setInterval(() => {
            this.planes.forEach((plane) => this.pickRandomTarget(plane));
        }, randomMoveIntervalMs);
    }

    pickRandomTarget(plane) {
        const latMetersPerDeg = 111320;
        const lngMetersPerDeg = 111320 * Math.cos(this.origin[1] * Math.PI / 180);
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.random() * this.randomMoveRadius;

        plane.target = [
            this.origin[0] + (Math.cos(angle) * radius) / lngMetersPerDeg,
            this.origin[1] + (Math.sin(angle) * radius) / latMetersPerDeg
        ];
    }

    static normalizeAngleDiff(diff) {
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        return diff;
    }

    // 목표 지점을 향해 비행기 하나의 위치/방향을 한 프레임만큼 갱신
    updatePlane(plane, dt) {
        const latMetersPerDeg = 111320;
        const lngMetersPerDeg = 111320 * Math.cos(plane.position[1] * Math.PI / 180);
        const dxMeters = (plane.target[0] - plane.position[0]) * lngMetersPerDeg;
        const dyMeters = (plane.target[1] - plane.position[1]) * latMetersPerDeg;
        const distMeters = Math.sqrt(dxMeters * dxMeters + dyMeters * dyMeters);

        if (distMeters > 0) {
            const moveRatio = Math.min(1, (this.speed * dt) / distMeters);
            plane.position[0] += (plane.target[0] - plane.position[0]) * moveRatio;
            plane.position[1] += (plane.target[1] - plane.position[1]) * moveRatio;
        }

        if (distMeters >= 1) {
            const targetHeading = Math.atan2(dxMeters, dyMeters);
            const diff = KoreanAirModel.normalizeAngleDiff(targetHeading - plane.heading);
            const maxStep = this.turnRate * dt;
            if (dt === 0 || Math.abs(diff) <= maxStep) {
                plane.heading = targetHeading;
            } else {
                plane.heading += Math.sign(diff * -1) * maxStep;
            }
        }
    }

    onAdd(map, gl) {
        this.camera = new THREE.Camera();
        this.scene = new THREE.Scene();

        const directionalLight = new THREE.DirectionalLight(0xffffff);
        directionalLight.position.set(0, -70, 100).normalize();
        this.scene.add(directionalLight);

        const directionalLight2 = new THREE.DirectionalLight(0xffffff);
        directionalLight2.position.set(0, 70, 100).normalize();
        this.scene.add(directionalLight2);

        // 방향광만 있으면 그림자 쪽 면이 새까맣게 나와 깨져 보이므로 주변광을 더한다.
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));

        const loader = new GLTFLoader();
        loader.load(
            this.modelUrl,
            (gltf) => this.buildInstancedMesh(gltf),
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

        this.labels = Array.from({ length: this.count }, (_, i) => new ModelLabel(map, `${this.labelPrefix}-${i}`));
    }

    // 로드된 gltf의 모든 메시를 하나의 지오메트리로 합쳐 InstancedMesh를 만든다.
    // (각 메시의 로컬 변환은 정점에 미리 구워 넣는다)
    buildInstancedMesh(gltf) {
        gltf.scene.scale.set(this.modelScale, this.modelScale, this.modelScale);
        gltf.scene.updateMatrixWorld(true);

        const geometries = [];
        const materials = [];

        gltf.scene.traverse((child) => {
            if (child.isMesh) {
                const geometry = child.geometry.clone();
                geometry.applyMatrix4(child.matrixWorld);
                geometries.push(geometry);
                materials.push(child.material);
            }
        });

        if (geometries.length === 0) {
            console.error('대한항공 모델에서 메시를 찾지 못했습니다.');
            return;
        }

        const mergedGeometry = mergeGeometries(geometries, true);
        if (!mergedGeometry) {
            console.error('대한항공 모델 지오메트리 병합에 실패했습니다.');
            return;
        }

        const material = materials.length > 1 ? materials : materials[0];
        this.instancedMesh = new THREE.InstancedMesh(mergedGeometry, material, this.count);
        this.instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        // 인스턴스 위치는 instanceMatrix로만 표현되고 mesh 자체의 matrixWorld는
        // 원점에 고정되어 있어, three.js의 기본 절두체 컬링(바운딩 스피어 기준)이
        // 실제 렌더링 위치와 맞지 않아 줌 레벨에 따라 잘못 컬링된다. 컬링을 끈다.
        this.instancedMesh.frustumCulled = false;
        this.scene.add(this.instancedMesh);
    }

    render(gl, args) {
        const now = performance.now();
        const dt = this.lastFrameTime === null ? 0 : (now - this.lastFrameTime) / 1000;
        this.lastFrameTime = now;

        const m = new THREE.Matrix4().fromArray(args.defaultProjectionData.mainMatrix);
        this.camera.projectionMatrix = m;

        // 비행기마다 매 프레임 지형 고도를 조회하면 대수가 많을 때 매우 비싸므로,
        // 기준 위치(origin) 기준 지형 고도 하나를 프레임당 1번만 조회해 공용으로 쓴다.
        // (비행 고도가 지형 고도차보다 훨씬 커서 시각적 오차는 무시할 만하다)
        const elevationOffset = this.getElevationOffsetBase() + this.altitude;
        const elevation = (this.map.queryTerrainElevation(this.origin) || 0) + elevationOffset;

        // 매 프레임 새로 생성하지 않고 재사용해 GC 부담을 줄인다.
        const rotationX = this._rotationX ?? (this._rotationX = new THREE.Matrix4().makeRotationX(Math.PI / 2));
        const rotationY = this._rotationY ?? (this._rotationY = new THREE.Matrix4());
        const scaleVector = this._scaleVector ?? (this._scaleVector = new THREE.Vector3());
        const instanceMatrix = this._instanceMatrix ?? (this._instanceMatrix = new THREE.Matrix4());
        const labelNdc = this._labelNdc ?? (this._labelNdc = new THREE.Vector3());

        this.planes.forEach((plane, i) => {
            this.updatePlane(plane, dt);

            const mercator = maplibregl.MercatorCoordinate.fromLngLat(plane.position, elevation);
            const scale = mercator.meterInMercatorCoordinateUnits() * 3;

            rotationY.makeRotationY(plane.heading * -1);
            scaleVector.set(scale, -scale, scale);

            instanceMatrix
                .makeTranslation(mercator.x, mercator.y, mercator.z)
                .scale(scaleVector)
                .multiply(rotationX)
                .multiply(rotationY);

            if (this.instancedMesh) {
                this.instancedMesh.setMatrixAt(i, instanceMatrix);
            }

            labelNdc.set(mercator.x, mercator.y, mercator.z).applyMatrix4(m);
            this.labels[i].updateFromNDC(labelNdc.x, labelNdc.y);
        });

        if (this.instancedMesh) {
            this.instancedMesh.instanceMatrix.needsUpdate = true;
        }

        this.renderer.resetState();
        this.renderer.render(this.scene, this.camera);
        this.map.triggerRepaint();
    }
}
