import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import BaseModel from '../base/BaseModel.js';
import ModelLabel from './modelLabel.js';

// 자동차(carm.gltf) 모델을 지도 위에 배치하는 MapLibre 커스텀 레이어 클래스.
// bus_g7.js(BUS_G7)와 옵션 이름(rotate/elevationOffset/scaleMultiplier)을 맞춰서
// app.js에서 거의 그대로 교체해 쓸 수 있게 했다.
export default class CarModel extends BaseModel {
    constructor(map, {
        id = '3d-car-model',
        modelUrl = 'modeling/carm/carm.gltf',
        origin,
        rotate = [Math.PI / 2, 0, 0],
        elevationOffset = 0,
        scaleMultiplier = 1
    } = {}) {
        super(map, { id });

        this.modelUrl = modelUrl;
        this.origin = origin; // [lng, lat], 클릭 이동 등으로 실시간 변경 가능
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

    loadModel() {
        this.label = new ModelLabel(this.map, this.constructor.name);

        const loader = new GLTFLoader();
        loader.load(
            this.modelUrl,
            (gltf) => {
                this.scene.add(gltf.scene);
                this.modelRoot = gltf.scene;
                this.modelCenterLocal = BaseModel.computeLabelPointLocal(gltf.scene);
            },
            undefined,
            (error) => {
                console.error('자동차(carm) 모델 로드 실패:', error);
            }
        );
    }

    render(gl, args) {
        this.renderSingleModel(args);
    }
}
