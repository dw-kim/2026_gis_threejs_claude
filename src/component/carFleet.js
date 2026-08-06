import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import BaseModel from '../base/BaseModel.js';
import ModelLabel from './modelLabel.js';

// 자동차(carm.gltf) 여러 대를 그리는 MapLibre 커스텀 레이어 클래스.
//
// mercator 좌표는 [0,1] 범위지만 실제 위치를 구분하려면 유효숫자가 많이
// 필요해서(미터 단위 정밀도), object.matrixWorld처럼 GPU에 float32로 통째로
// 올라가는 값에 넣으면 정밀도가 깎여 모델이 찌그러져 보인다(실제로 겪은 문제).
// 그래서 단일 자동차(carm.js/CarModel)와 완전히 같은 방식으로, 좌표 변환을
// CPU(JS 배정밀도)에서 카메라의 투영행렬에 미리 곱해 넣고(m*l), 모델 자체는
// 항상 원점(단위행렬)에 둔 채로 자동차 수만큼 한 대씩 순서대로 그린다.
// 대수가 10대뿐이라 draw call이 여러 번이어도 성능 부담은 거의 없다.
export default class CarFleet extends BaseModel {
    constructor(map, {
        id = '3d-car-fleet',
        modelUrl = 'modeling/carm/carm.gltf',
        origin,
        count = 10, // 자동차 대수
        labelPrefix = 'CarModel',
        rotateOffset = [Math.PI / 2, 0, 0], // 모델 좌표계 보정용 기본 회전
        elevationOffset = 0,
        scaleMultiplier = 1,
        turnRate = Math.PI, // 회전 속도(rad/sec)
        speed = 8, // 이동 속도(m/s)
        randomMoveIntervalMs = 50000, // 새 목표 지점을 뽑는 주기
        randomMoveRadius = 800 // 기준 위치로부터 목표 지점을 뽑는 반경(m)
    } = {}) {
        super(map, { id });

        this.modelUrl = modelUrl;
        this.count = count;
        this.labelPrefix = labelPrefix;
        this.rotateOffset = rotateOffset;
        this.elevationOffset = elevationOffset;
        this.scaleMultiplier = scaleMultiplier;
        this.turnRate = turnRate;
        this.speed = speed;
        this.randomMoveRadius = randomMoveRadius;

        this.origin = [origin[0], origin[1]]; // 랜덤 목표 지점을 뽑는 기준 위치
        this.lastFrameTime = null;

        // 자동차별 상태(위치/목표/방향/Object3D/이 프레임의 투영행렬)
        // 처음부터 전부 origin 한 점에 겹쳐서 시작하면 움직여 퍼지기 전까지
        // 여러 모델이 같은 위치에서 z-fighting(깊이 충돌)을 일으켜 깨진 것처럼
        // 보이므로, 시작 위치 자체를 origin 주변에 흩어놓는다.
        this.cars = Array.from({ length: count }, () => ({
            heading: 0,
            position: [origin[0], origin[1]],
            target: [origin[0], origin[1]],
            object3D: null,
            projectionMatrix: new THREE.Matrix4()
        }));
        this.cars.forEach((car) => {
            this.pickRandomTarget(car);
            car.position = [car.target[0], car.target[1]];
            this.pickRandomTarget(car);
        });

        setInterval(() => {
            this.cars.forEach((car) => this.pickRandomTarget(car));
        }, randomMoveIntervalMs);
    }

    pickRandomTarget(car) {
        const latMetersPerDeg = 111320;
        const lngMetersPerDeg = 111320 * Math.cos(this.origin[1] * Math.PI / 180);
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.random() * this.randomMoveRadius;

        car.target = [
            this.origin[0] + (Math.cos(angle) * radius) / lngMetersPerDeg,
            this.origin[1] + (Math.sin(angle) * radius) / latMetersPerDeg
        ];
    }

    static normalizeAngleDiff(diff) {
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        return diff;
    }

    updateCar(car, dt) {
        const latMetersPerDeg = 111320;
        const lngMetersPerDeg = 111320 * Math.cos(car.position[1] * Math.PI / 180);
        const dxMeters = (car.target[0] - car.position[0]) * lngMetersPerDeg;
        const dyMeters = (car.target[1] - car.position[1]) * latMetersPerDeg;
        const distMeters = Math.sqrt(dxMeters * dxMeters + dyMeters * dyMeters);

        if (distMeters > 0) {
            const moveRatio = Math.min(1, (this.speed * dt) / distMeters);
            car.position[0] += (car.target[0] - car.position[0]) * moveRatio;
            car.position[1] += (car.target[1] - car.position[1]) * moveRatio;
        }

        if (distMeters >= 1) {
            const targetHeading = Math.atan2(dxMeters, dyMeters);
            const diff = CarFleet.normalizeAngleDiff(targetHeading - car.heading);
            const maxStep = this.turnRate * dt;
            if (dt === 0 || Math.abs(diff) <= maxStep) {
                car.heading = targetHeading;
            } else {
                // diff는 "목표 heading - 현재 heading"이므로, 그 부호 방향으로
                // 돌려야 최단 경로로 목표를 향해 회전한다. 부호를 뒤집으면 반대
                // 방향(먼 길)으로 돌아서, 처음 목표(dt=0이라 바로 스냅되는 순간)는
                // 방향이 맞다가 회전이 시작되면서부터 엉뚱한 쪽으로 틀어져 보인다.
                car.heading += Math.sign(diff) * maxStep;
            }
        }
    }

    loadModel() {
        this.labels = Array.from(
            { length: this.count },
            (_, i) => new ModelLabel(this.map, `${this.labelPrefix}-${i}`, { updateIntervalMs: 50 })
        );

        const loader = new GLTFLoader();
        loader.load(
            this.modelUrl,
            (gltf) => this.setupCars(gltf),
            undefined,
            (error) => {
                console.error('자동차 편대 모델 로드 실패:', error);
            }
        );
    }

    // 단일 CarModel(carm.js)과 동일하게 gltf.scene 자체(내부 노드 스케일 포함)를
    // 그대로 복제해서 쓴다. clone(true)는 지오메트리/재질은 공유하고 Object3D
    // 계층(변환)만 복제하므로 메모리 부담은 크지 않다. 위치는 object 자체가 아니라
    // 카메라 투영행렬로 표현하므로, 이 오브젝트의 변환은 항상 단위행렬(원점)로 둔다.
    setupCars(gltf) {
        this.modelCenterLocal = BaseModel.computeLabelPointLocal(gltf.scene);

        this.cars.forEach((car) => {
            const object3D = gltf.scene.clone(true);
            this.scene.add(object3D);
            car.object3D = object3D;
        });
    }

    render(gl, args) {
        this.syncRendererSize();

        const now = performance.now();
        const dt = this.lastFrameTime === null ? 0 : (now - this.lastFrameTime) / 1000;
        this.lastFrameTime = now;

        const mainMatrix = args.defaultProjectionData.mainMatrix;
        const labelNdc = this._labelNdc ?? (this._labelNdc = new THREE.Vector3());

        // 2D 화면 좌표 기반 저비용 호버 판정
        const canvas = this.map.getCanvas();
        const pointerNDC = this.hoverOutline.pointerNDC;
        const pointerPx = {
            x: (pointerNDC.x * 0.5 + 0.5) * canvas.width,
            y: (1 - (pointerNDC.y * 0.5 + 0.5)) * canvas.height
        };
        const hoverRadiusPx = 25;
        let hoveredIndex = -1;
        let hoveredDistSq = hoverRadiusPx * hoverRadiusPx;

        // 1단계: 자동차별 위치/방향 갱신 + 이 프레임에 쓸 투영행렬(m*l) 계산
        this.cars.forEach((car, i) => {
            this.updateCar(car, dt);

            // randomMoveRadius가 넓어 자동차가 기준 위치에서 멀리 떨어질 수 있는데,
            // 그 지점 지형 고도가 기준 위치와 다르면(경사/건물 등) 실제 위치 기준
            // 고도를 안 쓰면 지면 아래로 파묻히거나 붕 떠 보이므로, 자동차별로
            // 실제 위치 기준 지형 고도를 매 프레임 조회한다.
            const carElevation = (this.map.queryTerrainElevation(car.position) || 0) + this.elevationOffset;
            const mercator = maplibregl.MercatorCoordinate.fromLngLat(car.position, carElevation);

            const localTransform = BaseModel.buildLocalTransformMatrix({
                translateX: mercator.x,
                translateY: mercator.y,
                translateZ: mercator.z,
                rotateX: this.rotateOffset[0],
                rotateY: (car.heading * -1) + this.rotateOffset[1],
                rotateZ: this.rotateOffset[2] ?? 0,
                scale: mercator.meterInMercatorCoordinateUnits() * this.scaleMultiplier
            });

            car.projectionMatrix.fromArray(mainMatrix).multiply(localTransform);

            if (this.modelCenterLocal) {
                labelNdc.copy(this.modelCenterLocal).applyMatrix4(car.projectionMatrix);
            } else {
                labelNdc.set(0, 0, 0).applyMatrix4(car.projectionMatrix);
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

        // 2단계: 한 대씩 그 차 전용 투영행렬로 바꿔가며 순서대로 그린다.
        // (한 번의 카메라로 10대를 동시에 올바르게 투영할 수 없어서, 단일
        // 모델과 같은 "카메라를 속이는" 방식을 자동차 수만큼 반복한다)
        this.cars.forEach((car) => {
            if (!car.object3D) return;
            this.cars.forEach((other) => {
                if (other.object3D) other.object3D.visible = (other === car);
            });
            this.camera.projectionMatrix = car.projectionMatrix;
            this.renderer.resetState();
            this.renderer.render(this.scene, this.camera);
        });

        // 3단계: 호버 아웃라인 (호버된 자동차 하나만 보이게 하고 그 행렬로 렌더)
        const hoveredCar = hoveredIndex >= 0 ? this.cars[hoveredIndex] : null;
        if (hoveredCar && hoveredCar.object3D) {
            this.cars.forEach((other) => {
                if (other.object3D) other.object3D.visible = (other === hoveredCar);
            });
            this.camera.projectionMatrix = hoveredCar.projectionMatrix;
            this.hoverOutline.setSelected(hoveredCar.object3D);
        } else {
            this.hoverOutline.setSelected(null);
        }
        this.hoverOutline.render();

        // 다음 프레임 전에 전부 보이는 상태로 되돌려, 다른 코드가 visible을
        // 참조하더라도 항상 "그려질 수 있는" 상태를 기본값으로 유지한다.
        this.cars.forEach((car) => {
            if (car.object3D) car.object3D.visible = true;
        });

        this.map.triggerRepaint();
    }
}
