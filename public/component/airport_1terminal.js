import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import ModelLabel from './modelLabel.js';
import HoverOutline from '../effect/hoverOutline.js';

// 토끼(korean_rabbit.gltf) 모델을 지도 위 고정된 위치에 배치하는
// MapLibre 커스텀 레이어 클래스.
export default class RabbitModel {
    constructor(map, {
        id = '3d-rabbit-model',
        modelUrl = '/modeling/airport/korean_rabbit.gltf',
        origin,
        rotate = [Math.PI / 2, 0, 0],
        elevationOffset = 0,
        meshScale = [1, 3, 1],
        scaleDivisor = 40
    }) {
        this.id = id;
        this.type = 'custom';
        this.renderingMode = '3d';

        this.map = map;
        this.modelUrl = modelUrl;
        this.origin = origin;
        this.rotate = rotate;
        this.elevationOffset = elevationOffset;
        this.meshScale = meshScale;
        this.scaleDivisor = scaleDivisor;
    }

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
            scale: modelAsMercatorCoordinate.meterInMercatorCoordinateUnits() / this.scaleDivisor
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
                gltf.scene.scale.set(this.meshScale[0], this.meshScale[1], this.meshScale[2]);
                this.scene.add(gltf.scene);
                this.modelRoot = gltf.scene;
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

        this.label = new ModelLabel(map, this.constructor.name);
        this.hoverOutline = new HoverOutline(map, this.renderer, this.scene, this.camera);
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

        if (this.modelRoot) {
            this.hoverOutline.setTargets([this.modelRoot]);
            const hit = this.hoverOutline.pickHover();
            this.hoverOutline.setSelected(hit ? this.modelRoot : null);
            this.hoverOutline.render();
        }

        this.map.triggerRepaint();
    }
}
