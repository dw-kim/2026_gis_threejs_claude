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
                // 라벨 위치(로컬 좌표): x/z는 바운딩 박스 중앙, y는 바닥에서
                // "높이 * 1.2" 만큼 띄운 지점(모델 꼭대기보다 살짝 위)으로 정정.
                const box = new THREE.Box3().setFromObject(gltf.scene);
                const center = box.getCenter(new THREE.Vector3());
                const height = box.max.y - box.min.y;
                this.modelCenterLocal = new THREE.Vector3(center.x, box.min.y + height * 1.2, center.z);
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

        const l = new THREE.Matrix4()
            .makeTranslation(modelTransform.translateX, modelTransform.translateY, modelTransform.translateZ)
            .scale(new THREE.Vector3(modelTransform.scale, -modelTransform.scale, modelTransform.scale))
            .multiply(rotationX)
            .multiply(rotationY)
            .multiply(rotationZ);

        this.camera.projectionMatrix = m.multiply(l);

        // 모델의 바운딩 박스 중심(로컬 좌표)을 (m*l)로 그대로 투영하면
        // 화면상 모델의 정가운데(width/2, height/2) 좌표가 나온다.
        if (this.modelCenterLocal) {
            const labelNdc = this.modelCenterLocal.clone().applyMatrix4(this.camera.projectionMatrix);
            this.label.updateFromNDC(labelNdc.x, labelNdc.y);
        }

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
