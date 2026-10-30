FROM node:24-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npx playwright install --with-deps chromium && apt-get update && apt-get install -y --no-install-recommends fonts-noto-cjk && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4310 WORKBENCH_DATA=/data
VOLUME /data
EXPOSE 4310
CMD ["npm", "start"]
