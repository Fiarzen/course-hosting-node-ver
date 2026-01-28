FROM node:20

WORKDIR /app

# 1) Install OpenSSL 3.x
RUN apt-get update \
  && apt-get install -y openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# 2) Copy package files and Prisma schema
COPY package.json tsconfig.json ./
COPY prisma ./prisma

# 3) Force Prisma to use the correct binary target
ENV PRISMA_CLI_BINARY_TARGETS=debian-openssl-3.0.x

# 4) Install dependencies
RUN npm install

# 5) Generate Prisma Client with explicit binary target
RUN npx prisma generate --generator client

# 6) Copy source and build
COPY src ./src
RUN npm run build

ENV NODE_ENV=production

# Run migrations on container start, then launch app
CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]