import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import apiRouter from './router.js';

// .env는 시크릿이라 커밋/배포 산출물에 포함되지 않는다. 프로덕션에서는 플랫폼이
// 환경변수를 직접 주입하는 경우가 많으므로, 파일이 없어도(loadEnvFile이 예외를 던져도)
// 서버가 죽지 않고 기존 process.env(있다면)로 계속 동작하게 한다.
try {
    process.loadEnvFile();
} catch (error) {
    if (error.code !== 'ENOENT') throw error;
    console.warn('.env 파일을 찾을 수 없어 건너뜁니다. 환경변수가 이미 설정되어 있다면 문제 없습니다.');
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

const PORT = process.env.PORT || 3000;

// index.html/app.js 등 소스는 src/, 3D 모델/이미지 같은 정적 자산은 public/에 있어서
// 둘 다 같은 루트 경로('/')로 서빙한다 (겹치는 파일명이 없어 순서는 상관없다).
app.use(express.static(path.join(__dirname, 'src')));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', apiRouter);

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

httpServer.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
