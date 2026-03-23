FROM node:22-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY lib ./lib
COPY scripts ./scripts

CMD ["npm", "start"]
