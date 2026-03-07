FROM node:20-slim AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.main.json esbuild.renderer.mjs ./
COPY src/ src/
RUN npx tsc -p tsconfig.main.json

FROM node:20-slim

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist dist/

EXPOSE 3000
ENV NODE_ENV=production
CMD ["node", "dist/server.js"]
