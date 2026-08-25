FROM node:22-alpine

RUN apk add --no-cache curl

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.mjs ./

ENV PORT=3000
EXPOSE 3000
CMD ["node", "server.mjs"]
