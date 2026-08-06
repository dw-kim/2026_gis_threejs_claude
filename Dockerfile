# Fly.io 등 컨테이너 기반 호스팅에 server.js(Express)를 그대로 배포하기 위한 이미지.
# 프론트엔드는 esbuild로 번들링하지 않고 서버가 src/·public/을 그대로 정적
# 서빙하는 구조라(개발 서버와 동일), 빌드 단계 없이 런타임 의존성만 설치한다.
FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install --omit=dev

COPY server.js router.js index.html ./
COPY src ./src
COPY public ./public

# SEOUL_BUS_API_KEY는 이미지에 넣지 않고 `fly secrets set`으로 런타임에 주입한다.
ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
