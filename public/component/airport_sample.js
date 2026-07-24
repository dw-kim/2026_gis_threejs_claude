import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import ModelLabel from './modelLabel.js';

// 공항(airport.gltf) 모델을 지도 위에 배치하는 MapLibre 커스텀 레이어 클래스.
// origin/elevationOffset은 외부(마우스 드래그 등)에서 실시간으로 바꿀 수 있도록
// public 인스턴스 속성으로 노출한다.
export default class AirportModel {
    constructor(map, {
        id = '3d-airport-model',
        modelUrl = '/modeling/airport/airport.gltf',
        origin,
        rotate = [Math.PI / 2, 0, 0],
        elevationOffset = 0,
        scaleMultiplier = 3
    }) {
        this.id = id;
        this.type = 'custom';
        this.renderingMode = '3d';

        this.map = map;
        this.modelUrl = modelUrl;
        this.origin = origin; // [lng, lat], 드래그 등으로 실시간 변경 가능
        this.rotate = rotate;
        this.elevationOffset = elevationOffset; // 값을 더 낮추면(음수를 키우면) 모델이 지면 아래로 더 내려감
        this.scaleMultiplier = scaleMultiplier;
    }

    // terrain이 켜져 있으면 지표면 높이가 0(해수면)이 아니므로,
    // 매 프레임 해당 지점의 실제 지형 고도를 구해 모델을 지면에 붙인다.
    getModelTransform() {
        const elevation = (this.map.queryTerrainElevation(this.origin) || 0) + this.elevationOffset;
        const modelAsMercatorCoordinate = maplibregl.MercatorCoordinate.fromLngLat(
            this.origin,
            elevation
        );

        return {
            translateX: modelAsMercatorCoordinate.x,
            translateY: modelAsMercatorCoordinate.y,
            translateZ: modelAsMercatorCoordinate.z,
            rotateX: this.rotate[0],
            rotateY: this.rotate[1],
            rotateZ: this.rotate[2],
            // 미터 단위를 머케이터 좌표 단위로 환산 (모델 스케일 조정 시 여기에 배율을 곱하면 됨)
            scale: modelAsMercatorCoordinate.meterInMercatorCoordinateUnits() * this.scaleMultiplier
        };
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

        this.label = new ModelLabel(map, this.constructor.name);
    }

    render(gl, args) {
        const modelTransform = this.getModelTransform();

        const rotationX = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(1, 0, 0), modelTransform.rotateX);
        const rotationY = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(0, 1, 0), modelTransform.rotateY);
        const rotationZ = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(0, 0, 1), modelTransform.rotateZ);

        const m = new THREE.Matrix4().fromArray(args.defaultProjectionData.mainMatrix);

        // 모델 원점(translate)을 화면 좌표로 투영해 라벨을 같은 위치로 갱신
        const labelNdc = new THREE.Vector3(
            modelTransform.translateX,
            modelTransform.translateY,
            modelTransform.translateZ
        ).applyMatrix4(m);
        this.label.updateFromNDC(labelNdc.x, labelNdc.y);

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
}
