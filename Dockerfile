FROM node:20-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

RUN if [ -f prisma/schema.prisma ]; then npx prisma generate; fi \
    && npm run build

EXPOSE 3000 3001 3002 3003

CMD ["npm", "start"]
