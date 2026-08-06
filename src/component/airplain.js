import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import BaseModel from '../base/BaseModel.js';
import ModelLabel from './modelLabel.js';

// 대한항공(korean_air.gltf) 모델 여러 대를 THREE.InstancedMesh 하나로 그리는
// MapLibre 커스텀 레이어 클래스. 비행기가 많아져도 씬/렌더러/드로우콜은 하나뿐이라
// 개별 레이어로 N개를 추가하는 것보다 훨씬 가볍다.
// (인스턴스별 상태 갱신이 필요해 BaseModel의 renderSingleModel()은 쓰지 않고
// onAdd/조명/렌더러/호버 아웃라인 초기화만 상속받아 재사용한다.)
export default class KoreanAirModel extends BaseModel {
    constructor(map, {
        id = '3d-korean-air-model',
        modelUrl = 'modeling/airport/korean_air.gltf',
        origin,
        count = 1, // 비행기 대수
        labelPrefix = 'KoreanAirModel',
        getElevationOffsetBase = () => 0,
        altitude = 600, // 비행 고도(m). 값을 키우면 더 높이 뜸
        turnRate = Math.PI, // 회전 속도(rad/sec). 값을 키우면 더 빨리 방향을 튼다
        speed = 200, // 이동 속도(m/s). 값을 키우면 더 빨리 따라옴
        modelScale = 0.01,
        randomMoveIntervalMs = 5000, // 새 목표 지점을 뽑는 주기
        randomMoveRadius = 3000 // 기준 위치로부터 목표 지점을 뽑는 반경(m)
    } = {}) {
        super(map, { id });

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

    loadModel() {
        // 비행기가 많을 때는 라벨을 매 프레임 갱신하면 부담이 커서 초당 20회로 제한한다.
        this.labels = Array.from(
            { length: this.count },
            (_, i) => new ModelLabel(this.map, `${this.labelPrefix}-${i}`, { updateIntervalMs: 50 })
        );

        const loader = new GLTFLoader();
        loader.load(
            this.modelUrl,
            (gltf) => this.buildInstancedMesh(gltf),
            undefined,
            (error) => {
                console.error('대한항공 모델 로드 실패:', error);
            }
        );
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

        // 라벨 위치(로컬 좌표): x/z는 바운딩 박스 중앙, y는 바닥에서
        // "높이 * 1.2" 만큼 띄운 지점(모델 꼭대기보다 살짝 위)으로 정정.
        // (기체별 위치는 instanceMatrix로 다르지만, 로컬 지오메트리 자체는 공유하므로
        // 이 지점 하나를 매 프레임 각 인스턴스의 instanceMatrix로 변환해서 쓴다)
        this.modelCenterLocal = BaseModel.computeLabelPointFromGeometry(mergedGeometry);

        // mergeGeometries가 계산하는 바운딩 스피어는 mercator 변환 전(로컬) 좌표
        // 기준이라 실제 렌더링 위치와 무관하다. InstancedMesh.raycast()는 이
        // 바운딩 스피어로 먼저 "레이가 근처를 지나가는지" 걸러내는데, 그 결과
        // 실제 비행기 위치와 전혀 다른 곳을 기준으로 걸러져 항상 놓치게 된다.
        // 무한대로 만들어 이 사전 필터 자체를 무력화한다.
        mergedGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), Infinity);

        const material = materials.length > 1 ? materials : materials[0];
        this.instancedMesh = new THREE.InstancedMesh(mergedGeometry, material, this.count);
        this.instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        // 인스턴스 위치는 instanceMatrix로만 표현되고 mesh 자체의 matrixWorld는
        // 원점에 고정되어 있어, three.js의 기본 절두체 컬링(바운딩 스피어 기준)이
        // 실제 렌더링 위치와 맞지 않아 줌 레벨에 따라 잘못 컬링된다. 컬링을 끈다.
        this.instancedMesh.frustumCulled = false;
        this.scene.add(this.instancedMesh);

        // OutlinePass는 InstancedMesh의 특정 인스턴스 하나만 골라 외곽선을 그릴 수
        // 없으므로, 호버된 비행기 하나의 변환을 복사해 보여주는 "고스트" 메시를
        // 따로 둔다. OutlinePass는 visible=false인 오브젝트를 마스크에 반영하지
        // 않으므로(rabbit/airport처럼) visible은 항상 true로 두고, 대신 호버 중이
        // 아닐 때는 크기를 0으로 줄여서 사실상 안 보이고 겹쳐 그려지지도 않게 한다.
        this.ghostMesh = new THREE.Mesh(mergedGeometry, material);
        this.ghostMesh.visible = true;
        this.ghostMesh.scale.set(0, 0, 0);
        this.scene.add(this.ghostMesh);
        this._ghostMatrix = new THREE.Matrix4();
        this._ghostScale = new THREE.Vector3();
    }

    render(gl, args) {
        this.syncRendererSize();

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

        // InstancedMesh.raycast()는 인스턴스별 사전 필터링이 없어 3D 레이캐스팅으로
        // 호버를 판정하면 비행기 수만큼(수백 대) 매 마우스무브마다 전체 삼각형을
        // 훑어서 매우 느려진다. 대신 라벨 위치 계산과 같은 화면 좌표(픽셀)를 재사용해
        // "마우스와 가장 가까운 비행기"를 찾는 2D 방식으로 호버를 판정한다.
        const canvas = this.map.getCanvas();
        const pointerNDC = this.hoverOutline.pointerNDC;
        const pointerPx = {
            x: (pointerNDC.x * 0.5 + 0.5) * canvas.width,
            y: (1 - (pointerNDC.y * 0.5 + 0.5)) * canvas.height
        };
        const hoverRadiusPx = 25;
        let hoveredIndex = -1;
        let hoveredDistSq = hoverRadiusPx * hoverRadiusPx;

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

            // 라벨은 원점(translate)이 아니라 기체 바운딩 박스 정중앙을 투영해 갱신
            if (this.modelCenterLocal) {
                labelNdc.copy(this.modelCenterLocal).applyMatrix4(instanceMatrix).applyMatrix4(m);
            } else {
                labelNdc.set(mercator.x, mercator.y, mercator.z).applyMatrix4(m);
            }
            this.labels[i].updateFromNDC(labelNdc.x, labelNdc.y);

            const px = (labelNdc.x * 0.5 + 0.5) * canvas.width;
            const py = (1 - (labelNdc.y * 0.5 + 0.5)) * canvas.height;
            const distSq = (px - pointerPx.x) ** 2 + (py - pointerPx.y) ** 2;
            if (distSq < hoveredDistSq) {
                hoveredDistSq = distSq;
                hoveredIndex = i;
            }
        });

        if (this.instancedMesh) {
            this.instancedMesh.instanceMatrix.needsUpdate = true;
        }

        this.renderer.resetState();
        this.renderer.render(this.scene, this.camera);

        if (this.instancedMesh) {
            if (hoveredIndex >= 0) {
                this.instancedMesh.getMatrixAt(hoveredIndex, this._ghostMatrix);
                this._ghostMatrix.decompose(this.ghostMesh.position, this.ghostMesh.quaternion, this._ghostScale);
                // 인스턴스 스케일은 (scale, -scale, scale)처럼 축 하나가 음수라
                // decompose가 부호를 다른 축으로 옮겨 담을 수 있다. 크기(절대값)만
                // 취해 항상 양수로 맞춘다 (미러링 여부는 외곽선 표시에 영향 없음).
                this.ghostMesh.scale.set(
                    Math.abs(this._ghostScale.x),
                    Math.abs(this._ghostScale.y),
                    Math.abs(this._ghostScale.z)
                );
                this.hoverOutline.setSelected(this.ghostMesh);
            } else {
                this.ghostMesh.scale.set(0, 0, 0);
                this.hoverOutline.setSelected(null);
            }

            this.hoverOutline.render();
        }

        this.map.triggerRepaint();
    }
}
