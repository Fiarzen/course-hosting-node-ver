FROM node:20

WORKDIR /app

# 1) Install OpenSSL so Prisma can detect it
RUN apt-get update \
  && apt-get install -y openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json tsconfig.json .
COPY prisma ./prisma

# 2) Install deps AFTER OpenSSL is present
RUN npm install

COPY src ./src

RUN npm run prisma:generate && npm run build

ENV NODE_ENV=production

# Run migrations on container start, then launch app
CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]