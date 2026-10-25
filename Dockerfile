# syntax=docker/dockerfile:1
# Multi-platform: docker buildx build --platform linux/arm64,linux/amd64 .
FROM node:22-bookworm-slim AS client
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

FROM node:22-bookworm-slim AS server
WORKDIR /app/server
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY server/package*.json ./
RUN npm ci
COPY server/ ./
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=4000 DATA_DIR=/data CLIENT_DIR=/app/client/dist
WORKDIR /app/server
COPY --from=server /app/server/node_modules ./node_modules
COPY --from=server /app/server/dist ./dist
COPY --from=server /app/server/package.json ./
COPY --from=client /app/client/dist /app/client/dist
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 4000
CMD ["node", "dist/index.js"]
