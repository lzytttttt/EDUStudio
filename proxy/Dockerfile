# EDUStudio 轻后端代理（v0.5 M4④）
# 构建：docker build -t edustudio-proxy ./proxy
FROM node:20-alpine

WORKDIR /app

# 先装依赖（利用层缓存）
COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY server.mjs ./

# 数据目录：审计日志 + 分享/任务链持久化（挂载卷持久化）
ENV PORT=8787 \
    AUDIT_DIR=/data/logs \
    SHARE_DIR=/data

VOLUME /data
EXPOSE 8787

CMD ["node", "server.mjs"]
