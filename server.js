import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

process.loadEnvFile();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// Store connected users' locations
const users = new Map();

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('update-location', (data) => {
    // data: { lat: number, lng: number }
    users.set(socket.id, data);
    io.emit('locations-updated', Array.from(users.entries()));
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    users.delete(socket.id);
    io.emit('locations-updated', Array.from(users.entries()));
  });
});

// 서울시 버스 실시간 위치 조회 (테스트용 노선 ID)
const BUS_API_URL = 'http://ws.bus.go.kr/api/rest/buspos/getBusPosByRouteSt';
const BUS_ROUTE_ID = '113900012';

async function fetchBusPositions() {
  const params = new URLSearchParams({
    serviceKey: process.env.SEOUL_BUS_API_KEY,
    busRouteId: BUS_ROUTE_ID,
    startOrd: '1',
    endOrd: '10'
  });

  try {
    const response = await fetch(`${BUS_API_URL}?${params}`);
    const body = await response.text();
    console.log('[버스 위치]', body);
  } catch (err) {
    console.error('버스 위치 조회 실패:', err);
  }
}

setInterval(fetchBusPositions, 5000);
fetchBusPositions();

httpServer.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
