FROM node:20

WORKDIR /app

# Install OpenSSL 3.x
RUN apt-get update \
  && apt-get install -y openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./
COPY prisma ./prisma

# Install ALL dependencies (including prisma as devDependency)
RUN npm ci

# Copy source and build
COPY src ./src
COPY tsconfig.json ./
RUN npm run build

RUN echo "=== Build artifacts ===" && ls -la dist/
RUN echo "=== Checking server.js ===" && cat dist/server.js | head -n 20

ENV NODE_ENV=production

# Run migrations then start. Retry loop handles brief DB unavailability at container start.
CMD ["sh", "-c", "until npx prisma migrate deploy; do echo 'DB not ready, retrying in 5s...'; sleep 5; done && node dist/server.js"]