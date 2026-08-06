import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import BaseModel from '../base/BaseModel.js';
import ModelLabel from './modelLabel.js';

// 버스(G7 1350 6x4.obj) 여러 대를 그리는 MapLibre 커스텀 레이어 클래스.
//
// mercator 좌표는 [0,1] 범위지만 실제 위치를 구분하려면 유효숫자가 많이
// 필요해서(미터 단위 정밀도), object.matrixWorld처럼 GPU에 float32로 통째로
// 올라가는 값에 넣으면 정밀도가 깎여 모델이 찌그러져 보인다(자동차 편대에서
// 실제로 겪은 문제). 그래서 단일 버스(bus_g7.js/BUS_G7)와 완전히 같은 방식으로,
// 좌표 변환을 CPU(JS 배정밀도)에서 카메라의 투영행렬에 미리 곱해 넣고(m*l),
// 모델 자체는 항상 원점(단위행렬)에 둔 채로 버스 수만큼 한 대씩 순서대로 그린다.
export default class BusFleet extends BaseModel {
    constructor(map, {
        id = '3d-bus-fleet',
        baseUrl = 'modeling/bus/',
        objFile = 'G7 1350 6x4.obj',
        mtlFile = 'G7 1350 6x4.mtl',
        origin,
        count = 10, // 버스 대수
        labelPrefix = 'BusModel',
        rotateOffset = [Math.PI / 2, 0, 0], // 모델 좌표계 보정용 기본 회전
        elevationOffset = 0,
        scaleMultiplier = 1,
        turnRate = Math.PI, // 회전 속도(rad/sec)
        speed = 8, // 이동 속도(m/s)
        randomMoveIntervalMs = 20000, // 새 목표 지점을 뽑는 주기
        randomMoveRadius = 800, // 기준 위치로부터 목표 지점을 뽑는 반경(m)
        avoidRadius = 20, // 이 거리(m) 안에 다른 버스가 있으면 밀어내는 방향을 섞는다
        avoidWeight = 2.5, // 회피 방향을 목표 방향보다 얼마나 더 세게 반영할지
        // 편대 소속이 아닌 외부 장애물(예: 클릭/경로로 움직이는 단일 버스)의
        // [lng, lat] 위치 목록을 매 프레임 얻어오는 함수. 편대 버스끼리 서로
        // 피하는 것과 같은 로직으로 이 위치들도 함께 피한다.
        getExternalObstacles = () => []
    } = {}) {
        super(map, { id });

        this.baseUrl = baseUrl;
        this.objFile = objFile;
        this.mtlFile = mtlFile;
        this.count = count;
        this.labelPrefix = labelPrefix;
        this.rotateOffset = rotateOffset;
        this.elevationOffset = elevationOffset;
        this.scaleMultiplier = scaleMultiplier;
        this.turnRate = turnRate;
        this.speed = speed;
        this.randomMoveRadius = randomMoveRadius;
        this.avoidRadius = avoidRadius;
        this.avoidWeight = avoidWeight;
        this.getExternalObstacles = getExternalObstacles;

        this.origin = [origin[0], origin[1]]; // 랜덤 목표 지점을 뽑는 기준 위치
        this.lastFrameTime = null;

        // 버스별 상태(위치/목표/방향/Object3D/이 프레임의 투영행렬)
        // 처음부터 전부 origin 한 점에 겹쳐서 시작하면 움직여 퍼지기 전까지
        // 여러 모델이 같은 위치에서 z-fighting(깊이 충돌)을 일으켜 깨진 것처럼
        // 보이므로, 시작 위치 자체를 origin 주변에 흩어놓는다.
        this.buses = Array.from({ length: count }, () => ({
            heading: 0,
            position: [origin[0], origin[1]],
            target: [origin[0], origin[1]],
            object3D: null,
            projectionMatrix: new THREE.Matrix4(),
            idleMs: 0 // 목표에 도착했거나 회피 방향이 서로 상쇄돼 멈춰있던 시간(ms)
        }));
        this.buses.forEach((bus) => {
            this.pickRandomTarget(bus);
            bus.position = [bus.target[0], bus.target[1]];
            this.pickRandomTarget(bus);
        });

        setInterval(() => {
            this.buses.forEach((bus) => this.pickRandomTarget(bus));
        }, randomMoveIntervalMs);
    }

    pickRandomTarget(bus) {
        const latMetersPerDeg = 111320;
        const lngMetersPerDeg = 111320 * Math.cos(this.origin[1] * Math.PI / 180);
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.random() * this.randomMoveRadius;

        bus.target = [
            this.origin[0] + (Math.cos(angle) * radius) / lngMetersPerDeg,
            this.origin[1] + (Math.sin(angle) * radius) / latMetersPerDeg
        ];
    }

    static normalizeAngleDiff(diff) {
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        return diff;
    }

    // 목표에 도착했거나 회피 방향끼리 상쇄돼 멈춰있는 시간을 누적하다가,
    // 3초 넘게 멈춰있으면 randomMoveIntervalMs(전역 주기)를 기다리지 않고
    // 바로 새 목표를 뽑아 다시 움직이게 한다.
    markIdle(bus, dt) {
        bus.idleMs += dt * 1000;
        if (bus.idleMs >= 3000) {
            this.pickRandomTarget(bus);
            bus.idleMs = 0;
        }
    }

    // 목표를 향한 방향(seek)에, 가까운 다른 버스로부터 밀어내는 방향(avoid)을
    // 더해서 최종 진행 방향을 정한다. 실제 이동도 그 목표점까지 직선으로
    // 순간이동하듯 보간하는 게 아니라, 매 프레임 계산된 heading 방향으로
    // speed*dt만큼 "운전하듯" 나아가게 해서 회피 궤적이 실제 이동에 반영되게 한다.
    updateBus(bus, dt) {
        const latMetersPerDeg = 111320;
        const lngMetersPerDeg = 111320 * Math.cos(bus.position[1] * Math.PI / 180);
        const dxMeters = (bus.target[0] - bus.position[0]) * lngMetersPerDeg;
        const dyMeters = (bus.target[1] - bus.position[1]) * latMetersPerDeg;
        const distMeters = Math.sqrt(dxMeters * dxMeters + dyMeters * dyMeters);

        if (distMeters < 1) {
            this.markIdle(bus, dt);
            return;
        }

        let dirX = dxMeters / distMeters;
        let dirY = dyMeters / distMeters;

        // 회피 반경 안의 다른 버스마다 "그 버스 → 나" 방향(밀어내는 방향)을
        // 가까울수록 세게 더한다.
        this.buses.forEach((other) => {
            if (other === bus) return;

            const odx = (bus.position[0] - other.position[0]) * lngMetersPerDeg;
            const ody = (bus.position[1] - other.position[1]) * latMetersPerDeg;
            const odist = Math.sqrt(odx * odx + ody * ody);
            if (odist <= 0 || odist >= this.avoidRadius) return;

            const weight = ((this.avoidRadius - odist) / this.avoidRadius) * this.avoidWeight;
            dirX += (odx / odist) * weight;
            dirY += (ody / odist) * weight;
        });

        // 편대 소속이 아닌 외부 장애물(단일 버스 등)도 같은 방식으로 피한다.
        this.getExternalObstacles().forEach((pos) => {
            const odx = (bus.position[0] - pos[0]) * lngMetersPerDeg;
            const ody = (bus.position[1] - pos[1]) * latMetersPerDeg;
            const odist = Math.sqrt(odx * odx + ody * ody);
            if (odist <= 0 || odist >= this.avoidRadius) return;

            const weight = ((this.avoidRadius - odist) / this.avoidRadius) * this.avoidWeight;
            dirX += (odx / odist) * weight;
            dirY += (ody / odist) * weight;
        });

        const dirLen = Math.sqrt(dirX * dirX + dirY * dirY);
        if (dirLen < 1e-6) {
            // 목표 방향과 회피 방향이 서로 정반대로 상쇄돼 갈 방향이 안 정해진
            // 경우로, 이것도 "멈춰있는" 상태로 취급한다.
            this.markIdle(bus, dt);
            return;
        }
        bus.idleMs = 0;
        dirX /= dirLen;
        dirY /= dirLen;

        const desiredHeading = Math.atan2(dirX, dirY);
        const diff = BusFleet.normalizeAngleDiff(desiredHeading - bus.heading);
        const maxStep = this.turnRate * dt;
        if (dt === 0 || Math.abs(diff) <= maxStep) {
            bus.heading = desiredHeading;
        } else {
            // diff는 "목표 heading - 현재 heading"이므로, 그 부호 방향으로
            // 돌려야 최단 경로로 목표를 향해 회전한다.
            bus.heading += Math.sign(diff) * maxStep;
        }

        const moveMeters = this.speed * dt;
        bus.position[0] += (Math.sin(bus.heading) * moveMeters) / lngMetersPerDeg;
        bus.position[1] += (Math.cos(bus.heading) * moveMeters) / latMetersPerDeg;
    }

    loadModel() {
        this.labels = Array.from(
            { length: this.count },
            (_, i) => new ModelLabel(this.map, `${this.labelPrefix}-${i}`, { updateIntervalMs: 50 })
        );

        const mtlLoader = new MTLLoader();
        mtlLoader.setPath(this.baseUrl);
        mtlLoader.load(
            this.mtlFile,
            (materials) => {
                materials.preload();

                const objLoader = new OBJLoader();
                objLoader.setMaterials(materials);
                objLoader.setPath(this.baseUrl);
                objLoader.load(
                    this.objFile,
                    (object) => this.setupBuses(object),
                    undefined,
                    (error) => {
                        console.error('버스 편대 모델 로드 실패:', error);
                    }
                );
            },
            undefined,
            (error) => {
                console.error('버스 편대 재질(MTL) 로드 실패:', error);
            }
        );
    }

    // 단일 버스(bus_g7.js/BUS_G7)와 동일하게 로드된 Object3D를 그대로 복제해서
    // 쓴다. clone(true)는 지오메트리/재질은 공유하고 Object3D 계층(변환)만
    // 복제하므로 메모리 부담은 크지 않다. 위치는 object 자체가 아니라 카메라
    // 투영행렬로 표현하므로, 이 오브젝트의 변환은 항상 단위행렬(원점)로 둔다.
    setupBuses(object) {
        this.modelCenterLocal = BaseModel.computeLabelPointLocal(object);

        this.buses.forEach((bus) => {
            const object3D = object.clone(true);
            this.scene.add(object3D);
            bus.object3D = object3D;
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

        // 1단계: 버스별 위치/방향 갱신 + 이 프레임에 쓸 투영행렬(m*l) 계산
        this.buses.forEach((bus, i) => {
            this.updateBus(bus, dt);

            // randomMoveRadius가 넓어 버스가 기준 위치에서 멀리 떨어질 수 있는데,
            // 그 지점 지형 고도가 기준 위치와 다르면(경사/건물 등) 실제 위치 기준
            // 고도를 안 쓰면 지면 아래로 파묻히거나 붕 떠 보이므로, 버스별로
            // 실제 위치 기준 지형 고도를 매 프레임 조회한다.
            const busElevation = (this.map.queryTerrainElevation(bus.position) || 0) + this.elevationOffset;
            const mercator = maplibregl.MercatorCoordinate.fromLngLat(bus.position, busElevation);

            const localTransform = BaseModel.buildLocalTransformMatrix({
                translateX: mercator.x,
                translateY: mercator.y,
                translateZ: mercator.z,
                rotateX: this.rotateOffset[0],
                rotateY: (bus.heading * -1) + this.rotateOffset[1],
                rotateZ: this.rotateOffset[2] ?? 0,
                scale: mercator.meterInMercatorCoordinateUnits() * this.scaleMultiplier
            });

            bus.projectionMatrix.fromArray(mainMatrix).multiply(localTransform);

            if (this.modelCenterLocal) {
                labelNdc.copy(this.modelCenterLocal).applyMatrix4(bus.projectionMatrix);
            } else {
                labelNdc.set(0, 0, 0).applyMatrix4(bus.projectionMatrix);
            }
            this.labels[i].updateFromNDC(labelNdc.x, labelNdc.y);
            // idleMs===0이면 이번 프레임에 실제로 움직였다는 뜻(updateBus 참고).
            this.labels[i].setMoving(bus.idleMs === 0);

            const px = (labelNdc.x * 0.5 + 0.5) * canvas.width;
            const py = (1 - (labelNdc.y * 0.5 + 0.5)) * canvas.height;
            const distSq = (px - pointerPx.x) ** 2 + (py - pointerPx.y) ** 2;
            if (distSq < hoveredDistSq) {
                hoveredDistSq = distSq;
                hoveredIndex = i;
            }
        });

        // 2단계: 한 대씩 그 버스 전용 투영행렬로 바꿔가며 순서대로 그린다.
        // (한 번의 카메라로 여러 대를 동시에 올바르게 투영할 수 없어서, 단일
        // 모델과 같은 "카메라를 속이는" 방식을 버스 수만큼 반복한다)
        this.buses.forEach((bus) => {
            if (!bus.object3D) return;
            this.buses.forEach((other) => {
                if (other.object3D) other.object3D.visible = (other === bus);
            });
            this.camera.projectionMatrix = bus.projectionMatrix;
            this.renderer.resetState();
            this.renderer.render(this.scene, this.camera);
        });

        // 3단계: 호버 아웃라인 (호버된 버스 하나만 보이게 하고 그 행렬로 렌더)
        const hoveredBus = hoveredIndex >= 0 ? this.buses[hoveredIndex] : null;
        if (hoveredBus && hoveredBus.object3D) {
            this.buses.forEach((other) => {
                if (other.object3D) other.object3D.visible = (other === hoveredBus);
            });
            this.camera.projectionMatrix = hoveredBus.projectionMatrix;
            this.hoverOutline.setSelected(hoveredBus.object3D);
        } else {
            this.hoverOutline.setSelected(null);
        }
        this.hoverOutline.render();

        // 다음 프레임 전에 전부 보이는 상태로 되돌려, 다른 코드가 visible을
        // 참조하더라도 항상 "그려질 수 있는" 상태를 기본값으로 유지한다.
        this.buses.forEach((bus) => {
            if (bus.object3D) bus.object3D.visible = true;
        });

        this.map.triggerRepaint();
    }
}
