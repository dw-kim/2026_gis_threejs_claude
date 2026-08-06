import express from 'express';
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

const PORT = process.env.PORT || 3000;

// index.html은 프로젝트 루트에 있지만, 루트 전체를 정적으로 열면 server.js/
// package.json 같은 소스가 그대로 노출되므로 이 파일 하나만 명시적으로 서빙한다.
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// app.js/component 등 나머지 프론트 소스는 src/, 3D 모델/이미지 같은 정적 자산은
// public/에 있어서 둘 다 같은 루트 경로('/')로 서빙한다 (겹치는 파일명이 없어 순서는 상관없다).
app.use(express.static(path.join(__dirname, 'src')));
app.use(express.static(path.join(__dirname, 'public')));

// GitHub Pages(정적 호스팅)처럼 프론트엔드가 이 서버와 다른 origin에서 도는
// 경우를 위해 /api만 CORS를 열어준다. 읽기 전용 공개 데이터 프록시라 쿠키/인증
// 없이 GET만 쓰므로 Access-Control-Allow-Origin을 넓게 허용해도 위험이 없다.
app.use('/api', (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    next();
}, apiRouter);

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
