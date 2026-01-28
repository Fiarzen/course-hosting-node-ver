FROM node:20-alpine

WORKDIR /app

COPY package.json tsconfig.json .
COPY prisma ./prisma

RUN npm install

COPY src ./src

RUN npx prisma migrate deploy && npm start

RUN npm run prisma:generate && npm run build

ENV NODE_ENV=production

CMD ["npm", "start"]
