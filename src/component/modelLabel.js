// 3D 모델 위에 떠 있는 HTML 텍스트 라벨.
// 매 프레임 모델의 정규화된 화면 좌표(NDC)를 받아 픽셀 위치로 갱신한다.
export default class ModelLabel {
    constructor(map, text, { offsetY = 0, updateIntervalMs = 0 } = {}) {
        this.map = map;
        this.offsetY = offsetY;
        this.updateIntervalMs = updateIntervalMs;
        this.lastUpdateTime = 0;

        this.el = document.createElement('div');
        this.el.className = 'model-label';
        this.el.style.display = 'none';

        // 이동 중/정지 상태를 오른쪽 버스 정보 패널과 같은 방식(녹색/빨간색 점)으로 표시
        this.dotEl = document.createElement('span');
        this.dotEl.className = 'model-label-dot';
        this.el.appendChild(this.dotEl);

        this.textEl = document.createElement('span');
        this.textEl.textContent = text;
        this.el.appendChild(this.textEl);

        map.getContainer().appendChild(this.el);
    }

    // 이동 중이면 녹색, 멈춰있으면 빨간색으로 표시한다.
    setMoving(isMoving) {
        this.dotEl.style.background = isMoving ? '#4caf50' : '#f44336';
    }

    // ndcX, ndcY: THREE.Vector3.applyMatrix4()로 얻은 -1~1 범위의 정규화된 화면 좌표
    updateFromNDC(ndcX, ndcY) {
        const now = performance.now();
        // 기본값은 스로틀링 없음(매 프레임 갱신) — 모델이 매 프레임 부드럽게 움직이는데
        // 라벨만 느리게 갱신되면 따로 노는 것처럼 끊겨 보인다. 인스턴스가 아주 많은
        // 경우(예: 비행기 편대)에만 updateIntervalMs를 옵션으로 넘겨 부담을 줄인다.
        if (this.updateIntervalMs > 0 && now - this.lastUpdateTime < this.updateIntervalMs) return;
        this.lastUpdateTime = now;

        const canvas = this.map.getCanvas();
        const width = canvas.clientWidth;
        const height = canvas.clientHeight;

        const x = (ndcX * 0.5 + 0.5) * width;
        const y = (1 - (ndcY * 0.5 + 0.5)) * height + this.offsetY;

        this.el.style.display = 'flex';
        // left/top(레이아웃 리플로우 유발) 대신 transform(합성만 발생)으로 위치 갱신
        // translate(-50%, -50%): 라벨을 모델 원점(정가운데) 기준으로 정렬
        this.el.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
    }

    remove() {
        this.el.remove();
    }
}
