import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import ModelLabel from './modelLabel.js';
import HoverOutline from '../effect/hoverOutline.js';

// 버스(G7 1350 6x4.obj) 모델을 지도 위에 배치하는 MapLibre 커스텀 레이어 클래스.
// GLTF가 아니라 OBJ/MTL 포맷이라 OBJLoader + MTLLoader를 사용한다.
export default class BUS_G7 {
    constructor(map, {
        id = '3d-bus-g7-model',
        baseUrl = '/modeling/bus/',
        objFile = 'G7 1350 6x4.obj',
        mtlFile = 'G7 1350 6x4.mtl',
        origin,
        rotate = [Math.PI / 2, 0, 0],
        elevationOffset = 0,
        scaleMultiplier = 1
    }) {
        this.id = id;
        this.type = 'custom';
        this.renderingMode = '3d';

        this.map = map;
        this.baseUrl = baseUrl;
        this.objFile = objFile;
        this.mtlFile = mtlFile;
        this.origin = origin; // [lng, lat], 드래그 등으로 실시간 변경 가능
        this.rotate = rotate;
        this.elevationOffset = elevationOffset;
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
                        this.scene.add(object);
                        this.modelRoot = object;
                        // 라벨 위치(로컬 좌표): x/z는 바운딩 박스 중앙, y는 바닥에서
                        // "높이 * 1.2" 만큼 띄운 지점(모델 꼭대기보다 살짝 위)으로 정정.
                        const box = new THREE.Box3().setFromObject(object);
                        const center = box.getCenter(new THREE.Vector3());
                        const height = box.max.y - box.min.y;
                        this.modelCenterLocal = new THREE.Vector3(center.x, box.min.y + height * 1.2, center.z);
                    },
                    undefined,
                    (error) => {
                        console.error('버스(G7) 모델 로드 실패:', error);
                    }
                );
            },
            undefined,
            (error) => {
                console.error('버스(G7) 재질(MTL) 로드 실패:', error);
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
