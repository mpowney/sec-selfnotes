# syntax=docker/dockerfile:1
# Build context: ./sync   (docker build -t selfnotes-sync ./sync)
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=4100 BASE_PATH=/sync
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY public/ ./public/
USER node
EXPOSE 4100
CMD ["node", "dist/index.js"]
