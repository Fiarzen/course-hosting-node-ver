FROM node:20

WORKDIR /app

# 1) Install OpenSSL 3.x
RUN apt-get update \
  && apt-get install -y openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# 2) Copy package files and Prisma schema
COPY package.json tsconfig.json ./
COPY prisma ./prisma

# 3) Install dependencies (but DON'T generate Prisma yet)
RUN npm install

# 4) Copy source and build
COPY src ./src
RUN npm run build

ENV NODE_ENV=production

# Railway's startCommand will handle prisma generate + migrate + start
CMD ["npm", "start"]