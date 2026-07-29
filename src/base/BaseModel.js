import * as THREE from 'three';
import HoverOutline from '../effect/hoverOutline.js';

// 지도 위에 three.js 3D 모델을 올리는 MapLibre 커스텀 레이어들이 공통으로 쓰는
// 카메라/씬/조명/렌더러/호버 아웃라인 초기화와, 좌표 변환·라벨 위치 계산 로직을 모아둔 베이스 클래스.
// 각 모델 컴포넌트는 이 클래스를 상속해서 loadModel()/render()만 구현하면 된다.
export default class BaseModel {
    constructor(map, { id } = {}) {
        this.id = id;
        this.type = 'custom';
        this.renderingMode = '3d';
        this.map = map;
    }

    // 방향광 2개 + 주변광. 방향광만 있으면 그림자 쪽 면이 새까맣게 나와 깨져
    // 보이므로 모든 모델 레이어가 동일하게 주변광을 더해 쓴다.
    addDefaultLights() {
        const directionalLight = new THREE.DirectionalLight(0xffffff);
        directionalLight.position.set(0, -70, 100).normalize();
        this.scene.add(directionalLight);

        const directionalLight2 = new THREE.DirectionalLight(0xffffff);
        directionalLight2.position.set(0, 70, 100).normalize();
        this.scene.add(directionalLight2);

        this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    }

    // MapLibre 커스텀 레이어 공통 초기화. 실제 모델 로딩(GLTF/OBJ 등)은
    // 서브클래스가 구현하는 loadModel()에 위임한다.
    onAdd(map, gl) {
        this.map = map;
        this.camera = new THREE.Camera();
        this.scene = new THREE.Scene();
        this.addDefaultLights();

        this.renderer = new THREE.WebGLRenderer({
            canvas: map.getCanvas(),
            context: gl,
            antialias: true
        });
        this.renderer.autoClear = false;

        this.hoverOutline = new HoverOutline(map, this.renderer, this.scene, this.camera);

        this._lastCanvasWidth = map.getCanvas().width;
        this._lastCanvasHeight = map.getCanvas().height;

        this.loadModel();
    }

    // WebGLRenderer는 생성 시점의 캔버스 크기를 내부적으로 기억해두는데, 브라우저
    // 창 크기를 바꿔서 MapLibre가 캔버스 크기를 바꿔도 이 내부 뷰포트는 저절로
    // 갱신되지 않는다. 그대로 두면 렌더링(모델, 호버 아웃라인 포함)이 예전 캔버스
    // 크기 기준으로 그려져 위치가 어긋나므로, 크기가 바뀌었으면 매 프레임 동기화한다.
    syncRendererSize() {
        const canvas = this.map.getCanvas();
        if (canvas.width !== this._lastCanvasWidth || canvas.height !== this._lastCanvasHeight) {
            this.renderer.setSize(canvas.width, canvas.height, false);
            this._lastCanvasWidth = canvas.width;
            this._lastCanvasHeight = canvas.height;
        }
    }

    // 서브클래스에서 구현: 모델 로더 호출, this.modelRoot/this.modelCenterLocal/라벨 설정 등
    loadModel() {
        throw new Error(`${this.constructor.name}.loadModel()을 구현해야 합니다.`);
    }

    // 서브클래스에서 구현: MapLibre가 매 프레임 호출
    render(gl, args) {
        throw new Error(`${this.constructor.name}.render()를 구현해야 합니다.`);
    }

    // 로드된 Object3D의 로컬 바운딩 박스에서 라벨 위치를 계산한다.
    // x/z는 바운딩 박스 중앙, y는 바닥에서 "높이 * 1.2" 만큼 띄운 지점(모델 꼭대기보다 살짝 위).
    static computeLabelPointLocal(object) {
        return BaseModel.computeLabelPointFromBox(new THREE.Box3().setFromObject(object));
    }

    // 이미 만들어진 BufferGeometry(예: 여러 메시를 병합한 지오메트리)에 대해 같은 계산을 수행
    static computeLabelPointFromGeometry(geometry) {
        geometry.computeBoundingBox();
        return BaseModel.computeLabelPointFromBox(geometry.boundingBox);
    }

    static computeLabelPointFromBox(box) {
        const center = box.getCenter(new THREE.Vector3());
        const height = box.max.y - box.min.y;
        return new THREE.Vector3(center.x, box.min.y + height * 1.5, center.z);
    }

    // rotateX/Y/Z + translate + scale로 로컬(모델) -> 월드(mercator) 변환행렬을 만든다.
    static buildLocalTransformMatrix(modelTransform) {
        const rotationX = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(1, 0, 0), modelTransform.rotateX);
        const rotationY = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(0, 1, 0), modelTransform.rotateY);
        const rotationZ = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(0, 0, 1), modelTransform.rotateZ);

        return new THREE.Matrix4()
            .makeTranslation(modelTransform.translateX, modelTransform.translateY, modelTransform.translateZ)
            .scale(new THREE.Vector3(modelTransform.scale, -modelTransform.scale, modelTransform.scale))
            .multiply(rotationX)
            .multiply(rotationY)
            .multiply(rotationZ);
    }

    // 위치가 고정된 단일 모델(토끼, 버스 등) 공통 렌더 루틴.
    // getModelTransform()을 구현하고 loadModel()에서 this.modelRoot/this.modelCenterLocal/
    // this.label을 채워두는 서브클래스가 render(gl, args)에서 그대로 호출하면 된다.
    renderSingleModel(args) {
        this.syncRendererSize();

        const modelTransform = this.getModelTransform();
        const m = new THREE.Matrix4().fromArray(args.defaultProjectionData.mainMatrix);
        const l = BaseModel.buildLocalTransformMatrix(modelTransform);

        this.camera.projectionMatrix = m.multiply(l);

        // 모델의 바운딩 박스 중심(로컬 좌표)을 (m*l)로 그대로 투영하면
        // 화면상 모델의 정가운데(width/2, height/2) 좌표가 나온다.
        if (this.modelCenterLocal && this.label) {
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
