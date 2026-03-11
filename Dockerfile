FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY . .

ENV DATA_DIR=/data
ENV NODE_ENV=production

EXPOSE 8090

VOLUME ["/data"]

CMD ["node", "server.js"]
