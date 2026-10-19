# DataCleanse — single-user, self-hosted.
# Build:  docker build -t datacleanse .
# Run:    docker run -p 3000:3000 -v datacleanse-data:/data datacleanse

FROM node:22-bookworm-slim AS deps
WORKDIR /app
# better-sqlite3 / DuckDB ship prebuilt binaries; build tools are a fallback for other architectures.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
WORKDIR /app
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    DATA_DIR=/data \
    PORT=3000
COPY --from=build /app/package.json /app/next.config.ts ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
CMD ["npx", "next", "start", "-p", "3000"]
