import express from 'express';

const router = express.Router();

// 서울시 버스 실시간 위치 조회 (TOPIS, getBusPosByRouteSt)
// - serviceKey는 서버에만 보관하고(.env), 클라이언트에는 절대 내려주지 않는다.
// - ws.bus.go.kr는 브라우저에서 직접 호출 시 CORS로 막히는 서버용 API라 여기서 프록시한다.
const BUS_API_URL = 'http://ws.bus.go.kr/api/rest/buspos/getBusPosByRouteSt';

router.get('/bus-position', async (req, res) => {
    const busRouteId = req.query.busRouteId || '113900012';
    const startOrd = req.query.startOrd || '1';
    const endOrd = req.query.endOrd || '10';

    const params = new URLSearchParams({
        serviceKey: process.env.SEOUL_BUS_API_KEY,
        busRouteId,
        startOrd,
        endOrd
    });

    try {
        const response = await fetch(`${BUS_API_URL}?${params}`);
        const xmlText = await response.text();
        // API가 XML로 응답하므로 그대로 전달하고, 파싱은 브라우저 내장 DOMParser로 클라이언트에서 한다.
        res.type('application/xml').send(xmlText);
    } catch (error) {
        console.error('버스 위치 조회 실패:', error);
        res.status(502).json({ error: '버스 위치 조회 실패', detail: error.message });
    }
});

export default router;
