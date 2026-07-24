// 3D 모델 위에 떠 있는 HTML 텍스트 라벨.
// 매 프레임 모델의 정규화된 화면 좌표(NDC)를 받아 픽셀 위치로 갱신한다.
export default class ModelLabel {
    constructor(map, text, { offsetY = -30, updateIntervalMs = 50 } = {}) {
        this.map = map;
        this.offsetY = offsetY;
        this.updateIntervalMs = updateIntervalMs;
        this.lastUpdateTime = 0;

        this.el = document.createElement('div');
        this.el.className = 'model-label';
        this.el.textContent = text;
        this.el.style.display = 'none';

        map.getContainer().appendChild(this.el);
    }

    // ndcX, ndcY: THREE.Vector3.applyMatrix4()로 얻은 -1~1 범위의 정규화된 화면 좌표
    updateFromNDC(ndcX, ndcY) {
        const now = performance.now();
        // left/top 대신 매번 갱신하면 비행기 수가 많을 때 부담이 크므로
        // 초당 갱신 횟수를 제한한다 (기본 20fps).
        if (now - this.lastUpdateTime < this.updateIntervalMs) return;
        this.lastUpdateTime = now;

        const canvas = this.map.getCanvas();
        const width = canvas.clientWidth;
        const height = canvas.clientHeight;

        const x = (ndcX * 0.5 + 0.5) * width;
        const y = (1 - (ndcY * 0.5 + 0.5)) * height + this.offsetY;

        this.el.style.display = 'block';
        // left/top(레이아웃 리플로우 유발) 대신 transform(합성만 발생)으로 위치 갱신
        this.el.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -100%)`;
    }

    remove() {
        this.el.remove();
    }
}
