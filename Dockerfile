# Multi-stage Dockerfile for Next.js + Drizzle migrations
FROM node:20-alpine AS base
WORKDIR /app

# Install OS deps (optional git for some installs)
RUN apk add --no-cache bash

# Install dependencies
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# Build the app
FROM base AS builder
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# Production runner with devDependencies included (to run drizzle-kit at startup)
FROM base AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Copy node_modules including devDependencies to allow drizzle-kit usage
COPY --from=deps /app/node_modules ./node_modules

# Copy built app
COPY --from=builder /app/.next ./.next
# Copy public assets if present (folder may not exist in this project)
# Not copying 'public' because the repo doesn't include it
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder /app/src ./src
COPY --from=builder /app/scripts ./scripts

# Add entrypoint
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["/entrypoint.sh"]
CMD ["npm", "run", "start"]
