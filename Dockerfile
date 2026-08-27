FROM node:18-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg curl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 3000
ENV PORT=3000
# 配置默认 Cookie（可选）：填入普通账号的 SESSDATA 值，免登录即可下载 1080P
# ENV BILI_SESSDATA=your_sessdata_value_here
CMD ["node", "server.js"]
