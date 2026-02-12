# Simple Ubuntu-based image that builds the Next.js app, runs migrations, then starts the server
FROM ubuntu:22.04 AS base

ENV DEBIAN_FRONTEND=noninteractive \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3002 \
    HOSTNAME=0.0.0.0

WORKDIR /app

# Install Node.js 20 and basic tools
RUN apt-get update && apt-get install -y curl ca-certificates gnupg && \
    mkdir -p /etc/apt/keyrings && \
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg && \
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" > /etc/apt/sources.list.d/nodesource.list && \
    apt-get update && apt-get install -y nodejs && \
    npm -v && node -v && \
    rm -rf /var/lib/apt/lists/*

# Install dependencies
COPY package.json package-lock.json ./
RUN npm ci --include=dev

# Copy source files
COPY . .

# Build arguments for NEXT_PUBLIC_ variables (needed at build time)
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_ALLOWED_TRAINER_EMAILS
ARG GEMINI_API_KEY
ARG RESEND_API_KEY

# Set them as ENV so next build can use them
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_ALLOWED_TRAINER_EMAILS=$NEXT_PUBLIC_ALLOWED_TRAINER_EMAILS \
    GEMINI_API_KEY=$GEMINI_API_KEY \
    RESEND_API_KEY=$RESEND_API_KEY

# Build the application
RUN npm run build


EXPOSE 3002
ENV NODE_ENV=production
CMD ["npm", "run", "start"]
