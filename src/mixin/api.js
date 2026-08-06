// 서울시 버스 실시간 위치 API(서버의 /api/bus-position 프록시)를 주기적으로 호출하는 믹스인.
// 컴포넌트 클래스에 다음처럼 섞어 쓴다:
//   import BusApiMixin from '../utils/mixin.js';
//   Object.assign(BUS_G7.prototype, BusApiMixin);
// 이후 인스턴스에서 this.startBusPositionPolling({...}) / this.stopBusPositionPolling()로 사용.
const BusApiMixin = {
    // 서버 프록시(/api/bus-position)를 주기적으로 호출해 버스 위치를 가져온다.
    // 옵션: busRouteId, startOrd, endOrd, intervalMs(기본 5000), onUpdate(positions => void)
    startBusPositionPolling({ busRouteId, startOrd = '1', endOrd = '500', intervalMs = 5000, onUpdate }) {
        this.stopBusPositionPolling();

        const fetchOnce = async () => {
            try {
                const params = new URLSearchParams({ busRouteId, startOrd, endOrd });
                const response = await fetch(`/api/bus-position?${params}`);
                const xmlText = await response.text();
                const positions = BusApiMixin.parseBusPositions(xmlText);
                onUpdate(positions);
            } catch (error) {
                console.error('버스 위치 조회 실패:', error);
            }
        };

        fetchOnce();
        this._busPollingIntervalId = setInterval(fetchOnce, intervalMs);
    },

    stopBusPositionPolling() {
        if (this._busPollingIntervalId) {
            clearInterval(this._busPollingIntervalId);
            this._busPollingIntervalId = null;
        }
    },

    // API 응답 XML(<msgBody><itemList>...</itemList>...</msgBody>)을 파싱해
    // 버스 항목 배열로 변환한다. 실제 필드명은 API 응답을 보고 조정이 필요할 수 있다.
    parseBusPositions(xmlText) {
        const doc = new DOMParser().parseFromString(xmlText, 'application/xml');

        if (doc.querySelector('parsererror')) {
            console.error('버스 위치 응답 XML 파싱 실패:', xmlText);
            return [];
        }

        const headerCd = doc.querySelector('headerCd')?.textContent;
        if (headerCd && headerCd !== '0') {
            console.error('버스 위치 API 오류:', doc.querySelector('headerMsg')?.textContent);
            return [];
        }

        // 실제 응답 필드명은 gpsX/gpsY가 아니라 tmX/tmY(WGS84 경도/위도)다.
        // (posX/posY는 별도의 TM 좌표계라 lng/lat로 바로 쓸 수 없다)
        return Array.from(doc.querySelectorAll('itemList')).map((item) => {
            const get = (tag) => item.querySelector(tag)?.textContent ?? null;
            return {
                plainNo: get('plainNo'),
                vehId: get('vehId'),
                lng: parseFloat(get('tmX')),
                lat: parseFloat(get('tmY')),
                sectOrd: get('sectOrd'),
                stopFlag: get('stopFlag')
            };
        });
    }
};

export default BusApiMixin;
