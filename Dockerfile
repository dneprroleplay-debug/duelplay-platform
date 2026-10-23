FROM node:22-bookworm-slim

WORKDIR /app

# Cache busting argument - change to invalidate cache
ARG CACHE_BUST=1

COPY package*.json ./

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl curl \
  && rm -rf /var/lib/apt/lists/*

RUN npm ci --include=dev

COPY . .

# Debug: verify admin-rbac.ts is copied and has the export
RUN echo "=== Debug: checking admin-rbac.ts ===" && \
    ls -la lib/admin-rbac.ts && \
    grep -n "requireGameModeAdmin" lib/admin-rbac.ts && \
    echo "=== End debug ==="

ENV NODE_ENV=production

RUN npx prisma generate && npm run build

EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]