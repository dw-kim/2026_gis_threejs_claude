import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import BaseModel from '../base/BaseModel.js';
import ModelLabel from './modelLabel.js';

// 버스(G7 1350 6x4.obj) 모델을 지도 위에 배치하는 MapLibre 커스텀 레이어 클래스.
// GLTF가 아니라 OBJ/MTL 포맷이라 OBJLoader + MTLLoader를 사용한다.
export default class BUS_G7 extends BaseModel {
    constructor(map, {
        id = '3d-bus-g7-model',
        baseUrl = 'modeling/bus/',
        objFile = 'G7 1350 6x4.obj',
        mtlFile = 'G7 1350 6x4.mtl',
        origin,
        rotate = [Math.PI / 2, 0, 0],
        elevationOffset = 0,
        scaleMultiplier = 1
    } = {}) {
        super(map, { id });

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

    loadModel() {
        this.label = new ModelLabel(this.map, this.constructor.name);

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
                        this.modelCenterLocal = BaseModel.computeLabelPointLocal(object);
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
    }

    render(gl, args) {
        this.renderSingleModel(args);
    }
}
