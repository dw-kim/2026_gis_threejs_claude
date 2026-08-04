import * as THREE from 'three';

// 경로 지점(GPS 좌표)마다 순번 아이콘을 표시하는 MapLibre 커스텀 레이어.
//
// maplibregl.Marker는 지형 위에 올리려고 매 프레임 내부적으로 지형 고도를 다시
// 조회하는데, 그 조회 함수 자체가 줌/피치에 따라 값이 들쭉날쭉한 상위(maplibre-gl-js)
// 버그가 있어(https://github.com/maplibre/maplibre-gl-js/issues/6701) 카메라를
// 회전/틸트할 때마다 아이콘이 미세하게 흔들려 보인다. 이 지도는 terrain
// exaggeration을 0으로 둬서 어차피 지표면을 평평하게(고도 0) 그리므로, 고도를
// 직접 0으로 고정해서 지도의 실제 투영행렬(mainMatrix)로 우리가 직접 투영하면
// 그 흔들림 없이 GPS 좌표에 완전히 고정된다(3D 모델 라벨과 같은 방식).
export default class RoutePointIcons {
    constructor(map, points, { id = 'route-point-icons', className = 'shuttle-point-icon' } = {}) {
        this.id = id;
        this.type = 'custom';
        this.renderingMode = '2d';
        this.map = map;

        this.mercators = points.map((p) => maplibregl.MercatorCoordinate.fromLngLat([p.lng, p.lat], 0));

        this.elements = points.map((p, i) => {
            const el = document.createElement('div');
            el.className = className;
            el.innerHTML = `<span>${i + 1}</span>`;
            el.style.position = 'absolute';
            el.style.left = '0';
            el.style.top = '0';
            el.style.pointerEvents = 'none';
            map.getContainer().appendChild(el);
            return el;
        });

        this._m = new THREE.Matrix4();
        this._point = new THREE.Vector3();
    }

    onAdd() {}

    render(gl, args) {
        const canvas = this.map.getCanvas();
        const width = canvas.clientWidth;
        const height = canvas.clientHeight;

        this._m.fromArray(args.defaultProjectionData.mainMatrix);

        this.mercators.forEach((mercator, i) => {
            this._point.set(mercator.x, mercator.y, mercator.z).applyMatrix4(this._m);

            const x = (this._point.x * 0.5 + 0.5) * width;
            const y = (1 - (this._point.y * 0.5 + 0.5)) * height;
            this.elements[i].style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -100%)`;
        });

        this.map.triggerRepaint();
    }

    remove() {
        this.elements.forEach((el) => el.remove());
    }
}
