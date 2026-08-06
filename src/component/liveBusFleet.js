import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import BaseModel from '../base/BaseModel.js';
import ModelLabel from './modelLabel.js';

// 서울시 버스 실시간 위치 API(BusApiMixin)가 주는 데이터로 버스를 그리는
// MapLibre 커스텀 레이어. 항목 수(itemList 개수)가 호출마다 달라질 수 있어,
// plainNo(차량 번호판)를 키로 버스별 Object3D/라벨을 새로 만들거나 재사용하거나
// 없어지면 정리한다. 이미 있는 버스는 새 좌표로 순간이동하지 않고, API 호출
// 주기(5초)에 맞춰 부드럽게 이동하도록 보간한다. 렌더 방식은 busFleet.js와
// 동일하게, 좌표를 카메라 투영행렬에 CPU에서 미리 곱해 넣고(m*l) 버스 수만큼
// 한 대씩 순서대로 그린다 — GPU에 float32 modelMatrix로 mercator 좌표를
// 올렸을 때 정밀도가 깎여 모델이 찌그러져 보이는 문제를 피하기 위해서다.
export default class LiveBusFleet extends BaseModel {
    constructor(map, {
        id = '3d-live-bus-fleet',
        // 절대경로('/modeling/...')로 쓰면 GitHub Pages처럼 사이트가 도메인
        // 루트가 아니라 서브경로(레포명)에 떠 있을 때 그 경로를 무시하고 도메인
        // 루트를 가리켜버려 404가 난다. 상대경로로 두면 현재 페이지 위치 기준으로
        // 풀려서 로컬 개발 서버/정적 호스팅(GitHub Pages) 양쪽에서 다 맞는다.
        baseUrl = 'modeling/bus/',
        objFile = 'G7 1350 6x4.obj',
        mtlFile = 'G7 1350 6x4.mtl',
        rotateOffset = [Math.PI / 2, 0, 0],
        elevationOffset = 0,
        scaleMultiplier = 1,
        moveDurationMs = 5000 // 위치 갱신 시 새 좌표까지 부드럽게 이동하는 데 걸리는 시간
    } = {}) {
        super(map, { id });

        this.baseUrl = baseUrl;
        this.objFile = objFile;
        this.mtlFile = mtlFile;
        this.rotateOffset = rotateOffset;
        this.elevationOffset = elevationOffset;
        this.scaleMultiplier = scaleMultiplier;
        this.moveDurationMs = moveDurationMs;

        this.template = null; // 복제용으로 한 번만 로드해두는 원본 Object3D
        this.modelCenterLocal = null;
        this.busesById = new Map(); // plainNo -> bus 상태
        this.busList = []; // render()에서 순서대로 도는 배열 (setBuses 때만 재생성)
        this.pendingBuses = null; // 모델 로드가 끝나기 전에 setBuses가 불리면 대기시켜둔다
    }

    loadModel() {
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
                    (object) => {
                        this.template = object;
                        this.modelCenterLocal = BaseModel.computeLabelPointLocal(object);

                        if (this.pendingBuses) {
                            this.setBuses(this.pendingBuses);
                            this.pendingBuses = null;
                        }
                    },
                    undefined,
                    (error) => console.error('실시간 버스 모델 로드 실패:', error)
                );
            },
            undefined,
            (error) => console.error('실시간 버스 재질(MTL) 로드 실패:', error)
        );
    }

    // items: [{ id, label, lng, lat }] — isMoving은 직전 좌표와 비교해 이 안에서 직접 계산한다.
    // API 응답을 받을 때마다 통째로 호출한다 — 기존에 있던 plainNo는 그 자리에서
    // 새 좌표로 순간이동시키지 않고 moveDurationMs(기본 5초)에 걸쳐 부드럽게
    // 이동하도록 애니메이션을 시작시키고, 새로 나타난 plainNo는 Object3D/라벨을
    // 새로 만들며, 이번 응답에 없는(운행 종료 등) plainNo는 지운다.
    setBuses(items) {
        if (!this.template) {
            this.pendingBuses = items;
            return;
        }

        const now = performance.now();
        const seenIds = new Set();

        items.forEach((item) => {
            seenIds.add(item.id);

            let bus = this.busesById.get(item.id);
            if (!bus) {
                const object3D = this.template.clone(true);
                this.scene.add(object3D);

                // 처음 나타난 버스는 애니메이션 없이 바로 그 위치에 배치한다.
                // 직전 위치가 없어 실제로 움직였는지는 알 수 없지만, 처음
                // 생성됐을 때는 기본값으로 이동 중(녹색)으로 표시한다.
                bus = {
                    object3D,
                    modelLabel: new ModelLabel(this.map, item.label),
                    projectionMatrix: new THREE.Matrix4(),
                    lng: item.lng,
                    lat: item.lat,
                    heading: 0,
                    isMoving: true,
                    fromLng: item.lng,
                    fromLat: item.lat,
                    toLng: item.lng,
                    toLat: item.lat,
                    moveStartTime: now,
                    moveDurationMs: 0
                };
                this.busesById.set(item.id, bus);
            } else {
                // 이미 있는 버스는 현재 화면에 보이는(보간 중인) 위치에서 새로
                // 받은 좌표까지 다시 처음부터 이동을 시작한다.
                this.updateInterpolatedPosition(bus, now);

                // API의 stopFlag는 "정류소에 정차 중인지"를 나타낼 뿐 실제 이동
                // 여부와는 다르므로, 직전 좌표와 이번 좌표의 실제 거리 차이로
                // 이동 중인지 판단한다(수 미터 이하는 GPS 오차로 보고 정지 취급).
                const latMetersPerDeg = 111320;
                const lngMetersPerDeg = 111320 * Math.cos(bus.lat * Math.PI / 180);
                const dx = (item.lng - bus.lng) * lngMetersPerDeg;
                const dy = (item.lat - bus.lat) * latMetersPerDeg;
                const distMeters = Math.sqrt(dx * dx + dy * dy);

                bus.isMoving = distMeters > 3;
                if (bus.isMoving) {
                    bus.heading = Math.atan2(dx, dy);
                }

                bus.fromLng = bus.lng;
                bus.fromLat = bus.lat;
                bus.toLng = item.lng;
                bus.toLat = item.lat;
                bus.moveStartTime = now;
                bus.moveDurationMs = this.moveDurationMs;
            }

            bus.label = item.label;
        });

        Array.from(this.busesById.keys()).forEach((id) => {
            if (seenIds.has(id)) return;

            const bus = this.busesById.get(id);
            this.scene.remove(bus.object3D);
            bus.modelLabel.remove();
            this.busesById.delete(id);
        });

        this.busList = Array.from(this.busesById.values());
    }

    // bus.lng/bus.lat을 현재 시각 기준으로 보간된 값으로 갱신한다.
    updateInterpolatedPosition(bus, now) {
        const t = bus.moveDurationMs > 0 ? Math.min(1, (now - bus.moveStartTime) / bus.moveDurationMs) : 1;
        bus.lng = bus.fromLng + (bus.toLng - bus.fromLng) * t;
        bus.lat = bus.fromLat + (bus.toLat - bus.fromLat) * t;
    }

    render(gl, args) {
        this.syncRendererSize();

        const mainMatrix = args.defaultProjectionData.mainMatrix;
        const labelNdc = this._labelNdc ?? (this._labelNdc = new THREE.Vector3());
        const now = performance.now();

        // 1단계: 버스별로 보간된 현재 위치를 갱신하고, 이 프레임에 쓸
        // 투영행렬(m*l)과 라벨 위치를 계산한다.
        this.busList.forEach((bus) => {
            this.updateInterpolatedPosition(bus, now);

            const elevation = (this.map.queryTerrainElevation([bus.lng, bus.lat]) || 0) + this.elevationOffset;
            const mercator = maplibregl.MercatorCoordinate.fromLngLat([bus.lng, bus.lat], elevation);

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
                bus.modelLabel.updateFromNDC(labelNdc.x, labelNdc.y);
                bus.modelLabel.setMoving(bus.isMoving);
            }
        });

        // 2단계: 한 대씩 그 버스 전용 투영행렬로 바꿔가며 순서대로 그린다.
        this.busList.forEach((bus) => {
            this.busList.forEach((other) => {
                other.object3D.visible = (other === bus);
            });
            this.camera.projectionMatrix = bus.projectionMatrix;
            this.renderer.resetState();
            this.renderer.render(this.scene, this.camera);
        });

        this.busList.forEach((bus) => {
            bus.object3D.visible = true;
        });

        this.map.triggerRepaint();
    }
}
