FROM node:20

WORKDIR /app

# 1) Install OpenSSL 3.x (Node 20 comes with Debian Bookworm which has OpenSSL 3)
RUN apt-get update \
  && apt-get install -y openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# 2) Copy package files and Prisma schema
COPY package.json tsconfig.json ./
COPY prisma ./prisma

# 3) Install dependencies
RUN npm install

# 4) Set the OpenSSL version explicitly for Prisma
ENV PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1
ENV OPENSSL_CONF=/dev/null

# 5) Generate Prisma Client with explicit engine
RUN npx prisma generate

# 6) Copy source and build
COPY src ./src
RUN npm run build

ENV NODE_ENV=production

# Run migrations on container start, then launch app
CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]