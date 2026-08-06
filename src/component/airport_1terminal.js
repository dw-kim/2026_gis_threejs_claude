import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import BaseModel from '../base/BaseModel.js';
import ModelLabel from './modelLabel.js';

// 토끼(korean_rabbit.gltf) 모델을 지도 위 고정된 위치에 배치하는
// MapLibre 커스텀 레이어 클래스.
export default class RabbitModel extends BaseModel {
    constructor(map, {
        id = '3d-rabbit-model',
        modelUrl = 'modeling/airport/korean_rabbit.gltf',
        origin,
        rotate = [Math.PI / 2, 0, 0],
        elevationOffset = 0,
        meshScale = [1, 3, 1],
        scaleDivisor = 40
    } = {}) {
        super(map, { id });

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

    loadModel() {
        this.label = new ModelLabel(this.map, this.constructor.name);

        const loader = new GLTFLoader();
        loader.load(
            this.modelUrl,
            (gltf) => {
                gltf.scene.scale.set(this.meshScale[0], this.meshScale[1], this.meshScale[2]);
                this.scene.add(gltf.scene);
                this.modelRoot = gltf.scene;
                this.modelCenterLocal = BaseModel.computeLabelPointLocal(gltf.scene);
            },
            undefined,
            (error) => {
                console.error('토끼 모델 로드 실패:', error);
            }
        );
    }

    render(gl, args) {
        this.renderSingleModel(args);
    }
}
