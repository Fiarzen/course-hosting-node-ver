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

ENV NODE_ENV=production

# Start with migrations then app
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]