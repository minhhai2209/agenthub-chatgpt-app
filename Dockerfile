FROM node:22-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY lib ./lib
COPY scripts ./scripts

ENV PORT=8080

CMD ["npm", "start"]
