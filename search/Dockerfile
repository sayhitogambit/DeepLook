FROM node:22-bookworm-slim

WORKDIR /app
COPY package.json ./
# search/package-lock.json is intentionally absent; npm install resolves the tree.
RUN npm install --no-audit --no-fund
COPY index.html tsconfig.json vite.config.ts ./
COPY src ./src
COPY server ./server
RUN npm run build

ENV HOST=0.0.0.0 \
    PORT=47241 \
    NODE_ENV=production

EXPOSE 47241
USER node
CMD ["npm", "start"]
