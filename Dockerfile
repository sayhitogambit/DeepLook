FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl gnupg fonts-liberation \
  && curl -fsSL https://dl.google.com/linux/linux_signing_key.pub \
     | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg \
  && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome/deb/ stable main" \
     > /etc/apt/sources.list.d/google-chrome.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends google-chrome-stable \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build && npm prune --omit=dev

COPY docker/chrome /usr/local/bin/deeplook-chrome
RUN chmod 0755 /usr/local/bin/deeplook-chrome

ENV DEEPLOOK_HOST=0.0.0.0 \
    DEEPLOOK_PORT=47231 \
    DEEPLOOK_CHROME=/usr/local/bin/deeplook-chrome

EXPOSE 47231
USER node
CMD ["node", "dist/serve.js"]
